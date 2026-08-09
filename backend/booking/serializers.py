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
    WeekSchedule,
    WeekScheduleWindow,
    WeekTemplate,
    WeekTemplateWindow,
    monday_of,
)

#: How many weeks one bulk apply may write. A year, which is past any real term and far short of the
#: horizon at which a schedule is a guess (see availability.MAX_HORIZON_DAYS for the same argument
#: made about reading). A bound rather than none at all because this is the one endpoint here whose
#: cost is set by a number the client picks.
MAX_APPLY_WEEKS = 52


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


class ScheduleWindowSerializer(serializers.Serializer):
    """One window inside a template or a stored week. A plain Serializer, not a ModelSerializer,
    because both parents write their windows as a whole list rather than one row at a time — see
    `normalise_windows` for why the list is the unit."""

    weekday = serializers.IntegerField(min_value=0, max_value=6)
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()
    service = serializers.PrimaryKeyRelatedField(
        queryset=Service.objects.all(), required=False, allow_null=True
    )

    def validate_service(self, service):
        # Same check AvailabilityRuleSerializer already makes, and for the same reason: narrowing to
        # somebody else's listing is meaningless, and would be a way to write rows referencing a
        # listing you have nothing to do with.
        request = self.context.get('request')
        if service is not None and request is not None and service.provider_id != request.user.pk:
            raise serializers.ValidationError('You can only scope hours to your own listing.')
        return service

    def validate(self, attrs):
        if attrs['start_time'] >= attrs['end_time']:
            raise serializers.ValidationError(
                {'end_time': ['The end of a window must be after its start.']}
            )
        return attrs


def normalise_windows(windows: list[dict]) -> list[dict]:
    """Merge overlapping and touching windows within each (weekday, listing), in order.

    **Done on write, unlike the repeating rules, and the difference is the editor.** These windows are
    produced by dragging on a calendar, and `_merge` already unions overlapping intervals on the way
    out — so two dragged blocks at 10–12 and 11–13 are drawn as one 10–13 band. Storing them as two
    rows would mean the next load redrew two overlapping blocks on top of each other, i.e. the editor
    disagreeing with the calendar it is drawing on. Merging here keeps the stored week identical to
    the week on screen, which is the only version of this a person can reason about.

    Grouped by listing as well as weekday, because two windows narrowed to different offerings are
    not the same hours twice — merging those would silently widen one of them.
    """
    grouped: dict[tuple[int, int | None], list[dict]] = {}
    for window in windows:
        service = window.get('service')
        key = (window['weekday'], service.pk if service is not None else None)
        grouped.setdefault(key, []).append(window)

    merged: list[dict] = []
    for (weekday, _service_pk), group in grouped.items():
        group.sort(key=lambda w: w['start_time'])
        current = dict(group[0])
        for window in group[1:]:
            if window['start_time'] <= current['end_time']:
                current['end_time'] = max(current['end_time'], window['end_time'])
            else:
                merged.append(current)
                current = dict(window)
        merged.append(current)
    merged.sort(key=lambda w: (w['weekday'], w['start_time']))
    return merged


