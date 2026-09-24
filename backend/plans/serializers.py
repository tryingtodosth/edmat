"""Serializers for `plans` (MANAGEMENT-BRIEF.md §3.D).

`PlanSerializer` always embeds the node ref (`config.nodes.node_ref`) and the top-level steps —
small numbers on any one node, so one round trip beats a second endpoint (the `CloakroomDeskSerializer`
precedent: a desk always carries its items). `PlanStepSerializer.get_substeps` recurses at most
once in practice: a step that already has a `parent` never has `substeps` of its own, because
`views.py` refuses a second level of nesting before it is ever written — the `if step.parent_id`
guard below is what makes that recursion provably terminate rather than merely usually terminate.
"""

from rest_framework import serializers

from config import nodes

from .models import PLAN_STATUS_CHOICES, Plan, PlanStep, PlanSuggestion
from .rules import can_edit as plan_can_edit
from .rules import progress as plan_progress
from .rules import suggest_block_reason


def _display_name(user) -> str:
    if user is None:
        return ''
    profile = getattr(user, 'profile', None)
    name = getattr(profile, 'display_name', '') if profile is not None else ''
    return name or user.get_username()


class PlanStepSerializer(serializers.ModelSerializer):
    done_by_name = serializers.SerializerMethodField()
    substeps = serializers.SerializerMethodField()

    class Meta:
        model = PlanStep
        fields = [
            'id', 'plan', 'parent', 'title', 'description', 'order', 'status',
            'due_at', 'done_by', 'done_by_name', 'done_at', 'substeps',
        ]
        read_only_fields = ['id', 'plan', 'done_by', 'done_at']

    def get_done_by_name(self, step) -> str:
        return _display_name(step.done_by)

    def get_substeps(self, step) -> list:
        if step.parent_id is not None:
            # One level, by construction (rules.py's `NESTED` refusal) — a step that has a parent
            # can never itself be one, so this branch is what makes the recursion below terminate.
            return []
        rows = step.substeps.all().order_by('order', 'id')
        return PlanStepSerializer(rows, many=True, context=self.context).data


class PlanSerializer(serializers.ModelSerializer):
    node = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    steps = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    suggest_block_reason = serializers.SerializerMethodField()

    class Meta:
        model = Plan
        fields = [
            'id', 'node', 'title', 'description', 'status',
            'created_by', 'created_by_name', 'created_at', 'updated_at',
            'steps', 'progress', 'can_edit', 'suggest_block_reason',
        ]
        read_only_fields = [
            'id', 'node', 'status', 'created_by', 'created_by_name', 'created_at', 'updated_at',
            'can_edit', 'suggest_block_reason',
        ]

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None) if request is not None else None

    def get_node(self, plan) -> dict | None:
        node = plan.node
        if node is None:
            return None
        return nodes.node_ref(node, self._user())

    def get_created_by_name(self, plan) -> str:
        return _display_name(plan.created_by)

    def get_steps(self, plan) -> list:
        rows = plan.steps.filter(parent__isnull=True).order_by('order', 'id')
        return PlanStepSerializer(rows, many=True, context=self.context).data

    def get_progress(self, plan) -> dict:
        return plan_progress(plan)

    def get_can_edit(self, plan) -> bool:
        # So the frontend can draw the right buttons without guessing from `node.canManage` alone
        # — the plan's OWN creator may edit it even after losing standing on the node (rules.py's
        # `can_edit`), and re-deriving that on the client is exactly the kind of second copy of a
        # rule house rule "a rule more than one endpoint needs lives in one module" warns about.
        return plan_can_edit(self._user(), plan)

    def get_suggest_block_reason(self, plan) -> str | None:
        return suggest_block_reason(self._user(), plan)


class PlanCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('A plan needs a title.')
        return value


class PlanStepCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    due_at = serializers.DateTimeField(required=False, allow_null=True, default=None)
    # A step id, not a nested payload — the parent must already exist so `NESTED` can be checked
    # against a real row before anything is written.
    parent = serializers.IntegerField(required=False, allow_null=True, default=None)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('A step needs a title.')
        return value


class PlanStepUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanStep
        fields = ['title', 'description', 'status', 'due_at']

    def validate_title(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('A step needs a title.')
        return value


class TransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[c[0] for c in PLAN_STATUS_CHOICES])


class ReorderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)
    # `None` (the default) means the plan's top-level steps; naming a step reorders ITS sub-steps —
    # an extension of MANAGEMENT-BRIEF.md §3.D's own `reorder(plan, ids)`, which is exactly this
    # call with `parent` omitted, so the frontend's up/down controls work at both levels through
    # one endpoint rather than a second one for sub-steps.
    parent = serializers.IntegerField(required=False, allow_null=True, default=None)


class PlanSuggestionSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    decided_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PlanSuggestion
        fields = [
            'id', 'plan', 'user', 'user_name', 'text', 'status',
            'decided_by', 'decided_by_name', 'decided_at', 'created_step', 'created_at',
        ]
        read_only_fields = fields

    def get_user_name(self, suggestion) -> str:
        return _display_name(suggestion.user)

    def get_decided_by_name(self, suggestion) -> str:
        return _display_name(suggestion.decided_by)


class PlanSuggestionCreateSerializer(serializers.Serializer):
    text = serializers.CharField()

    def validate_text(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('A suggestion needs some text.')
        return value


class DecideSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=['accept', 'reject'])
