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

from .models import Certificate, ExperienceEntry, Profile, SkillEntry


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
    branch_slug = serializers.SlugRelatedField(source='branch', slug_field='slug', read_only=True)
    discipline_slug = serializers.SlugRelatedField(source='discipline', slug_field='slug', read_only=True)

    class Meta:
        model = SkillEntry
        fields = ['id', 'label', 'level', 'evidence', 'branch', 'discipline', 'branch_slug', 'discipline_slug', 'order']
        extra_kwargs = {'branch': {'write_only': True}, 'discipline': {'write_only': True}}

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


class CertificateSerializer(serializers.ModelSerializer):
    # Computed server-side rather than by comparing dates in each client: the public profile and the
    # owner's own editor both render this, and two implementations of "is today past this date" is two
    # places for a timezone to be read differently.
    is_expired = serializers.BooleanField(read_only=True)

    class Meta:
        model = Certificate
        fields = [
            'id',
            'title',
            'issuer',
            'issued_on',
            'expires_on',
            'credential_id',
            'url',
            'is_expired',
            'order',
        ]

    def validate(self, attrs):
        """One row per (title, issuer), reported as a 400 rather than a 500.

        The same DRF gap `SkillSerializer.validate_label` above already documents: uniqueness
        validators are derived from `unique_together` and NOT from `Meta.constraints`, which is what
        this model uses — so without this the database constraint surfaces as an `IntegrityError` and
        the caller gets a server error for what is really a bad request.

        Checked in `validate` rather than per-field because the constraint spans two columns: a PATCH
        that changes only the issuer still has to be checked against the title it is keeping, which a
        `validate_issuer` looking at one value in isolation cannot do.
        """
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return attrs
        title = (attrs.get('title') if 'title' in attrs else getattr(self.instance, 'title', '')) or ''
        issuer = (
            attrs.get('issuer') if 'issuer' in attrs else getattr(self.instance, 'issuer', '')
        ) or ''
        clash = Certificate.objects.filter(
            profile=request.user.profile, title__iexact=title.strip(), issuer__iexact=issuer.strip()
        )
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {'title': ['You already have that certificate from that issuer.']}
            )
        return attrs


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


class CertificateViewSet(_OwnedByMe):
    model = Certificate
    serializer_class = CertificateSerializer


