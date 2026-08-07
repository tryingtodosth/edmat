from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation
from taxonomy.models import Branch, Discipline

from .models import (
    ACTIVE_ENROLLMENT_STATUSES,
    Attachment,
    AttachmentReview,
    Chapter,
    CourseInvite,
    CourseItem,
    CourseNote,
    CourseStaff,
    Enrollment,
    Lesson,
    LessonExerciseSet,
    LessonSetExercise,
    Course,
)


class ParticipantSerializer(serializers.Serializer):
    """Just enough to name a person, matching what every other author byline in this API exposes.

    Deliberately not the full profile: a participant list is a list of who is in the room, and
    resolving each one's whole profile inline would both bloat the response and leak more than the
    question asked for. A client that wants more calls `/api/users/{id}/`, which already applies
    that person's own privacy settings.
    """

    id = serializers.IntegerField(source='pk', read_only=True)
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, user) -> str:
        profile = getattr(user, 'profile', None)
        return (profile.display_name if profile and profile.display_name else user.username)


def is_participant_of(course, user) -> bool:
    """Whether this viewer is "in the room" for the participant-only lesson notes.

    Module-level so the viewset's own chapter endpoints share the one definition with
    `CourseSerializer` rather than growing a third copy that can disagree with the other two.
    """
    if user is None or not getattr(user, 'is_authenticated', False):
        return False
    if course.is_staff_member(user):
        return True
    return course.enrollments.filter(
        participant=user, status__in=ACTIVE_ENROLLMENT_STATUSES
    ).exists()


class LessonSetExerciseSerializer(serializers.ModelSerializer):
    """One pinned exercise, named the way every other exercise reference in this API is.

    An exercise has never had a title in this project — it is identified by its subject and number,
    which is exactly what `Exercise.__str__` composes, so this reuses it rather than inventing a
    second naming scheme, exactly as `CourseItemSerializer.get_label` already does.
    """

    label = serializers.SerializerMethodField()
    published = serializers.BooleanField(source='exercise.published', read_only=True)

    class Meta:
        model = LessonSetExercise
        fields = ['id', 'exercise', 'label', 'order', 'published']

    def get_label(self, row) -> str:
        return str(row.exercise)


class LessonExerciseSetSerializer(serializers.ModelSerializer):
    exercises = serializers.SerializerMethodField()
    linked_by = ParticipantSerializer(read_only=True)
    # The source's own slug, or null once it has been deleted or the viewer cannot read it. A link
    # whose source is gone keeps working — that is the point of pinning — so this is genuinely
    # optional rather than an error state.
    source_slug = serializers.SerializerMethodField()
    source_exists = serializers.SerializerMethodField()
    has_drifted = serializers.SerializerMethodField()
    hidden_exercise_count = serializers.SerializerMethodField()

    class Meta:
        model = LessonExerciseSet
        fields = [
            'id',
            'lesson',
            'title',
            'note',
            'order',
            'exercises',
            'linked_by',
            'linked_at',
            'refreshed_at',
            'source_slug',
            'source_exists',
            'has_drifted',
            'hidden_exercise_count',
        ]

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def _can_curate(self, link) -> bool:
        """Asked once per course per response, not once per field per row.

        DRF reuses ONE child serializer across every row under `many=True`, so caching on `self`
        would be a real bug here — this project has already been bitten by exactly that. The cache
        lives in the request-scoped context and is keyed by course, so two links can never read each
        other's answer.
        """
        cache = self.context.setdefault('_lesson_set_curate_cache', {})
        course = link.course
        if course.pk not in cache:
            cache[course.pk] = course.can_curate(self._user())
        return cache[course.pk]

    def get_exercises(self, link):
        """Filtered per viewer: an unpublished exercise is dropped for anybody who cannot curate.

        `CourseItem.is_visible_to` does not make the equivalent check on its own referenced object;
        this deliberately does — see `LessonExerciseSet.visible_exercises`.
        """
        return LessonSetExerciseSerializer(
            link.visible_exercises(self._user(), can_curate=self._can_curate(link)),
            many=True,
            context=self.context,
        ).data

    def get_hidden_exercise_count(self, link) -> int:
        """How many pinned exercises this viewer is NOT being shown, because a moderator pulled
        them. Stated as a number rather than silently swallowed, so a shorter list is explained."""
        shown = link.visible_exercises(self._user(), can_curate=self._can_curate(link))
        return len(link.exercises.all()) - len(shown)

    def get_source_slug(self, link) -> str | None:
        return link.exercise_set.slug if link.exercise_set_id else None

    def get_source_exists(self, link) -> bool:
        return bool(link.exercise_set_id)

    def get_has_drifted(self, link) -> bool:
        """Whether the source set now holds a different list than what was pinned — curators only.

        Anybody else has nothing to do with the answer: they cannot re-copy, and the source is
        somebody else's private list. False for a source that is gone, or one this viewer may not
        read, because "drifted" is not a claim that can be made about a set nobody can see.
        """
        source = link.exercise_set
        if source is None or not self._can_curate(link):
            return False
        pinned = [row.exercise_id for row in link.exercises.all()]
        current = list(
            source.exercisesetitem_set.order_by('order', 'id').values_list('exercise_id', flat=True)
        )
        return pinned != current


