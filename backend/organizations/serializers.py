"""Read and write shapes for `/api/organizations/`, its roster and its links.

Two conventions from `backend/CLAUDE.md` this file holds to:

- **A read serializer and a write serializer are different classes** wherever a write takes a
  different shape from a read — the roster POST takes `user_id` and a role and nothing else, and a
  link POST takes a node kind and id, which is not the shape either row reads back as.
- **Never an email anywhere.** A roster is read by strangers on a public page, so a person is an id
  and a display name, the `venues.PersonSerializer` shape.

The slug is read-only on purpose: it is what every shared link carries, so it is allocated once from
the name (`services.allocate_slug`) and never moves under a link somebody already sent.
"""

from rest_framework import serializers

from .models import (
    LINK_KIND_CHOICES,
    ORGANIZATION_KIND_CHOICES,
    ORGANIZATION_ROLE_CHOICES,
    Organization,
    OrganizationLink,
    OrganizationMember,
)


class PersonSerializer(serializers.Serializer):
    """An id and a display name, never an email — the same shape `venues` and `config/views.py`
    already answer people with, so the frontend has one person type for all of them."""

    id = serializers.IntegerField()
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, obj) -> str:
        profile = getattr(obj, 'profile', None)
        return (getattr(profile, 'display_name', '') or obj.get_username()) if obj else ''


class OrganizationMemberSerializer(serializers.ModelSerializer):
    user = PersonSerializer(read_only=True)
    added_by = PersonSerializer(read_only=True)

    class Meta:
        model = OrganizationMember
        fields = ['id', 'user', 'role', 'added_by', 'added_at']
        read_only_fields = fields


class OrganizationMemberWriteSerializer(serializers.Serializer):
    """By **account id**, because there is no people search on this platform (root `CLAUDE.md`,
    known gaps). The frontend says so in as many words rather than drawing a search box that cannot
    work — MANAGEMENT-BRIEF.md §6.3 makes this the standing shape for every roster in the
    management layer."""

    user_id = serializers.IntegerField()
    role = serializers.ChoiceField(choices=ORGANIZATION_ROLE_CHOICES, default='member')


class OrganizationMemberRoleSerializer(serializers.Serializer):
    """The one field `PATCH /api/organization-members/{id}/` accepts. Deliberately not the model
    serializer: nothing else about a membership row is editable, and a partial update over the model
    would quietly accept `user` and move the row to somebody else."""

    role = serializers.ChoiceField(choices=ORGANIZATION_ROLE_CHOICES)


class OrganizationLinkSerializer(serializers.ModelSerializer):
    """A link reads back as its node's `node_ref` (MANAGEMENT-BRIEF.md §2) rather than as a content
    type and an integer: the panel drawing it needs a title and a kind, and `config/nodes.py` is the
    one place that knows how to produce those for any of the three."""

    node = serializers.SerializerMethodField()
    added_by = PersonSerializer(read_only=True)
    organization = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationLink
        fields = ['id', 'organization', 'node', 'kind', 'added_by', 'added_at']
        read_only_fields = fields

    def get_node(self, obj):
        from config import nodes

        target = obj.target
        if target is None:
            # A target whose row went away. The link is left in place rather than cascaded, so this
            # says so honestly instead of 500ing on `kind_of(None)`.
            return None
        return nodes.node_ref(target, self.context.get('request').user if self.context.get('request') else None)

    def get_organization(self, obj):
        return OrganizationSummarySerializer(obj.organization, context=self.context).data


class OrganizationLinkWriteSerializer(serializers.Serializer):
    node_kind = serializers.CharField(max_length=32)
    node_id = serializers.IntegerField()
    kind = serializers.ChoiceField(choices=LINK_KIND_CHOICES, default='runs')


class OrganizationSummarySerializer(serializers.ModelSerializer):
    """What a list row and a badge carry. `member_count` and `link_count` are recounted per request
    (house rule 5) — two `COUNT`s over an indexed FK, annotated by the viewset where the list is
    long enough for it to matter."""

    member_count = serializers.SerializerMethodField()
    link_count = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = [
            'id',
            'name',
            'slug',
            'kind',
            'city',
            'is_active',
            'member_count',
            'link_count',
        ]
        read_only_fields = fields

    def get_member_count(self, obj) -> int:
        annotated = getattr(obj, 'member_count_annotated', None)
        return annotated if annotated is not None else obj.members.count()

    def get_link_count(self, obj) -> int:
        annotated = getattr(obj, 'link_count_annotated', None)
        return annotated if annotated is not None else obj.links.count()


class OrganizationSerializer(OrganizationSummarySerializer):
    """The detail shape. `my_role` and `can_manage` are the server's own answers, never re-derived
    by the frontend — a page that decided for itself who may edit it is how a control appears for
    somebody the API will then refuse."""

    my_role = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    created_by = PersonSerializer(read_only=True)

    class Meta(OrganizationSummarySerializer.Meta):
        fields = OrganizationSummarySerializer.Meta.fields + [
            'description',
            'website',
            'created_by',
            'created_at',
            'my_role',
            'can_manage',
        ]
        read_only_fields = fields

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def get_my_role(self, obj):
        from .access import role_of

        return role_of(self._user(), obj)

    def get_can_manage(self, obj) -> bool:
        from .access import can_manage

        return can_manage(self._user(), obj)


class OrganizationWriteSerializer(serializers.ModelSerializer):
    """`name` and `kind` and four optional fields. The slug is NOT here (see the module docstring),
    `is_active` is not here either — a body is closed through DELETE, which is the one path that
    also has the tombstone's reasoning attached to it.

    `description` is sanitized in `Organization.save()` rather than in a `validate_` method, which is
    what `config/sanitize.py` asks for: every write path is then covered, including the admin.
    """

    kind = serializers.ChoiceField(choices=ORGANIZATION_KIND_CHOICES, default='other')

    class Meta:
        model = Organization
        fields = ['name', 'kind', 'description', 'website', 'city']

    def validate_name(self, value: str) -> str:
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('required')
        return value
