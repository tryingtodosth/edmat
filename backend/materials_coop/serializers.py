"""The one write shape this app takes, and the read shapes for the derived rows.

The overview itself is a dict built by `overview.build_overview`, serialized by these only where a
field needs formatting (dates, ids) — the rest is plain values already."""

from rest_framework import serializers

from .models import POLICY_KEYS, WELCOME_NOTE_MAX_LENGTH


class CoopSettingsWriteSerializer(serializers.Serializer):
    policy = serializers.ChoiceField(choices=POLICY_KEYS, required=False)
    welcome_note = serializers.CharField(
        required=False, allow_blank=True, max_length=WELCOME_NOTE_MAX_LENGTH
    )


class MemberRowSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    display_name = serializers.CharField()
    role = serializers.CharField(allow_null=True)
    added_at = serializers.DateTimeField(allow_null=True)
    versions_count = serializers.IntegerField()
    published_count = serializers.IntegerField()
    last_active_at = serializers.DateTimeField(allow_null=True)


class TimelineEventSerializer(serializers.Serializer):
    kind = serializers.CharField()
    at = serializers.DateTimeField()
    actor_id = serializers.IntegerField(allow_null=True)
    actor_display_name = serializers.CharField(allow_blank=True)
    version_id = serializers.IntegerField(allow_null=True)
    version_number = serializers.IntegerField(allow_null=True)
    label = serializers.CharField(allow_blank=True)


class StatsSerializer(serializers.Serializer):
    versions_total = serializers.IntegerField()
    published_count = serializers.IntegerField()
    proposals_pending = serializers.IntegerField()
    join_requests_pending = serializers.IntegerField()
    members_count = serializers.IntegerField()
    contributors_count = serializers.IntegerField()
    comment_count = serializers.IntegerField()
    first_published_at = serializers.DateTimeField(allow_null=True)
    last_published_at = serializers.DateTimeField(allow_null=True)


class CoopOverviewSerializer(serializers.Serializer):
    material_id = serializers.IntegerField(allow_null=True)
    project_id = serializers.IntegerField()
    title = serializers.CharField(allow_blank=True)
    policy = serializers.CharField()
    welcome_note = serializers.CharField(allow_blank=True)
    my_role = serializers.CharField(allow_null=True)
    can_edit = serializers.BooleanField()
    can_manage = serializers.BooleanField()
    can_propose = serializers.BooleanField()
    propose_block_reason = serializers.CharField(allow_null=True)
    join_block_reason = serializers.CharField(allow_null=True)
    can_post = serializers.BooleanField()
    post_block_reason = serializers.CharField(allow_null=True)
    published_version = serializers.DictField(allow_null=True)
    head_version = serializers.DictField(allow_null=True)
    members = MemberRowSerializer(many=True)
    contributors = MemberRowSerializer(many=True)
    versions = serializers.ListField(child=serializers.DictField())
    pending_proposals = serializers.ListField(child=serializers.DictField())
    stats = StatsSerializer()
    timeline = TimelineEventSerializer(many=True)