class LessonSerializer(serializers.ModelSerializer):
    participant_notes = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()
    exercise_sets = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = [
            'id',
            'chapter',
            'title',
            'description',
            'order',
            'scheduled_at',
            'duration_minutes',
            'participant_notes',
            'items',
            'exercise_sets',
        ]

    def get_exercise_sets(self, lesson):
        """Filtered by each link's own `is_visible_to`, not by the caller having already checked.

        That matters here specifically: `CourseSerializer.get_lessons` returns every lesson flat,
        with no chapter-lock filter of its own, so a locked chapter's lessons DO reach this
        serializer by that route. Asking each link the question itself is what keeps this field
        correct on both paths rather than only on the nested one.
        """
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        visible = [link for link in lesson.exercise_sets.all() if link.is_visible_to(user)]
        return LessonExerciseSetSerializer(visible, many=True, context=self.context).data

    def get_items(self, lesson):
        """Filtered per viewer, not per lesson: a pending contribution is visible to staff and to
        whoever offered it, and to nobody else. The chapter's own lock is already applied one level
        up, in `ChapterSerializer.get_lessons`."""
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        visible = [item for item in lesson.items.all() if item.is_visible_to(user)]
        return CourseItemSerializer(visible, many=True, context=self.context).data

    def get_participant_notes(self, lesson) -> str:
        """Blank for anybody who is not actually in the course.

        Enforced here rather than by omitting the field for outsiders, so the shape of the response
        does not change with the caller — a client never has to branch on whether a key exists, only
        on whether it is empty.
        """
        return lesson.participant_notes if self.context.get('is_participant') else ''


class LessonWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lesson
        fields = [
            'chapter',
            'title',
            'description',
            'order',
            'scheduled_at',
            'duration_minutes',
            'participant_notes',
        ]


