"""What the rota says to whom.

**One serializer, two audiences, and the difference is not cosmetic.** A volunteer looking at a
shift sees who else is on it as "Anna K." and nothing else — no account id, no profile link, no
way to reach them (§6 rule 3, and R2 §3's own "hides peer phone/email contacts"). An organiser
sees the account id, because assigning and crediting are done by id while there is no people
search. That is why `masked` rides in the serializer context rather than being decided per field
name: one flag, set once by the view from `Event.can_organise`, and every person-shaped field in
this module reads it.
"""

from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from accounts.minors import is_minor
from events.registration import mask_name

from . import rules
from .models import (
    ASSIGNMENT_SOURCE_CHOICES,
    ASSIGNMENT_STATUS_CHOICES,
    COMMITTED_STATUSES,
    STATION_KIND_CHOICES,
    Assignment,
    Shift,
    Station,
    VolunteerRecord,
)


def _display_name(user) -> str:
    profile = getattr(user, 'profile', None)
    return profile.display_name if profile and profile.display_name else user.username


def person(user, *, masked: bool) -> dict:
    """The only shape a person takes anywhere in this app."""
    name = _display_name(user)
    if masked:
        return {'id': None, 'display_name': mask_name(name)}
    return {'id': str(user.pk), 'display_name': name}


class AssignmentSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    is_minor = serializers.SerializerMethodField()
    credited_hours = serializers.SerializerMethodField()

    class Meta:
        model = Assignment
        fields = [
            'id',
            'shift',
            'user',
            'status',
            'source',
            'claimed_at',
            'confirmed_at',
            'dropped_at',
            'drop_reason',
            'hours_credited',
            'credit_note',
            'credited_hours',
            'is_minor',
        ]

    def _masked(self) -> bool:
        return not self.context.get('can_organise', False)

    def get_user(self, assignment) -> dict:
        return person(assignment.user, masked=self._masked())

    def get_is_minor(self, assignment) -> bool | None:
        """Only an organiser is told. A co-volunteer's minor status is exactly what R2 §3 lists as
        hidden from peers, and it is the one field a badge would leak into a room."""
        if self._masked():
            return None
        return is_minor(assignment.user)

    def get_credited_hours(self, assignment) -> str:
        return str(assignment.credited_hours)


class ShiftSerializer(serializers.ModelSerializer):
    station_name = serializers.CharField(source='station.name', read_only=True)
    station_kind = serializers.CharField(source='station.kind', read_only=True)
    location_text = serializers.CharField(source='station.location_text', read_only=True)
    briefing_note = serializers.CharField(source='station.briefing_note', read_only=True)
    hours = serializers.SerializerMethodField()
    confirmed_count = serializers.SerializerMethodField()
    claimed_count = serializers.SerializerMethodField()
    is_short = serializers.SerializerMethodField()
    needs_adult = serializers.SerializerMethodField()
    assignments = serializers.SerializerMethodField()
    my_assignment = serializers.SerializerMethodField()
    claim_block_reason = serializers.SerializerMethodField()
    can_claim = serializers.SerializerMethodField()
    drop_block_reason = serializers.SerializerMethodField()

    class Meta:
        model = Shift
        fields = [
            'id',
            'station',
            'station_name',
            'station_kind',
            'location_text',
            'briefing_note',
            'starts_at',
            'ends_at',
            'hours',
            'needed',
            'note',
            'follows_session',
            'confirmed_count',
            'claimed_count',
            'is_short',
            'needs_adult',
            'assignments',
            'my_assignment',
            'claim_block_reason',
            'can_claim',
            'drop_block_reason',
        ]

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def _live(self, shift):
        return [a for a in shift.assignments.all() if a.status != 'dropped']

    def get_hours(self, shift) -> str:
        return str(shift.hours)

    def get_confirmed_count(self, shift) -> int:
        return sum(1 for a in self._live(shift) if a.status in ('confirmed', 'done'))

    def get_claimed_count(self, shift) -> int:
        return sum(1 for a in self._live(shift) if a.status == 'claimed')

    def get_is_short(self, shift) -> bool:
        return self.get_confirmed_count(shift) < shift.needed

    def get_needs_adult(self, shift) -> bool:
        if not shift.station.requires_adult:
            return False
        committed = [a for a in self._live(shift) if a.status in COMMITTED_STATUSES]
        if not committed:
            return False
        return not any(not is_minor(a.user) for a in committed)

    def get_assignments(self, shift) -> list:
        serializer = AssignmentSerializer(self._live(shift), many=True, context=self.context)
        return serializer.data

    def get_my_assignment(self, shift):
        user = self._user()
        if not (user and user.is_authenticated):
            return None
        for assignment in self._live(shift):
            if assignment.user_id == user.pk:
                return AssignmentSerializer(assignment, context=self.context).data
        return None

    def get_claim_block_reason(self, shift):
        return rules.claim_block_reason(self._user(), shift)

    def get_can_claim(self, shift) -> bool:
        return rules.claim_block_reason(self._user(), shift) not in rules.HARD_REASONS

    def get_drop_block_reason(self, shift):
        user = self._user()
        if not (user and user.is_authenticated):
            return None
        for assignment in self._live(shift):
            if assignment.user_id == user.pk:
                return rules.drop_block_reason(user, assignment)
        return None