class UserProfileExtrasView(APIView):
    """GET /api/users/{id}/extras/ — the experience, skills and certificates shown on a public profile.

    One request for three lists rather than three requests, because the profile renders all of them
    together and always has: the page cannot show a coherent summary until every one has arrived, so
    splitting them would only add round trips to the same wait.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        profile = Profile.objects.filter(user_id=pk).first()
        if profile is None:
            return Response({'experience': [], 'skills': [], 'certificates': []})
        return Response(
            {
                'experience': ExperienceSerializer(profile.experience.all(), many=True).data,
                'skills': SkillSerializer(profile.skills.select_related('branch', 'discipline'), many=True).data,
                'certificates': CertificateSerializer(profile.certificates.all(), many=True).data,
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
        from courses.models import Course, Enrollment, LessonProgress
        from community.models import Comment, Review
        from exercises.models import Exercise
        from materials.models import Material
        from services.models import ServiceReview
        from study.models import ExerciseSet

        # Who is asking. Three of the sources below are not uniformly public, and the feed's promise
        # is that it answers with exactly as much as THIS reader is allowed to see — never more, and
        # never less to the person it is about. Applied per source rather than as one blanket gate,
        # because the three are private for three different reasons and only one of them is settled
        # by "is this your own profile".
        viewer = request.user if request.user.is_authenticated else None
        is_self = viewer is not None and viewer.pk == pk

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

        for course in Course.objects.filter(instructor_id=pk).prefetch_related('subjects'):
            items.append(
                {
                    'kind': 'course_taught',
                    'title': course.title,
                    'course_id': course.pk,
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
                    'course_id': enrollment.course_id,
                    'tags': [s.slug for s in enrollment.course.subjects.all()],
                    'created_at': enrollment.requested_at.isoformat(),
                }
            )

        # --- posted: materials, alongside the exercises above -----------------------------------
        # `Material.submitted_by` is the same real-account attribution `Exercise.submitted_by` carries
        # and was missing from this feed entirely, so somebody whose contribution here has been
        # uploading course scripts read as having contributed nothing.
        for material in (
            Material.objects.filter(submitted_by_id=pk, published=True)
            .prefetch_related('tags', 'translations')
            .order_by('-id')[:50]
        ):
            translation = next(iter(material.translations.all()), None)
            items.append(
                {
                    'kind': 'material',
                    'title': (translation.title if translation else '') or material.slug,
                    'material_id': material.pk,
                    'tags': [t.slug for t in material.tags.all()],
                    # Material has no created_at of its own, so this is honestly undated rather than
                    # borrowed from a translation row that may have been written much later.
                    'created_at': None,
                }
            )

        # --- reviewed: tutoring listings, alongside the exercise reviews above -------------------
        # The public profile has shown these in its own "reviews" list since 17P; the feed never knew
        # about them, so filtering the feed by "review" silently showed only half of somebody's.
        for service_review in (
            ServiceReview.objects.filter(author_id=pk, is_removed=False)
            .select_related('service')
            .order_by('-created_at')[:50]
        ):
            items.append(
                {
                    'kind': 'service_review',
                    'title': service_review.service.title,
                    'service_id': service_review.service_id,
                    'rating': service_review.rating,
                    'tags': [],
                    'created_at': service_review.created_at.isoformat(),
                }
            )

        # --- solved: lessons this person marked done ---------------------------------------------
        # The nearest thing to "solved" this app actually records, and worth being precise about
        # rather than approximating: EdMat tracks no per-exercise attempt or completion anywhere, and
        # the one signal that could be mistaken for it — `moderation.ContentView` — records that a
        # page was OPENED. Deriving "solved" from that would be surveillance presented as achievement,
        # and wrong twice over: reading a solution is not solving, and it would credit somebody for
        # every exercise they gave up on. `LessonProgress` is the opposite kind of data — a statement
        # the participant made about themselves by pressing a button (see its own docstring).
        #
        # Which is exactly why it is the most restricted source here. Progress belongs to the course,
        # not to this feed: `Course.progress_visibility` is the instructor's promise to their
        # participants about who is watching, and `off` blinds even staff. So the check is delegated
        # to the course's own method rather than reimplemented, and an anonymous reader never sees any
        # of it — for the honest reason that `progress_visible_to` requires membership, and a stranger
        # has none.
        if viewer is not None:
            for progress in (
                LessonProgress.objects.filter(participant_id=pk, status='done')
                .select_related('lesson__chapter__course')
                .order_by('-updated_at')[:50]
            ):
                chapter = progress.lesson.chapter
                course = chapter.course if chapter else None
                if course is None or not course.progress_visible_to(viewer):
                    continue
                items.append(
                    {
                        'kind': 'lesson_done',
                        'title': progress.lesson.title,
                        'course_id': course.pk,
                        'tags': [],
                        'created_at': progress.updated_at.isoformat(),
                    }
                )

        # --- selected/saved: this person's own exercise sets --------------------------------------
        # A set is private by default (`ExerciseSet.is_public`, 17J) and the whole point of that flag
        # is that the owner decides. So a stranger sees only the shared ones, while the owner sees all
        # of theirs on their own profile — the feed is, among other things, how somebody finds a set
        # they built and forgot the name of.
        saved_sets = ExerciseSet.objects.filter(owner_id=pk)
        if not is_self:
            saved_sets = saved_sets.filter(is_public=True)
        for exercise_set in saved_sets.prefetch_related('exercises')[:50]:
            items.append(
                {
                    'kind': 'saved_set',
                    'title': exercise_set.name,
                    # The slug, not the numeric pk: it is what this API resolves a set by
                    # (`ExerciseSetViewSet.lookup_field`) and what `/sets/[id]` expects.
                    'set_id': exercise_set.slug,
                    'set_size': exercise_set.exercises.count(),
                    'is_public': exercise_set.is_public,
                    'tags': [],
                    'created_at': exercise_set.created_at.isoformat(),
                }
            )

        # Undated items (imported exercises carry no submission timestamp) sort last rather than
        # being dropped or given a fake date — the feed says "no date" and means it.
        items.sort(key=lambda i: (i['created_at'] is not None, i['created_at'] or ''), reverse=True)

        tags = sorted({t for item in items for t in item['tags']})
        counts = {
            kind: sum(1 for i in items if i['kind'] == kind) for kind in {i['kind'] for i in items}
        }
        # The exercise total comes from the stored counter, not from the list above, which is
        # sliced at 50: somebody with 300 exercises used to read as having 50. The feed still shows
        # its 50 newest; the tile says how many there really are. See accounts/counters.py.
        stored = (
            Profile.objects.filter(user_id=pk)
            .values('exercises_published_count', 'materials_published_count')
            .first()
        )
        if stored:
            if stored['exercises_published_count']:
                counts['exercise'] = stored['exercises_published_count']
            if stored['materials_published_count']:
                counts['material'] = stored['materials_published_count']
        return Response(
            {
                'items': items,
                'tags': tags,
                'kinds': sorted({i['kind'] for i in items}),
                # Per-kind totals, so the summary tiles on a one-screen profile do not each have to
                # re-count a list the client may be filtering anyway. Counted from what this reader
                # was actually given, so the tiles can never advertise something the feed withholds.
                'counts': counts,
            }
        )