class CourseSerializer(serializers.ModelSerializer):
    instructor = ParticipantSerializer(read_only=True)
    subject_slugs = serializers.SlugRelatedField(
        source='subjects', slug_field='slug', many=True, read_only=True
    )
    field_slug = serializers.SlugRelatedField(source='field', slug_field='slug', read_only=True)
    lessons = serializers.SerializerMethodField()
    participant_count = serializers.IntegerField(source='active_participant_count', read_only=True)
    seats_left = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)
    # The viewer's own relationship to this course, resolved server-side. The client should never
    # have to work out "am I in this?" by scanning a participant list it may not even be allowed to
    # see.
    my_enrollment_status = serializers.SerializerMethodField()
    can_enrol = serializers.SerializerMethodField()
    enrollment_block_reason = serializers.SerializerMethodField()
    is_instructor = serializers.SerializerMethodField()
    # Resolved server-side for the same reason `can_enrol` is: whether this viewer may read or post
    # in the thread depends on the course's mode AND their membership, and a client working that out
    # for itself is a client that can get it wrong.
    can_read_discussion = serializers.SerializerMethodField()
    can_post_discussion = serializers.SerializerMethodField()
    notify_me = serializers.SerializerMethodField()
    # The viewer's own standing, resolved server-side for the same reason `can_enrol` is: the client
    # should never work out from a roster what it is allowed to do, because a client that computes a
    # permission is a client that can compute it wrongly.
    my_role = serializers.SerializerMethodField()
    can_administer = serializers.SerializerMethodField()
    can_curate = serializers.SerializerMethodField()
    can_contribute = serializers.SerializerMethodField()
    contribution_needs_approval = serializers.SerializerMethodField()
    chapters = serializers.SerializerMethodField()
    unfiled_items = serializers.SerializerMethodField()
    pending_contribution_count = serializers.SerializerMethodField()

    class Meta:
        model = Course
        fields = [
            'id',
            'instructor',
            'title',
            'summary',
            'description',
            'subject_slugs',
            'field_slug',
            'visibility',
            'status',
            # Read-only here on purpose: the quota is an administrator's cost control, set in Django
            # admin, not something a course's own instructor may raise for themselves. Both are sent
            # so the UI can say "180 MB of 500 MB" rather than only refusing an upload at the point
            # somebody has already chosen the file.
            'upload_quota_bytes',
            'uploaded_bytes',
            'enrollment_policy',
            'capacity',
            'discussion_mode',
            'announce_new_lessons',
            'announce_new_posts',
            'language',
            'starts_on',
            'ends_on',
            'price',
            'currency',
            'created_at',
            'lessons',
            'participant_count',
            'seats_left',
            'is_full',
            'my_enrollment_status',
            'can_enrol',
            'enrollment_block_reason',
            'is_instructor',
            'can_read_discussion',
            'can_post_discussion',
            'notify_me',
            'contribution_policy',
            'my_role',
            'can_administer',
            'can_curate',
            'can_contribute',
            'contribution_needs_approval',
            'chapters',
            'unfiled_items',
            'pending_contribution_count',
        ]

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def _my_enrollment(self, course):
        user = self._user()
        if not user or not user.is_authenticated:
            return None
        # Uses the prefetched rows when the view supplied them, so a list of 50 courses does not
        # become 50 extra queries.
        for enrollment in course.enrollments.all():
            if enrollment.participant_id == user.pk:
                return enrollment
        return None

    def _is_participant(self, course) -> bool:
        """Whether this viewer is "in the room", and so may read the participant-only lesson notes.

        One definition, used by both the flat `lessons` list and the nested chapter -> lesson one.
        It used to live only in `get_lessons`, so the nested copy — which is the shape the course
        page actually renders — passed a context with no `is_participant` in it at all and blanked
        every lesson's notes for everybody, including the staff who wrote them.
        """
        enrollment = self._my_enrollment(course)
        # "In the room" includes every member of staff, not only the owner — an assistant who cannot
        # read the lesson notes they are supposed to be teaching from is not an assistant.
        return bool(
            (enrollment and enrollment.status in ACTIVE_ENROLLMENT_STATUSES)
            or course.is_staff_member(self._user())
        )

    def get_lessons(self, course):
        return LessonSerializer(
            Lesson.objects.filter(chapter__course=course),
            many=True,
            context={**self.context, 'is_participant': self._is_participant(course)},
        ).data

    def get_my_enrollment_status(self, course) -> str | None:
        enrollment = self._my_enrollment(course)
        return enrollment.status if enrollment else None

    def get_is_instructor(self, course) -> bool:
        """Kept, and now true for every member of staff.

        The name is the pre-existing API contract and the frontend reads it in a dozen places; what
        it has always meant is "does this person run the course", which is exactly the question that
        now has three answers instead of one. `my_role` is there for anybody who needs the finer
        distinction.
        """
        return course.is_staff_member(self._user())

    def get_enrollment_block_reason(self, course) -> str | None:
        return course.enrollment_block_reason(self._user())

    def get_can_enrol(self, course) -> bool:
        return course.enrollment_block_reason(self._user()) is None

    def get_can_read_discussion(self, course) -> bool:
        return course.discussion_visible_to(self._user())

    def get_can_post_discussion(self, course) -> bool:
        return course.discussion_writable_by(self._user())

    def get_my_role(self, course) -> str | None:
        return course.role_of(self._user())

    def get_can_administer(self, course) -> bool:
        return course.can_administer(self._user())

    def get_can_curate(self, course) -> bool:
        return course.can_curate(self._user())

    def get_can_contribute(self, course) -> bool:
        return course.can_contribute(self._user())

    def get_contribution_needs_approval(self, course) -> bool:
        return course.contribution_needs_approval(self._user())

    def get_chapters(self, course):
        return ChapterSerializer(
            course.chapters.all(),
            many=True,
            context={**self.context, 'is_participant': self._is_participant(course)},
        ).data

    def get_unfiled_items(self, course):
        """Content in the course and filed nowhere — in no lesson AND in no chapter.

        Its own field rather than a nameless chapter, because "not filed yet" is a real state — it is
        where a participant's submission lands before anybody decides which week it belongs to, and a
        course that uses no chapters at all keeps everything here quite legitimately.

        BOTH targets have to be null. Testing only one draws every item filed the other way a second
        time, in the loose pile underneath the chapter it is already sitting in — which is what
        happened while this read `chapter_id is None` alone: a lesson's contents were also reported
        as unfiled, because a lesson-filed row genuinely has no chapter of its own.
        """
        user = self._user()
        visible = [
            item
            for item in course.items.all()
            if item.lesson_id is None and item.chapter_id is None and item.is_visible_to(user)
        ]
        return CourseItemSerializer(visible, many=True, context=self.context).data

    def get_pending_contribution_count(self, course) -> int:
        """Badge fodder for the staff review queue, and 0 for everybody else — a participant has no
        business knowing how much is queued in a course they merely attend."""
        if not course.can_curate(self._user()):
            return 0
        return sum(1 for item in course.items.all() if item.status == 'pending')

    def get_notify_me(self, course) -> bool | None:
        """The viewer's own per-course mute. None when they are not in the course at all, which is
        genuinely different from "in the course, notifications off"."""
        enrollment = self._my_enrollment(course)
        return enrollment.notify if enrollment else None


