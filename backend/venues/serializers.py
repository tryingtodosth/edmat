"""Read and write shapes for `/api/venues/`, `/api/rooms/`, `/api/room-bookings/`, the checklist
templates and one event's checklist.

Two conventions this file holds to, both from `backend/CLAUDE.md`:

- **A read serializer and a write serializer are different classes** wherever a write takes a
  different shape from a read (the booking's `room_id`, the item's `status` + evidence).
- **DRF derives uniqueness validators from `unique_together` but NOT from `Meta.constraints`**, so
  every constraint declared as a `UniqueConstraint` in `models.py` gets its own explicit check here
  — otherwise a duplicate is a 500 instead of a 400.
"""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import (
    ChecklistInstance,
    ChecklistInstanceItem,
    ChecklistTemplate,
    ChecklistTemplateItem,
    Room,
    RoomBooking,
    Venue,
    VenueStaff,
)

User = get_user_model()


class PersonSerializer(serializers.Serializer):
    """The one person shape every response here uses. A display name and an id, never an email —
    a building's staff list is read by organisers who are not in that building."""

    id = serializers.IntegerField()
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, obj) -> str:
        profile = getattr(obj, 'profile', None)
        return (getattr(profile, 'display_name', '') or obj.get_username()) if obj else ''


class RoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = Room
        fields = [
            'id',
            'venue_id',
            'name',
            'number',
            'floor',
            'seated_capacity',
            'fire_capacity',
            'has_av',
            'accessible',
            'notes',
            'is_active',
        ]
        read_only_fields = ['id', 'venue_id']


class RoomWriteSerializer(serializers.ModelSerializer):
    venue_id = serializers.PrimaryKeyRelatedField(
        source='venue', queryset=Venue.objects.all(), required=False
    )

    class Meta:
        model = Room
        fields = [
            'venue_id',
            'name',
            'number',
            'floor',
            'seated_capacity',
            'fire_capacity',
            'has_av',
            'accessible',
            'notes',
            'is_active',
        ]

    def validate(self, attrs):
        """Runs the model's own `clean()` over the MERGED attributes rather than restating the rule,
        so a PATCH that raises `seated_capacity` alone is still checked against the stored
        `fire_capacity` — the shape `EventWriteSerializer.validate` already argues for."""
        merged = Room(
            venue=attrs.get('venue', getattr(self.instance, 'venue', None)),
            name=attrs.get('name', getattr(self.instance, 'name', '')),
            seated_capacity=attrs.get(
                'seated_capacity', getattr(self.instance, 'seated_capacity', 0)
            ),
            fire_capacity=attrs.get('fire_capacity', getattr(self.instance, 'fire_capacity', 0)),
        )
        merged.clean()
        return attrs


class VenueStaffSerializer(serializers.ModelSerializer):
    user = PersonSerializer(read_only=True)
    added_by = PersonSerializer(read_only=True)

    class Meta:
        model = VenueStaff
        fields = ['id', 'user', 'role', 'added_by', 'added_at']


class VenueStaffWriteSerializer(serializers.Serializer):
    """By account id, because there is no people search yet (root `CLAUDE.md`, known gaps). Said
    here rather than silently accepted: the id box on the frontend is a placeholder for a picker."""

    user_id = serializers.IntegerField()
    role = serializers.ChoiceField(choices=['administrator', 'porter'], default='administrator')

    def validate_user_id(self, value):
        if not User.objects.filter(pk=value).exists():
            raise serializers.ValidationError('No account with that id.')
        return value


class VenueSummarySerializer(serializers.ModelSerializer):
    room_count = serializers.SerializerMethodField()

    class Meta:
        model = Venue
        fields = ['id', 'name', 'slug', 'address', 'is_active', 'room_count']

    def get_room_count(self, venue) -> int:
        # A `COUNT`, never a stored number (house rule 5).
        return venue.rooms.filter(is_active=True).count()


class VenueSerializer(serializers.ModelSerializer):
    rooms = serializers.SerializerMethodField()
    can_administer = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Venue
        fields = [
            'id',
            'name',
            'slug',
            'address',
            'contact_note',
            'security_phone',
            'is_active',
            'rooms',
            'can_administer',
            'my_role',
        ]

    def get_rooms(self, venue):
        rows = venue.rooms.all()
        if not self._is_admin(venue):
            rows = [room for room in rows if room.is_active]
        return RoomSerializer(rows, many=True).data

    def _is_admin(self, venue) -> bool:
        from .access import is_venue_admin

        request = self.context.get('request')
        return is_venue_admin(getattr(request, 'user', None), venue)

    def get_can_administer(self, venue) -> bool:
        return self._is_admin(venue)

    def get_my_role(self, venue):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not (user and user.is_authenticated):
            return None
        if user.is_staff:
            return 'administrator'
        row = next((s for s in venue.staff.all() if s.user_id == user.pk), None)
        return row.role if row else None


class VenueWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Venue
        fields = ['name', 'slug', 'address', 'contact_note', 'security_phone', 'is_active']


class RoomBookingSerializer(serializers.ModelSerializer):
    room = RoomSerializer(read_only=True)
    venue = serializers.SerializerMethodField()
    decided_by = PersonSerializer(read_only=True)
    event_title = serializers.CharField(source='event.title', read_only=True)

    class Meta:
        model = RoomBooking
        fields = [
            'id',
            'event_id',
            'event_title',
            'room',
            'venue',
            'starts_at',
            'ends_at',
            'status',
            'expected_headcount',
            'purpose',
            'decided_by',
            'decided_at',
            'note',
            'created_at',
        ]

    def get_venue(self, booking):
        return VenueSummarySerializer(booking.room.venue).data


