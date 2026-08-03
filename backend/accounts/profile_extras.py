"""Experience, skills, and one derived activity feed.

Kept out of `views.py`/`serializers.py` because those files are already long and this is a
self-contained slice: three read endpoints and two small owner-scoped write sets.

The activity feed is **derived on read**, not a stored event log. Writing a log would mean touching
every mutation in the project and would still miss everything that happened before the feature
existed — the corpus alone is 742 exercises with a history this app never recorded. Deriving it costs
a handful of queries at this scale and is always complete by construction. If it ever stops being
cheap, the honest fix is a materialised view, not a parallel log nobody can backfill.
"""

from itertools import chain

from rest_framework import permissions, serializers, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ExperienceEntry, Profile, SkillEntry


def _exercise_title(exercise) -> str:
    """The short human label for an exercise, or its slug.

    An exercise has no title of its own — titles live on its translations — so this reads the first
    one it has. Deliberately not the statement: that is Markdown-with-LaTeX source, and putting any
    slice of it in a feed shows raw markup rather than words.
    """
    if not exercise:
        return ''
    translation = next(iter(exercise.translations.all()), None)
    return (translation.title if translation else '') or exercise.slug


class ExperienceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExperienceEntry
        fields = [
            'id',
            'kind',
            'title',
            'organisation',
            'started_on',
            'ended_on',
            'description',
            'order',
        ]


class SkillSerializer(serializers.ModelSerializer):
    course_slug = serializers.SlugRelatedField(source='course', slug_field='slug', read_only=True)
    field_slug = serializers.SlugRelatedField(source='field', slug_field='slug', read_only=True)

    class Meta:
        model = SkillEntry
        fields = ['id', 'label', 'level', 'evidence', 'course', 'field', 'course_slug', 'field_slug', 'order']
        extra_kwargs = {'course': {'write_only': True}, 'field': {'write_only': True}}

    def validate_label(self, value):
        """One row per label per person, reported as a validation error rather than a 500.

        DRF derives uniqueness validators from `unique_together` but NOT from `Meta.constraints`,
        which is what the model uses — so without this the database constraint fires as an
        IntegrityError and the caller gets a server error for what is really a bad request. Written
        after exactly that happened in the test suite.
        """
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return value
        existing = SkillEntry.objects.filter(profile=request.user.profile, label__iexact=value.strip())
        if self.instance is not None:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError('You already have a skill with that name.')
        return value.strip()


class _OwnedByMe(viewsets.ModelViewSet):
    """Scoped to the caller's own profile in the queryset, not by an after-the-fact check — the same
    convention `ExerciseSetViewSet`/`ServiceWatchViewSet` already use, so somebody else's row 404s."""

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.model.objects.filter(profile=self.request.user.profile)

    def perform_create(self, serializer):
        serializer.save(profile=self.request.user.profile)


class ExperienceViewSet(_OwnedByMe):
    model = ExperienceEntry
    serializer_class = ExperienceSerializer


class SkillViewSet(_OwnedByMe):
    model = SkillEntry
    serializer_class = SkillSerializer

    def perform_create(self, serializer):
        # `evidence` is deliberately not writable as 'registry': that value means an institution
        # said so, and letting somebody type it would make the distinction worthless. It is set by
        # the import path (identity.standing.skill_seeds) and nowhere else.
        evidence = serializer.validated_data.get('evidence')
        if evidence == 'registry':
            serializer.validated_data['evidence'] = 'self_declared'
        serializer.save(profile=self.request.user.profile)


class UserProfileExtrasView(APIView):
    """GET /api/users/{id}/extras/ — the experience and skills shown on a public profile."""

    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        profile = Profile.objects.filter(user_id=pk).first()
        if profile is None:
            return Response({'experience': [], 'skills': []})
        return Response(
            {
                'experience': ExperienceSerializer(profile.experience.all(), many=True).data,
                'skills': SkillSerializer(profile.skills.select_related('course', 'field'), many=True).data,
            }
        )


class UserActivityView(APIView):
    """GET /api/users/{id}/activity/ — one merged, newest-first feed of what this person has done.

    Every item carries `kind` and `tags`, which is what makes the list filterable client-side without
    a second round trip per filter. Tags come from real data — an exercise's own tags, a course's
    subjects — rather than being invented here, so filtering by one actually means something.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        from classroom.models import Enrollment, TaughtCourse
        from community.models import Comment, Review
        from exercises.models import Exercise

        items = []

        for exercise in (
            Exercise.objects.filter(submitted_by_id=pk, published=True)
            .prefetch_related('tags', 'translations')
            .order_by('-id')[:50]
        ):
            translation = exercise.translations.first()
            items.append(
                {
                    'kind': 'exercise',
                    # The translation's own title, not the first 120 characters of its statement.
                    # A statement is Markdown-with-LaTeX source, so slicing it dumped raw `<p>` and
                    # `\(\mathbb{R}^2\)` into the feed as literal text — every exercise row on a
                    # profile was a wall of unrendered markup. Truncating it was also cutting mid-tag
                    # and mid-formula, so there was no rendering it safely either; the title is the
                    # short human label that already exists for exactly this purpose.
                    'title': (translation.title if translation else '') or exercise.slug,
                    'exercise_id': exercise.pk,
                    'tags': [t.slug for t in exercise.tags.all()],
                    'created_at': None,
                }
            )

        for review in (
            Review.objects.filter(author_id=pk, is_removed=False)
            .select_related('exercise')
            # `exercise__translations` too, or naming each reviewed exercise costs a query apiece.
            .prefetch_related('exercise__tags', 'exercise__translations')[:50]
        ):
            items.append(
                {
                    'kind': 'review',
                    # What was reviewed, rather than the review's own prose: the feed already shows
                    # the rating and the kind, so repeating the body here duplicated the "Reviews
                    # written" section further down the same page word for word.
                    'title': _exercise_title(review.exercise) or f'{review.rating}★',
                    'exercise_id': review.exercise_id,
                    'rating': review.rating,
                    'tags': [t.slug for t in review.exercise.tags.all()],
                    'created_at': review.created_at.isoformat(),
                }
            )

        for comment in Comment.objects.filter(author_id=pk, is_removed=False)[:50]:
            items.append(
                {
                    'kind': 'comment',
                    'title': comment.body[:120],
                    'tags': [],
                    'created_at': comment.created_at.isoformat(),
                }
            )

        for course in TaughtCourse.objects.filter(instructor_id=pk).prefetch_related('subjects'):
            items.append(
                {
                    'kind': 'course_taught',
                    'title': course.title,
                    'taught_course_id': course.pk,
                    'tags': [s.slug for s in course.subjects.all()],
                    'created_at': course.created_at.isoformat(),
                }
            )

        for enrollment in (
            Enrollment.objects.filter(participant_id=pk, status='active')
            .select_related('course')
            .prefetch_related('course__subjects')
        ):
            items.append(
                {
                    'kind': 'course_joined',
                    'title': enrollment.course.title,
                    'taught_course_id': enrollment.course_id,
                    'tags': [s.slug for s in enrollment.course.subjects.all()],
                    'created_at': enrollment.requested_at.isoformat(),
                }
            )

        # Undated items (imported exercises carry no submission timestamp) sort last rather than
        # being dropped or given a fake date — the feed says "no date" and means it.
        items.sort(key=lambda i: (i['created_at'] is not None, i['created_at'] or ''), reverse=True)

        tags = sorted({t for item in items for t in item['tags']})
        return Response({'items': items, 'tags': tags, 'kinds': sorted({i['kind'] for i in items})})