class CourseWriteSerializer(serializers.ModelSerializer):
    # Referred to by their slugs rather than their numeric pks, matching how the rest of this API
    # already addresses taxonomy rows (`Service.course_slugs`) — a client that has a course page
    # open knows its slug, not its id.
    subjects = serializers.SlugRelatedField(
        slug_field='slug', many=True, required=False, queryset=Branch.objects.all()
    )
    field = serializers.SlugRelatedField(
        slug_field='slug', required=False, allow_null=True, queryset=Discipline.objects.all()
    )

    class Meta:
        model = Course
        fields = [
            'title',
            'summary',
            'description',
            'subjects',
            'field',
            'visibility',
            'status',
            'enrollment_policy',
            'capacity',
            'discussion_mode',
            'announce_new_lessons',
            'announce_new_posts',
            'contribution_policy',
            'language',
            'starts_on',
            'ends_on',
            'price',
            'currency',
        ]

    def validate(self, attrs):
        starts_on = attrs.get('starts_on', getattr(self.instance, 'starts_on', None))
        ends_on = attrs.get('ends_on', getattr(self.instance, 'ends_on', None))
        if starts_on and ends_on and ends_on < starts_on:
            raise serializers.ValidationError({'ends_on': 'A course cannot end before it starts.'})
        capacity = attrs.get('capacity', getattr(self.instance, 'capacity', 0))
        if self.instance and capacity:
            # Lowering the cap below the number of people already in is refused rather than silently
            # leaving the course over capacity — or, far worse, dropping somebody who had already
            # been let in.
            active = self.instance.active_participant_count
            if capacity < active:
                raise serializers.ValidationError(
                    {
                        'capacity': f'{active} people are already taking part; the limit cannot be '
                        'lower than that.'
                    }
                )
        return attrs


class EnrollmentSerializer(serializers.ModelSerializer):
    participant = ParticipantSerializer(read_only=True)
    course_id = serializers.IntegerField(source='course.pk', read_only=True)
    course_title = serializers.CharField(source='course.title', read_only=True)

    class Meta:
        model = Enrollment
        fields = [
            'id',
            'course_id',
            'course_title',
            'participant',
            'status',
            'request_note',
            'notify',
            'requested_at',
            'decided_at',
        ]


class CourseStaffSerializer(serializers.ModelSerializer):
    user = ParticipantSerializer(read_only=True)

    class Meta:
        model = CourseStaff
        fields = ['id', 'user', 'role', 'added_at']