class RoomBookingWriteSerializer(serializers.ModelSerializer):
    room_id = serializers.PrimaryKeyRelatedField(source='room', queryset=Room.objects.all())
    event_id = serializers.IntegerField()

    class Meta:
        model = RoomBooking
        fields = ['event_id', 'room_id', 'starts_at', 'ends_at', 'expected_headcount', 'purpose']

    def validate(self, attrs):
        starts = attrs.get('starts_at', getattr(self.instance, 'starts_at', None))
        ends = attrs.get('ends_at', getattr(self.instance, 'ends_at', None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({'ends_at': 'A booking has to end after it starts.'})
        return attrs


class ChecklistTemplateItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChecklistTemplateItem
        fields = [
            'id',
            'title_en',
            'title_pl',
            'description_en',
            'description_pl',
            'owner_role',
            'due_offset_minutes',
            'anchor',
            'is_mandatory',
            'na_allowed',
            'evidence_kind',
            'requires_venue_signoff',
            'order',
        ]
        read_only_fields = ['id']


class ChecklistTemplateSerializer(serializers.ModelSerializer):
    items = ChecklistTemplateItemSerializer(many=True, read_only=True)
    venue_name = serializers.SerializerMethodField()

    class Meta:
        model = ChecklistTemplate
        fields = [
            'id',
            'venue_id',
            'venue_name',
            'name',
            'description',
            'version',
            'event_kind_hint',
            'is_active',
            'items',
        ]

    def get_venue_name(self, template) -> str:
        return template.venue.name if template.venue_id else ''


class ChecklistTemplateWriteSerializer(serializers.ModelSerializer):
    venue_id = serializers.PrimaryKeyRelatedField(
        source='venue', queryset=Venue.objects.all(), required=False, allow_null=True
    )
    items = ChecklistTemplateItemSerializer(many=True, required=False)

    class Meta:
        model = ChecklistTemplate
        fields = ['venue_id', 'name', 'description', 'event_kind_hint', 'is_active', 'items']

    def create(self, validated_data):
        items = validated_data.pop('items', [])
        template = ChecklistTemplate.objects.create(**validated_data)
        for order, item in enumerate(items):
            item.setdefault('order', order)
            ChecklistTemplateItem.objects.create(template=template, **item)
        return template

    def update(self, instance, validated_data):
        """A replaced item list bumps `version` — that is the whole contract an open instance reads
        to decide whether there is anything to offer. Bumped only when the ITEMS change: renaming
        the template does not make an organiser's snapshot out of date."""
        items = validated_data.pop('items', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if items is not None:
            instance.items.all().delete()
            for order, item in enumerate(items):
                item.setdefault('order', order)
                ChecklistTemplateItem.objects.create(template=instance, **item)
            instance.version = (instance.version or 1) + 1
        instance.save()
        return instance


class ChecklistInstanceItemSerializer(serializers.ModelSerializer):
    done_by = PersonSerializer(read_only=True)
    signed_off_by = PersonSerializer(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    evidence_file_url = serializers.SerializerMethodField()

    class Meta:
        model = ChecklistInstanceItem
        fields = [
            'id',
            'instance_id',
            'title_en',
            'title_pl',
            'description_en',
            'description_pl',
            'owner_role',
            'due_offset_minutes',
            'anchor',
            'computed_due_at',
            'is_mandatory',
            'na_allowed',
            'evidence_kind',
            'requires_venue_signoff',
            'order',
            'status',
            'na_reason',
            'evidence_text',
            'evidence_url',
            'evidence_file_url',
            'done_by',
            'done_at',
            'signed_off_by',
            'signed_off_at',
            'is_overdue',
        ]

    def get_evidence_file_url(self, item):
        if not item.evidence_file:
            return ''
        request = self.context.get('request')
        url = item.evidence_file.url
        return request.build_absolute_uri(url) if request else url


class ChecklistInstanceItemWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChecklistInstanceItem
        fields = ['status', 'na_reason', 'evidence_text', 'evidence_url', 'evidence_file']


class ChecklistInstanceSerializer(serializers.ModelSerializer):
    items = ChecklistInstanceItemSerializer(many=True, read_only=True)
    venue = VenueSummarySerializer(read_only=True)
    template_has_new_items = serializers.SerializerMethodField()
    mandatory_pending = serializers.SerializerMethodField()
    can_sign_off = serializers.SerializerMethodField()

    class Meta:
        model = ChecklistInstance
        fields = [
            'id',
            'event_id',
            'venue',
            'template_id',
            'template_name',
            'template_version',
            'template_has_new_items',
            'mandatory_pending',
            'can_sign_off',
            'created_at',
            'items',
        ]

    def get_template_has_new_items(self, instance) -> bool:
        return bool(
            instance.template_id
            and instance.template
            and instance.template.version > instance.template_version
        )

    def get_mandatory_pending(self, instance) -> int:
        # A `COUNT` over the rows already loaded, never a stored tally (house rule 5).
        from .models import SETTLED_ITEM_STATUSES

        return sum(
            1
            for item in instance.items.all()
            if item.is_mandatory and item.status not in SETTLED_ITEM_STATUSES
        )

    def get_can_sign_off(self, instance) -> bool:
        from .access import is_venue_admin

        request = self.context.get('request')
        return is_venue_admin(getattr(request, 'user', None), instance.venue)
