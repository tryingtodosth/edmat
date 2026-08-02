from rest_framework import serializers

from taxonomy.models import Course as Subject, Field

from .models import (
    ACTIVE_ENROLLMENT_STATUSES,
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
        user = self._user()
        enrollment = self._my_enrollment(course)
        is_participant = bool(
            (enrollment and enrollment.status in ACTIVE_ENROLLMENT_STATUSES)
            or (user and user.is_authenticated and course.instructor_id == user.pk)
        )
        return LessonSerializer(
            course.lessons.all(), many=True, context={**self.context, 'is_participant': is_participant}
        ).data

    def get_my_enrollment_status(self, course) -> str | None:
        enrollment = self._my_enrollment(course)
        return enrollment.status if enrollment else None

    def get_is_instructor(self, course) -> bool:
        user = self._user()
        return bool(user and user.is_authenticated and course.instructor_id == user.pk)

    def get_enrollment_block_reason(self, course) -> str | None:
        return course.enrollment_block_reason(self._user())

    def get_can_enrol(self, course) -> bool:
        return course.enrollment_block_reason(self._user()) is None


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
            'requested_at',
            'decided_at',
        ]
