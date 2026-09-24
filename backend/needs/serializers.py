"""Serializers for `needs` (MANAGEMENT-BRIEF.md §3.C)."""

from rest_framework import serializers

from config import nodes as node_seam

from .models import Need, NeedApplication


def _display_name(user) -> str:
    """Just enough to name somebody. Duplicated per app rather than imported across app boundaries
    on purpose — the same call `events/serializers.py: PersonSerializer` makes, so this app's
    response shape is not hostage to a change made for an unrelated one."""
    profile = getattr(user, 'profile', None)
    return profile.display_name if profile and profile.display_name else user.username


def _person(user) -> dict | None:
    if user is None:
        return None
    return {'id': user.pk, 'display_name': _display_name(user)}


class NeedSerializer(serializers.ModelSerializer):
    """`node` is read-only and computed (`config.nodes.node_ref`) — the need's node is set once, at
    creation, from the URL it was posted under (`NodeNeedsView.post`), never from the request body:
    a client-chosen `content_type`/`object_id` would let anybody pin a need on a node they do not
    run."""

    node = serializers.SerializerMethodField()
    accepted_count = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = Need
        fields = [
            'id', 'node', 'title', 'description', 'kind', 'status', 'skill_level',
            'estimated_hours', 'deadline', 'is_remote', 'wanted_count', 'accepted_count',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'node', 'accepted_count', 'created_by', 'created_at', 'updated_at']

    def get_node(self, need: Need) -> dict | None:
        node = need.node
        if node is None:
            return None
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        return node_seam.node_ref(node, user)

    def get_accepted_count(self, need: Need) -> int:
        return need.accepted_count()

    def get_created_by(self, need: Need) -> dict | None:
        return _person(need.created_by)

    def validate_status(self, value: str) -> str:
        # `fulfilled` is derived (`needs/rules.py: recount`), never written by a manager's PATCH —
        # the recount is what makes it trustworthy, and a hand-set `fulfilled` on a need nobody has
        # actually accepted `wanted_count` people for is exactly the drift house rule 5 exists to
        # prevent.
        if value == 'fulfilled':
            raise serializers.ValidationError(
                'fulfilled is derived from accepted applications, not set directly.'
            )
        return value

    def validate_wanted_count(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError('wanted_count must be at least 1.')
        return value


class NeedApplicationSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    decided_by = serializers.SerializerMethodField()

    class Meta:
        model = NeedApplication
        fields = ['id', 'need', 'user', 'message', 'status', 'decided_by', 'decided_at', 'created_at']
        read_only_fields = fields

    def get_user(self, application: NeedApplication) -> dict | None:
        return _person(application.user)

    def get_decided_by(self, application: NeedApplication) -> dict | None:
        return _person(application.decided_by)


class ApplyDraftSerializer(serializers.Serializer):
    """What the Apply form sends. `need`/`user`/`status` are none of the client's business — the
    view sets all three."""

    message = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class DecideSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=['accept', 'decline'])
