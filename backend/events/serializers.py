from rest_framework import serializers

from taxonomy.models import Course as Subject, Field

from .models import ATTENDING_STATUSES, Event, EventAttendance


class PersonSerializer(serializers.Serializer):
    """Just enough to name somebody, identical in shape to `classroom.ParticipantSerializer`.

    Duplicated rather than imported across app boundaries on purpose: `classroom` and `events` are
    independent apps, and an import in this direction would make the event API's own response shape
    hostage to a change somebody makes for a course roster. It is eight lines, and the alternative is
    a shared "who is this person" app that does not exist yet and that neither app is asking for.
    """

    id = serializers.IntegerField(source='pk', read_only=True)
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, user) -> str:
        profile = getattr(user, 'profile', None)
        return profile.display_name if profile and profile.display_name else user.username


class EventAttendanceSerializer(serializers.ModelSerializer):
    attendee = PersonSerializer(read_only=True)

    class Meta:
        model = EventAttendance
        fields = ['id', 'attendee', 'status', 'note', 'responded_at']


class EventSerializer(serializers.ModelSerializer):
    host = PersonSerializer(read_only=True)
    subject_slugs = serializers.SlugRelatedField(
        source='subjects', slug_field='slug', many=True, read_only=True
    )
    field_slug = serializers.SlugRelatedField(source='field', slug_field='slug', read_only=True)

    ends_at = serializers.DateTimeField(read_only=True)
    is_past = serializers.BooleanField(read_only=True)
    going_count = serializers.SerializerMethodField()
    seats_left = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)

    # The viewer's own relationship to this event, all resolved server-side. The client should never
    # work out "may I answer this?" for itself — a client that computes a permission is a client that
    # can compute it wrongly, which is the same reasoning `TaughtCourseSerializer` records for
    # `can_enrol`.
    my_attendance = serializers.SerializerMethodField()
    is_host = serializers.SerializerMethodField()
    can_respond = serializers.SerializerMethodField()
    response_block_reason = serializers.SerializerMethodField()
    # Present for the host, absent (0) for everybody else — a decline is between the person who made
    # it and the person running the event.
    declined_count = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            'id',
            'host',
            'title',
            'summary',
            'description',
            'subject_slugs',
            'field_slug',
            'status',
            'starts_at',
            'ends_at',
            'duration_minutes',
            'location_kind',
            'location_text',
            'online_url',
            'capacity',
            'language',
            'going_count',
            'declined_count',
            'seats_left',
            'is_full',
            'is_past',
            'my_attendance',
            'is_host',
            'can_respond',
            'response_block_reason',
            'created_at',
        ]

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def get_going_count(self, event) -> int:
        return event.going_count()

    def get_declined_count(self, event) -> int:
        user = self._user()
        if user and user.is_authenticated and event.host_id == user.pk:
            return event.declined_count()
        return 0

    def get_is_host(self, event) -> bool:
        user = self._user()
        return bool(user and user.is_authenticated and event.host_id == user.pk)

    def get_my_attendance(self, event) -> str | None:
        user = self._user()
        if not (user and user.is_authenticated):
            return None
        row = event.attendances.filter(attendee=user).first()
        return row.status if row else None

    def get_can_respond(self, event) -> bool:
        return event.response_block_reason(self._user()) is None

    def get_response_block_reason(self, event) -> str | None:
        return event.response_block_reason(self._user())


class EventWriteSerializer(serializers.ModelSerializer):
    """Writes take slugs, not primary keys, for the taxonomy relations — the client already knows a
    subject by its slug everywhere else in this API, and making it look up an integer id first would
    be a round trip for nothing. Same shape `TaughtCourseWriteSerializer` uses."""

    subject_slugs = serializers.SlugRelatedField(
        source='subjects',
        slug_field='slug',
        many=True,
        required=False,
        queryset=Subject.objects.all(),
    )
    field_slug = serializers.SlugRelatedField(
        source='field',
        slug_field='slug',
        required=False,
        allow_null=True,
        queryset=Field.objects.all(),
    )

    class Meta:
        model = Event
        fields = [
            'title',
            'summary',
            'description',
            'subject_slugs',
            'field_slug',
            'status',
            'starts_at',
            'duration_minutes',
            'location_kind',
            'location_text',
            'online_url',
            'capacity',
            'language',
        ]

    def validate(self, attrs):
        """Runs the model's own `clean()` rather than restating its rules here.

        Restating them is how the API and the admin drift apart: somebody adds a rule in one place,
        and the other silently keeps accepting what it always did. Building an unsaved instance from
        the merged attributes is the only way to check a PATCH against the fields it is *not*
        changing — validating `location_kind='hybrid'` alone would otherwise pass on an event whose
        stored `online_url` is empty.
        """
        merged = {
            field: attrs.get(field, getattr(self.instance, field, None))
            for field in ('location_kind', 'location_text', 'online_url', 'duration_minutes')
        }
        probe = Event(**{k: v for k, v in merged.items() if v is not None})
        # `full_clean` would also demand the fields this probe deliberately does not carry (title,
        # starts_at, host), so only the cross-field rules are run.
        probe.clean()
        return attrs

    def validate_status(self, value):
        """Cancelling is a decision with consequences — it notifies everybody who said they were
        coming — so it goes through its own endpoint rather than being a value somebody can PATCH in
        passing. Un-cancelling is refused for the same reason in reverse: telling forty people it is
        back on is not something to do by editing a dropdown."""
        if value == 'cancelled':
            raise serializers.ValidationError('Use the cancel action to call an event off.')
        if self.instance and self.instance.status == 'cancelled':
            raise serializers.ValidationError('A cancelled event cannot be reopened.')
        return value


class AttendanceWriteSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['going', 'not_going'])
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


#: Re-exported so views can talk about "a seat" without importing the model constant separately.
__all__ = [
    'ATTENDING_STATUSES',
    'AttendanceWriteSerializer',
    'EventAttendanceSerializer',
    'EventSerializer',
    'EventWriteSerializer',
    'PersonSerializer',
]