class CourseItemSerializer(serializers.ModelSerializer):
    kind = serializers.CharField(read_only=True)
    submitted_by = ParticipantSerializer(read_only=True)
    decided_by = ParticipantSerializer(read_only=True)
    label = serializers.SerializerMethodField()

    class Meta:
        model = CourseItem
        fields = [
            'id',
            'kind',
            'lesson',
            'chapter',
            'material',
            'exercise',
            'attachment',
            'event',
            'label',
            'order',
            'note',
            'status',
            'submitted_by',
            'decided_by',
            'decided_at',
            'decision_note',
            'created_at',
        ]

    def get_label(self, item) -> str:
        """Enough to recognise the thing without a second request.

        A material's title lives on its translations, so this resolves one through the same
        `resolve_translation` every other material response uses — reading `material.title` directly
        would not compile, and picking the first translation by hand would show a Polish title to an
        English reader. Falling back to the slug is what `MaterialSerializer.get_title` already does.

        An exercise has never had a title in this project: it is identified by its subject and
        number, which is exactly what `Exercise.__str__` composes, so this reuses that rather than
        inventing a second naming scheme for the same row.

        An attachment and an event both carry a plain `title` of their own, so neither needs
        resolving — they are course-local and single-language by construction.
        """
        if item.material_id:
            translation = resolve_translation(
                item.material.translations, request_locale(self.context)
            )
            return translation.title if translation else item.material.slug
        if item.exercise_id:
            return str(item.exercise)
        if item.attachment_id:
            return item.attachment.title
        return item.event.title


class CourseItemWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseItem
        fields = ['lesson', 'chapter', 'material', 'exercise', 'attachment', 'event', 'order', 'note']

    def validate(self, attrs):
        def resolved(name):
            return attrs.get(name, getattr(self.instance, name, None))

        targets = {name: resolved(name) for name in ('material', 'exercise', 'attachment', 'event')}
        chosen = [name for name, value in targets.items() if value]
        if len(chosen) != 1:
            raise serializers.ValidationError(
                'Reference exactly one of material, exercise, attachment or event.'
            )

        course = self.context.get('course')

        # A lesson or chapter from another course would file this item somewhere its own course
        # cannot see. The database cannot express that constraint across the join, so it is checked
        # here. Read from `attrs` rather than `resolved`, because only a value being *set* by this
        # request needs checking — one already stored was checked when it was stored.
        lesson = attrs.get('lesson')
        chapter = attrs.get('chapter')
        if lesson and course and lesson.chapter.course_id != course.pk:
            raise serializers.ValidationError({'lesson': 'That lesson belongs to another course.'})
        if chapter and course and chapter.course_id != course.pk:
            raise serializers.ValidationError({'chapter': 'That chapter belongs to another course.'})
        if resolved('lesson') and resolved('chapter'):
            raise serializers.ValidationError(
                'File this into a lesson or a chapter, not both.'
            )

        # An attachment belongs to exactly one course, so pointing at another course's is both
        # meaningless and a real leak — an attachment is deliberately NOT discoverable outside its
        # own course, and linking one in would publish it to a roster it was never shared with.
        attachment = attrs.get('attachment')
        if attachment and course and attachment.course_id != course.pk:
            raise serializers.ValidationError(
                {'attachment': 'That file belongs to another course.'}
            )

        # An event is deliberately NOT checked for ownership: it has its own host and its own public
        # page, and pointing a course at somebody else's guest lecture is the normal case, not an
        # error. What is refused is a draft — it is not announced yet, so linking it would publish
        # somebody else's unfinished plan to this course's roster.
        event = attrs.get('event')
        if event and event.status == 'draft':
            raise serializers.ValidationError(
                {'event': 'That event has not been published yet.'}
            )
        return attrs


