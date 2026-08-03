from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from services.models import Service

from .availability import is_offered_slot
from .models import (
    EXCEPTION_KIND_CHOICES,
    AvailabilityException,
    AvailabilityRule,
    Booking,
)


class AvailabilityRuleSerializer(serializers.ModelSerializer):
    """`tutor` is never accepted from the client — it is always the caller, set by the view, the
    same "who owns this" convention every other write endpoint in this app follows."""

    class Meta:
        model = AvailabilityRule
        fields = ['id', 'service', 'weekday', 'start_time', 'end_time', 'created_at']

    def validate_service(self, service):
        # A rule narrowing availability to *somebody else's* listing is meaningless, and would be a
        # way to write rows referencing a listing you have nothing to do with. Null (the common case,
        # "all of my offerings") skips this entirely.
        request = self.context.get('request')
        if service is not None and request is not None and service.provider_id != request.user.pk:
            raise serializers.ValidationError('You can only scope a rule to your own listing.')
        return service

    def validate(self, attrs):
        # Model.clean() is not called by DRF, so the rule lives here as well as there — the model
        # copy still matters for the admin and for any future management command, and this copy is
        # what turns it into a real 400 rather than a database row nobody can produce a slot from.
        start = attrs.get('start_time', getattr(self.instance, 'start_time', None))
        end = attrs.get('end_time', getattr(self.instance, 'end_time', None))
        if start is not None and end is not None and start >= end:
            raise serializers.ValidationError(
                {'end_time': ['The end of a window must be after its start.']}
            )
        return attrs


class AvailabilityExceptionSerializer(serializers.ModelSerializer):
    kind = serializers.ChoiceField(choices=EXCEPTION_KIND_CHOICES, default='block')

    class Meta:
        model = AvailabilityException
        fields = ['id', 'date', 'kind', 'start_time', 'end_time', 'note', 'created_at']

    def validate(self, attrs):
        kind = attrs.get('kind', getattr(self.instance, 'kind', 'block'))
        start = attrs.get('start_time', getattr(self.instance, 'start_time', None))
        end = attrs.get('end_time', getattr(self.instance, 'end_time', None))

        if (start is None) != (end is None):
            raise serializers.ValidationError(
                {'end_time': ['Give both a start and an end time, or neither for the whole day.']}
            )
        if start is not None and start >= end:
            raise serializers.ValidationError(
                {'end_time': ['The end of a window must be after its start.']}
            )
        # An all-day *opening* would be a claim to be free from midnight to midnight, which nobody
        # means and which would quietly publish twenty-four hours of slots. An all-day *block* is
        # exactly what somebody means by "I'm away on the 14th", so only the one kind is refused.
        if kind == 'open' and start is None:
            raise serializers.ValidationError(
                {'start_time': ['Extra availability needs a start and end time.']}
            )
        return attrs


class SlotSerializer(serializers.Serializer):
    start = serializers.DateTimeField()
    end = serializers.DateTimeField()


class BookingSerializer(serializers.ModelSerializer):
    """The read shape, for both sides of a booking. Names rather than bare ids for the counterpart,
    so a schedule row is legible without a second fan-out of user lookups — the same reasoning
    ServiceSerializer's own `provider_display_name` already records."""

    service_title = serializers.CharField(source='service.title', read_only=True)
    tutor_display_name = serializers.SerializerMethodField()
    student_display_name = serializers.SerializerMethodField()
    # What the OTHER party would need to see to make sense of a clash, computed only where it is
    # actually relevant (see `get_overlapping_count`).
    overlapping_count = serializers.SerializerMethodField()
    availability_mode = serializers.CharField(source='service.availability_mode', read_only=True)

    class Meta:
        model = Booking
        fields = [
            'id',
            'service',
            'service_title',
            'availability_mode',
            'tutor',
            'tutor_display_name',
            'student',
            'student_display_name',
            'starts_at',
            'ends_at',
            'status',
            'student_note',
            'tutor_note',
            'cancelled_by',
            'decided_at',
            'overlapping_count',
            'created_at',
        ]
        read_only_fields = fields

    def _display_name(self, user):
        profile = getattr(user, 'profile', None)
        return (profile.display_name if profile and profile.display_name else user.username)

    def get_tutor_display_name(self, obj):
        return self._display_name(obj.tutor)

    def get_student_display_name(self, obj):
        return self._display_name(obj.student)

    def get_overlapping_count(self, obj):
        """How many OTHER live bookings of this tutor's collide with this one.

        Only ever computed for the tutor's own view (`context['as_tutor']`), and deliberately so:
        this is a window onto the tutor's whole calendar across every listing they run, which is
        exactly the thing a student must not be shown — most of all in `declared` mode, where the
        entire point is that the tutor's real load stays private. For a student it is always 0.

        A plain count rather than the rows themselves: the tutor needs to know that a decision is
        contested before they take it, and the detail is one click away in their own schedule.
        """
        if not self.context.get('as_tutor'):
            return 0
        from .availability import overlapping_open

        return overlapping_open(obj).count()


class BookingCreateSerializer(serializers.Serializer):
    """Asking for a session. Deliberately not a ModelSerializer: almost nothing here comes from the
    client. The student supplies a listing, a start time and (optionally) a note — the tutor, the end
    time and the status are all derived, because each is a thing a client should not be able to
    state."""

    service = serializers.PrimaryKeyRelatedField(queryset=Service.objects.all())
    starts_at = serializers.DateTimeField()
    student_note = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def validate(self, attrs):
        request = self.context['request']
        service = attrs['service']
        starts_at = attrs['starts_at']

        if service.provider_id == request.user.pk:
            raise serializers.ValidationError(
                {'service': ['You cannot book a session with yourself.']}
            )
        # A paused listing is not on offer. Without this a stale link (or a listing paused between
        # the page loading and the click) would still take bookings the tutor thought they had
        # withdrawn.
        if not service.is_active:
            raise serializers.ValidationError({'service': ['This listing is not taking bookings.']})
        if starts_at <= timezone.now():
            raise serializers.ValidationError({'starts_at': ['That time has already passed.']})

        # The whole of both modes' booking semantics, in one call — see is_offered_slot's own docs.
        # In `derived` mode a slot somebody else already asked for is not in the published list, so
        # this refuses it; in `declared` mode it still is, so the same code accepts the second
        # request and leaves the tutor to sort it out.
        if not is_offered_slot(service, starts_at):
            if service.availability_mode == 'derived':
                raise serializers.ValidationError(
                    {'starts_at': ['That slot is no longer available. Please pick another.']}
                )
            raise serializers.ValidationError(
                {'starts_at': ['That is not one of the times this tutor offers.']}
            )
        return attrs

    def create(self, validated_data):
        service = validated_data['service']
        starts_at = validated_data['starts_at']
        return Booking.objects.create(
            service=service,
            tutor=service.provider,
            student=self.context['request'].user,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=service.session_minutes),
            student_note=validated_data.get('student_note', ''),
            status='requested',
        )