class WeekTemplateSerializer(serializers.ModelSerializer):
    """A named week shape. `windows` is always written as a complete list — a full replace, matching
    how the editor works (it submits the week it is showing) and how this project's other list-shaped
    editors already behave."""

    windows = ScheduleWindowSerializer(many=True)

    class Meta:
        model = WeekTemplate
        fields = ['id', 'name', 'windows', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_name(self, name):
        name = name.strip()
        if not name:
            raise serializers.ValidationError('Give the template a name.')
        request = self.context.get('request')
        if request is not None:
            clash = WeekTemplate.objects.filter(tutor=request.user, name__iexact=name)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                # Rejected rather than silently suffixed: a tutor who saves "Teaching weeks" twice
                # means to replace one, and quietly ending up with two called almost the same thing
                # is how the wrong one gets applied later.
                raise serializers.ValidationError('You already have a template with that name.')
        return name

    def create(self, validated_data):
        windows = normalise_windows(validated_data.pop('windows', []))
        template = WeekTemplate.objects.create(**validated_data)
        _write_windows(WeekTemplateWindow, template=template, windows=windows)
        return template

    def update(self, instance, validated_data):
        windows = validated_data.pop('windows', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if windows is not None:
            instance.windows.all().delete()
            _write_windows(WeekTemplateWindow, template=instance, windows=normalise_windows(windows))
        return instance


class WeekScheduleSerializer(serializers.ModelSerializer):
    """One week that does not follow the repeating pattern.

    `week_start` is normalised to its Monday by the model, so a client that sends any day of the week
    lands on the right row rather than creating a second, invisible one keyed to a Tuesday.
    """

    windows = ScheduleWindowSerializer(many=True)
    source_template_name = serializers.CharField(
        source='source_template.name', read_only=True, default=''
    )

    class Meta:
        model = WeekSchedule
        fields = [
            'id',
            'week_start',
            'source_template',
            'source_template_name',
            'windows',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_source_template(self, template):
        request = self.context.get('request')
        if template is not None and request is not None and template.tutor_id != request.user.pk:
            raise serializers.ValidationError('That is not one of your templates.')
        return template

    def create(self, validated_data):
        windows = normalise_windows(validated_data.pop('windows', []))
        tutor = validated_data.pop('tutor')
        week_start = monday_of(validated_data.pop('week_start'))
        # Upsert rather than 400 on a second POST for the same week. The editor's own "detach this
        # week" is idempotent by nature — a tutor clicking it twice, or two tabs both saving, means
        # one detached week either way, and a uniqueness error there would be a wall with nothing
        # behind it.
        schedule, _created = WeekSchedule.objects.update_or_create(
            tutor=tutor, week_start=week_start, defaults=validated_data
        )
        schedule.windows.all().delete()
        _write_windows(WeekScheduleWindow, schedule=schedule, windows=windows)
        return schedule

    def update(self, instance, validated_data):
        windows = validated_data.pop('windows', None)
        validated_data.pop('week_start', None)  # a stored week does not move; delete and re-detach
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if windows is not None:
            instance.windows.all().delete()
            _write_windows(
                WeekScheduleWindow, schedule=instance, windows=normalise_windows(windows)
            )
        return instance


def _write_windows(model, *, windows: list[dict], **parent) -> None:
    model.objects.bulk_create(
        [
            model(
                **parent,
                weekday=window['weekday'],
                start_time=window['start_time'],
                end_time=window['end_time'],
                service=window.get('service'),
            )
            for window in windows
        ]
    )


class WeekApplySerializer(serializers.Serializer):
    """"Use this week for the next five weeks" — the bulk operation, stated as a source, a first
    target week and a count.

    A count of weeks rather than an end date, because that is how the decision is actually made ("the
    rest of term is six more weeks"), and because it cannot express an empty or backwards range.
    """

    source_template = serializers.PrimaryKeyRelatedField(
        queryset=WeekTemplate.objects.all(), required=False, allow_null=True
    )
    source_week = serializers.DateField(required=False, allow_null=True)
    week_start = serializers.DateField()
    weeks = serializers.IntegerField(min_value=1, max_value=MAX_APPLY_WEEKS)
    # Default true because that is the plain reading of "use this for the next five weeks". Offered
    # as a choice at all because the alternative — silently discarding a week somebody had already
    # hand-edited — is exactly the kind of destructive default worth making somebody opt into.
    overwrite = serializers.BooleanField(default=True)

    def validate_source_template(self, template):
        request = self.context.get('request')
        if template is not None and request is not None and template.tutor_id != request.user.pk:
            raise serializers.ValidationError('That is not one of your templates.')
        return template

    def validate(self, attrs):
        has_template = attrs.get('source_template') is not None
        has_week = attrs.get('source_week') is not None
        if has_template == has_week:
            raise serializers.ValidationError(
                {'source_week': ['Give exactly one of a template or a week to copy from.']}
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