class ChapterSerializer(serializers.ModelSerializer):
    is_unlocked = serializers.SerializerMethodField()
    lessons = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()

    class Meta:
        model = Chapter
        fields = [
            'id',
            'title',
            'description',
            'order',
            'unlocks_at',
            'is_unlocked',
            'lessons',
            'items',
        ]

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def get_is_unlocked(self, chapter) -> bool:
        """The chapter's own state, not this viewer's access to it.

        Deliberately the plain fact rather than "can I see it": a participant looking at a locked
        week should be told it is locked and when it opens, and staff looking at the same row need
        to know it is still shut even though they can read it.
        """
        return chapter.is_unlocked()

    def get_lessons(self, chapter):
        user = self._user()
        if not chapter.is_visible_to(user):
            # The chapter still renders — title, description and unlock date — but its contents do
            # not. That is the whole point of a locked chapter: you can see that week 3 exists,
            # without being shown what is in it yet.
            return []
        return LessonSerializer(
            chapter.lessons.all(), many=True, context=self.context
        ).data

    def get_items(self, chapter):
        """Content filed straight into this chapter rather than into one of its lessons.

        Filtered per viewer exactly as `Lesson.items` already is, so a pending contribution stays
        visible to staff and to whoever offered it and to nobody else. The lock check above already
        returned early, so what remains here is only the per-item status question.
        """
        user = self._user()
        if not chapter.is_visible_to(user):
            return []
        visible = [i for i in chapter.items.all() if i.is_visible_to(user)]
        return CourseItemSerializer(visible, many=True, context=self.context).data


class ChapterWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Chapter
        fields = ['title', 'description', 'order', 'unlocks_at']


class CourseInviteSerializer(serializers.ModelSerializer):
    created_by = ParticipantSerializer(read_only=True)
    is_usable = serializers.BooleanField(read_only=True)
    unusable_reason = serializers.SerializerMethodField()

    class Meta:
        model = CourseInvite
        fields = [
            'id',
            'token',
            'role',
            'label',
            'created_by',
            'created_at',
            'max_uses',
            'uses',
            'expires_at',
            'revoked_at',
            'is_usable',
            'unusable_reason',
        ]

    def get_unusable_reason(self, invite) -> str | None:
        return invite.unusable_reason()


class CourseInviteWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseInvite
        fields = ['role', 'label', 'max_uses', 'expires_at']


class InvitePreviewSerializer(serializers.Serializer):
    """What somebody holding a link is told BEFORE they use it, and before they have logged in.

    Deliberately thin: a course's title and who runs it is enough to decide whether to accept, and an
    invite token is a URL that gets pasted into group chats — anything more here would be published
    to whoever it was forwarded to. Notably absent: the roster, the description, and the content.
    """

    course_id = serializers.IntegerField()
    course_title = serializers.CharField()
    instructor_name = serializers.CharField()
    role = serializers.CharField()
    is_usable = serializers.BooleanField()
    unusable_reason = serializers.CharField(allow_null=True)


class CourseNoteSerializer(serializers.ModelSerializer):
    """A person's own notes. There is deliberately no author field on the wire.

    Not an oversight: the only rows a caller can ever reach are their own, because
    `CourseNoteViewSet` filters by `author=request.user` before anything else. Serialising an author
    would imply the field can vary, and the first time somebody built a "notes for this course" view
    on that assumption it would be a privacy bug rather than a wrong label.
    """

    class Meta:
        model = CourseNote
        fields = ['id', 'lesson', 'body', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


class AttachmentReviewSerializer(serializers.ModelSerializer):
    author = ParticipantSerializer(read_only=True)

    class Meta:
        model = AttachmentReview
        fields = ['id', 'author', 'rating', 'body', 'created_at']
        read_only_fields = ['created_at']


class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by = ParticipantSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()
    size_bytes = serializers.IntegerField(read_only=True)
    review_count = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            'id',
            'title',
            'description',
            'file_url',
            'size_bytes',
            'uploaded_by',
            'created_at',
            'review_count',
            'average_rating',
        ]

    def get_file_url(self, attachment) -> str:
        """Absolute when a request is in context, so a client on another origin can follow it.

        Deliberately not the raw storage name: that is a path, not a link, and every other file in
        this API is already handed over as a URL."""
        if not attachment.file:
            return ''
        request = self.context.get('request')
        url = attachment.file.url
        return request.build_absolute_uri(url) if request else url

    def get_review_count(self, attachment) -> int:
        return len(attachment.reviews.all())

    def get_average_rating(self, attachment):
        """None rather than 0 when nobody has reviewed it. Zero is a rating somebody gave; absence
        is not, and a card that draws "0.0 stars" for an unreviewed file is telling a lie the data
        never said."""
        ratings = [review.rating for review in attachment.reviews.all()]
        return round(sum(ratings) / len(ratings), 2) if ratings else None


class AttachmentWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = ['file', 'title', 'description']
