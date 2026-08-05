from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation
from taxonomy.models import Course as Subject, Field

from .models import (
    ACTIVE_ENROLLMENT_STATUSES,
    Chapter,
    CourseInvite,
    CourseItem,
    CourseStaff,
    Enrollment,
    Lesson,
    TaughtCourse,
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


class LessonSerializer(serializers.ModelSerializer):
    exercise_ids = serializers.PrimaryKeyRelatedField(
        source='exercises', many=True, read_only=True
    )
    material_ids = serializers.PrimaryKeyRelatedField(
        source='materials', many=True, read_only=True
    )
    participant_notes = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = [
            'id',
            'title',
            'description',
            'order',
            'scheduled_at',
            'duration_minutes',
            'exercise_ids',
            'material_ids',
            'participant_notes',
        ]

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
            'title',
            'description',
            'order',
            'scheduled_at',
            'duration_minutes',
            'exercises',
            'materials',
            'participant_notes',
        ]


class TaughtCourseSerializer(serializers.ModelSerializer):
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
        model = TaughtCourse
        fields = [
            'id',
            'instructor',
            'title',
            'summary',
            'description',
            'subject_slugs',
            'field_slug',
            'status',
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

    def get_lessons(self, course):
        enrollment = self._my_enrollment(course)
        # "In the room" now includes every member of staff, not only the owner — an assistant who
        # cannot read the lesson notes they are supposed to be teaching from is not an assistant.
        is_participant = bool(
            (enrollment and enrollment.status in ACTIVE_ENROLLMENT_STATUSES)
            or course.is_staff_member(self._user())
        )
        return LessonSerializer(
            course.lessons.all(), many=True, context={**self.context, 'is_participant': is_participant}
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
        return ChapterSerializer(course.chapters.all(), many=True, context=self.context).data

    def get_unfiled_items(self, course):
        """Content in the course but in no chapter.

        Its own field rather than a nameless chapter, because "not filed yet" is a real state — it is
        where a participant's submission lands before anybody decides which week it belongs to, and a
        course that uses no chapters at all keeps everything here quite legitimately.
        """
        user = self._user()
        visible = [
            item
            for item in course.items.all()
            if item.chapter_id is None and item.is_visible_to(user)
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


class TaughtCourseWriteSerializer(serializers.ModelSerializer):
    # Referred to by their slugs rather than their numeric pks, matching how the rest of this API
    # already addresses taxonomy rows (`Service.course_slugs`) — a client that has a course page
    # open knows its slug, not its id.
    subjects = serializers.SlugRelatedField(
        slug_field='slug', many=True, required=False, queryset=Subject.objects.all()
    )
    field = serializers.SlugRelatedField(
        slug_field='slug', required=False, allow_null=True, queryset=Field.objects.all()
    )

    class Meta:
        model = TaughtCourse
        fields = [
            'title',
            'summary',
            'description',
            'subjects',
            'field',
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
            'chapter',
            'material',
            'exercise',
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
        """
        if item.material_id:
            translation = resolve_translation(
                item.material.translations, request_locale(self.context)
            )
            return translation.title if translation else item.material.slug
        return str(item.exercise)


class CourseItemWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseItem
        fields = ['chapter', 'material', 'exercise', 'order', 'note']

    def validate(self, attrs):
        material = attrs.get('material', getattr(self.instance, 'material', None))
        exercise = attrs.get('exercise', getattr(self.instance, 'exercise', None))
        if bool(material) == bool(exercise):
            raise serializers.ValidationError(
                'Reference exactly one of material or exercise.'
            )
        # A chapter from another course would file this item somewhere its own course cannot see.
        # The database cannot express that constraint across two hops, so it is checked here.
        chapter = attrs.get('chapter')
        course = self.context.get('course')
        if chapter and course and chapter.course_id != course.pk:
            raise serializers.ValidationError({'chapter': 'That chapter belongs to another course.'})
        return attrs


class ChapterSerializer(serializers.ModelSerializer):
    is_unlocked = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()

    class Meta:
        model = Chapter
        fields = ['id', 'title', 'description', 'order', 'unlocks_at', 'is_unlocked', 'items']

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

    def get_items(self, chapter):
        user = self._user()
        if not chapter.is_visible_to(user):
            # The chapter still renders — title, description and unlock date — but its contents do
            # not. That is the whole point of a locked chapter: you can see that week 3 exists.
            return []
        visible = [item for item in chapter.items.all() if item.is_visible_to(user)]
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
