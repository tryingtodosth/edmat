"""Two shapes of a desk, deliberately, and one of an item.

`CloakroomDeskSerializer` is what the clerk sees: racks, counts, free hooks. `PublicDeskSerializer`
is the "there is a cloakroom at the north entrance, it opens at 17:00" line an attendee reads, and
carries **nothing about what is on the racks** — how full a cloakroom is is operational data, and
the attendee-facing surface has no reason to hold it.
"""

from rest_framework import serializers

from .models import IDENTITY_KIND_CHOICES, MAX_RACKS, CloakroomDesk, CloakroomItem
from .rules import free_racks


class CloakroomItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = CloakroomItem
        fields = [
            'id', 'desk', 'rack_label', 'token', 'status', 'description',
            'deposited_at', 'returned_at', 'exception_identity_kind', 'exception_note',
        ]
        read_only_fields = fields


class PublicDeskSerializer(serializers.ModelSerializer):
    class Meta:
        model = CloakroomDesk
        fields = ['id', 'event', 'name', 'opens_note', 'status']
        read_only_fields = fields


class CloakroomDeskSerializer(serializers.ModelSerializer):
    racks = serializers.SerializerMethodField()
    free_racks = serializers.SerializerMethodField()
    stored_count = serializers.SerializerMethodField()
    returned_count = serializers.SerializerMethodField()
    unclaimed_count = serializers.SerializerMethodField()

    class Meta:
        model = CloakroomDesk
        fields = [
            'id', 'event', 'name', 'rack_labels', 'racks', 'free_racks', 'opens_note',
            'status', 'closed_at', 'stored_count', 'returned_count', 'unclaimed_count',
            'created_at',
        ]
        read_only_fields = ['id', 'event', 'status', 'closed_at', 'created_at']

    def validate_rack_labels(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('rack_labels must be a list of labels.')
        cleaned, seen = [], set()
        for raw in value:
            label = str(raw).strip()[:40]
            if label and label not in seen:
                seen.add(label)
                cleaned.append(label)
        if len(cleaned) > MAX_RACKS:
            raise serializers.ValidationError(f'A desk holds at most {MAX_RACKS} racks.')
        return cleaned

    def get_racks(self, desk) -> list[str]:
        return desk.racks()

    def get_free_racks(self, desk) -> list[str]:
        return free_racks(desk)

    # Three `COUNT`s over an indexed FK, recomputed on every read (house rule 5). A tally kept on
    # the desk row would be one missed code path away from a rail that disagrees with the screen.
    def get_stored_count(self, desk) -> int:
        return desk.items.filter(status='stored').count()

    def get_returned_count(self, desk) -> int:
        return desk.items.filter(status__in=['returned', 'returned_by_exception']).count()

    def get_unclaimed_count(self, desk) -> int:
        return desk.items.filter(status='unclaimed').count()


class DepositSerializer(serializers.Serializer):
    """What the Deposit form sends. The token is NOT among them — it is minted by the server and
    handed back, because a client-chosen bearer token is a client-chosen bearer token."""

    rack_label = serializers.CharField(max_length=40)
    description = serializers.CharField(max_length=200, required=False, allow_blank=True)


class ExceptionReturnSerializer(serializers.Serializer):
    description = serializers.CharField(max_length=200)
    identity_kind = serializers.ChoiceField(choices=[c[0] for c in IDENTITY_KIND_CHOICES])
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)