class StationSerializer(serializers.ModelSerializer):
    shifts = ShiftSerializer(many=True, read_only=True)
    session_title = serializers.SerializerMethodField()

    class Meta:
        model = Station
        fields = [
            'id',
            'event',
            'kind',
            'name',
            'location_text',
            'session',
            'session_title',
            'briefing_note',
            'minors_permitted',
            'requires_adult',
            'needs_confirmation',
            'order',
            'shifts',
        ]
        read_only_fields = ['event']

    def get_session_title(self, station) -> str:
        return station.session.title if station.session_id else ''


class StationWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Station
        fields = [
            'kind',
            'name',
            'location_text',
            'session',
            'briefing_note',
            'minors_permitted',
            'requires_adult',
            'needs_confirmation',
            'order',
        ]

    def validate(self, attrs):
        event = self.context['event']
        session = attrs.get('session', getattr(self.instance, 'session', None))
        if session is not None and session.event_id != event.pk:
            raise serializers.ValidationError({'session': 'That session belongs to a different event.'})
        minors = attrs.get(
            'minors_permitted', getattr(self.instance, 'minors_permitted', False)
        )
        requires_adult = attrs.get(
            'requires_adult', getattr(self.instance, 'requires_adult', False)
        )
        if requires_adult and not minors:
            raise serializers.ValidationError(
                {'requires_adult': 'Adult supervision only means something where minors are permitted.'}
            )
        return attrs


class ShiftWriteSerializer(serializers.ModelSerializer):
    """`starts_at`/`ends_at` are optional **only** on a station bound to a session: leaving them out
    is how an organiser says "this shift is that session", and `follows_session` is what makes the
    signal move it later."""

    class Meta:
        model = Shift
        fields = ['starts_at', 'ends_at', 'needed', 'note']
        extra_kwargs = {
            'starts_at': {'required': False},
            'ends_at': {'required': False},
        }

    def validate(self, attrs):
        station = self.context['station']
        starts = attrs.get('starts_at', getattr(self.instance, 'starts_at', None))
        ends = attrs.get('ends_at', getattr(self.instance, 'ends_at', None))
        if starts is None or ends is None:
            if station.session_id is None:
                raise serializers.ValidationError(
                    {'starts_at': 'A shift needs its own hours unless its station follows a session.'}
                )
            attrs['starts_at'] = station.session.starts_at
            attrs['ends_at'] = station.session.ends_at
            attrs['follows_session'] = True
        elif ends <= starts:
            raise serializers.ValidationError({'ends_at': 'A shift has to end after it starts.'})
        if attrs.get('needed', getattr(self.instance, 'needed', 1)) < 1:
            raise serializers.ValidationError({'needed': 'A shift needs at least one person.'})
        return attrs


class VolunteerRecordSerializer(serializers.ModelSerializer):
    """Organiser-facing only — it is the one place in this app where a full name is deliberate."""

    user = serializers.SerializerMethodField()
    is_minor = serializers.SerializerMethodField()
    hours = serializers.SerializerMethodField()
    has_consent = serializers.SerializerMethodField()

    class Meta:
        model = VolunteerRecord
        fields = [
            'id',
            'event',
            'user',
            'is_minor',
            'has_consent',
            'consent_recorded_at',
            'consent_note',
            'vetting_checked_at',
            'vetting_reference',
            'emergency_contact_note',
            'hours',
        ]
        read_only_fields = ['event']

    def get_user(self, record) -> dict:
        return person(record.user, masked=False)

    def get_is_minor(self, record) -> bool:
        return is_minor(record.user)

    def get_has_consent(self, record) -> bool:
        return record.consent_recorded_at is not None

    def get_hours(self, record) -> str:
        return str(rules.hours_for(record.user, record.event))


class VolunteerRecordWriteSerializer(serializers.ModelSerializer):
    user = serializers.IntegerField(write_only=True, required=False)
    #: A checkbox rather than a datetime, because what an organiser knows is "I have seen the form",
    #: not the instant they saw it — the instant is `timezone.now()` and the person is the request.
    consent_recorded = serializers.BooleanField(required=False)
    vetting_checked = serializers.BooleanField(required=False)

    class Meta:
        model = VolunteerRecord
        fields = [
            'user',
            'consent_recorded',
            'consent_note',
            'vetting_checked',
            'vetting_reference',
            'emergency_contact_note',
        ]

    def apply(self, record, validated, by):
        if 'consent_recorded' in validated:
            if validated['consent_recorded'] and record.consent_recorded_at is None:
                record.consent_recorded_at = timezone.now()
                record.consent_recorded_by = by
            elif not validated['consent_recorded']:
                record.consent_recorded_at = None
                record.consent_recorded_by = None
        if 'vetting_checked' in validated:
            record.vetting_checked_at = timezone.now() if validated['vetting_checked'] else None
        for field in ('consent_note', 'vetting_reference', 'emergency_contact_note'):
            if field in validated:
                setattr(record, field, validated[field])
        record.save()
        return record


class CreditSerializer(serializers.Serializer):
    """Marking an assignment `done`, optionally overriding what it is worth."""

    assignment = serializers.IntegerField()
    hours = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)

    def validate_hours(self, value):
        if value is not None and (value < Decimal('0') or value > Decimal('24')):
            raise serializers.ValidationError('Credited hours have to be between 0 and 24.')
        return value


STATION_KINDS = [k for k, _ in STATION_KIND_CHOICES]
ASSIGNMENT_STATUSES = [s for s, _ in ASSIGNMENT_STATUS_CHOICES]
ASSIGNMENT_SOURCES = [s for s, _ in ASSIGNMENT_SOURCE_CHOICES]
