"""Serializers for `goals` (the owner's ask of 2026-10-08: a goal class used as a definition of
done, and commentable)."""

from rest_framework import serializers

from config import nodes as node_seam
from translations.serializers import TranslatedTextMixin

from .models import CRITERION_MAX_LENGTH, Goal, GoalCriterion


def _display_name(user) -> str:
    """Just enough to name somebody. Written per app rather than imported across app boundaries,
    the call every other management serializer here makes — so this app's response shape is not
    hostage to a change made for an unrelated one."""
    profile = getattr(user, 'profile', None)
    return profile.display_name if profile and profile.display_name else user.username


def _person(user) -> dict | None:
    if user is None:
        return None
    return {'id': user.pk, 'display_name': _display_name(user)}


class GoalCriterionSerializer(TranslatedTextMixin, serializers.ModelSerializer):
    """One line of a definition of done.

    The `poll_option` shape in `translations/targets.py`: one text field and no second one, so
    `translated_body_field` is None and the mixin leaves the body alone.
    """

    translated_heading_field = 'text'
    translated_body_field = None

    language = serializers.SerializerMethodField()
    text_versions = serializers.SerializerMethodField()
    #: `met_at IS NULL` is the state (`models.py`), and this is how a client reads it without
    #: having to know that. Read-only: a criterion is ticked through its own action, which is where
    #: `met_by` and the goal's recount happen.
    is_met = serializers.SerializerMethodField()
    met_by = serializers.SerializerMethodField()
    text = serializers.CharField(max_length=CRITERION_MAX_LENGTH)

    class Meta:
        model = GoalCriterion
        fields = [
            'id', 'text', 'order', 'is_met', 'met_at', 'met_by', 'created_at',
            'language', 'text_versions',
        ]
        read_only_fields = ['id', 'is_met', 'met_at', 'met_by', 'created_at']

    def get_is_met(self, criterion: GoalCriterion) -> bool:
        return criterion.is_met

    def get_met_by(self, criterion: GoalCriterion) -> dict | None:
        return _person(criterion.met_by)


class GoalSerializer(TranslatedTextMixin, serializers.ModelSerializer):
    """`node` is read-only and computed (`config.nodes.node_ref`) — a goal's node is set once, at
    creation, from the URL it was posted under (`NodeGoalsView.post`), never from the request body:
    a client-chosen `content_type`/`object_id` would let anybody pin a goal on a body they do not
    run.

    `criteria` is nested and read-only here: it is written through
    `/api/goals/{id}/criteria/`, because a definition of done is edited one line at a time and a
    whole-list PUT would make two people editing two different criteria overwrite each other.
    """

    translated_heading_field = 'title'
    translated_body_field = 'description'
    language = serializers.SerializerMethodField()
    text_versions = serializers.SerializerMethodField()

    node = serializers.SerializerMethodField()
    criteria = GoalCriterionSerializer(many=True, read_only=True)
    #: "3 of 5", recounted (house rule 5). Both numbers rather than a percentage: a reader wants to
    #: know how many lines are left, and a percentage of three criteria is a lie with a decimal
    #: point in it.
    criteria_met_count = serializers.SerializerMethodField()
    criteria_count = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()
    met_by = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_tick = serializers.SerializerMethodField()

    class Meta:
        model = Goal
        fields = [
            'id', 'node', 'title', 'description', 'status', 'order',
            'criteria', 'criteria_met_count', 'criteria_count',
            'created_by', 'met_by', 'met_at', 'created_at', 'updated_at',
            'can_edit', 'can_tick',
            'language', 'text_versions',
        ]
        read_only_fields = [
            'id', 'node', 'criteria', 'criteria_met_count', 'criteria_count',
            'created_by', 'met_by', 'met_at', 'created_at', 'updated_at',
            'can_edit', 'can_tick',
        ]

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def get_node(self, goal: Goal) -> dict | None:
        node = goal.node
        if node is None:
            return None
        return node_seam.node_ref(node, self._user())

    def get_criteria_met_count(self, goal: Goal) -> int:
        # The cached pair, not the authoritative one: this is the same list the `criteria` field
        # below is printing, and the view has prefetched it (`models.py` argues the split).
        return goal.criteria_counts_cached()[0]

    def get_criteria_count(self, goal: Goal) -> int:
        return goal.criteria_counts_cached()[1]

    def get_created_by(self, goal: Goal) -> dict | None:
        return _person(goal.created_by)

    def get_met_by(self, goal: Goal) -> dict | None:
        return _person(goal.met_by)

    def get_can_edit(self, goal: Goal) -> bool:
        from . import rules

        return rules.can_edit(self._user(), goal)

    def get_can_tick(self, goal: Goal) -> bool:
        from . import rules

        return rules.can_tick(self._user(), goal)

    def validate_status(self, value: str) -> str:
        # `met` is derived (`goals/rules.py: recount`), never written by a PATCH. Refused with its
        # reason rather than silently dropped (house rule 10): a client that tries deserves to be
        # told that ticking the criteria is how a goal becomes met, which is the whole feature.
        if value == 'met':
            raise serializers.ValidationError(
                'met is derived from the goal\'s criteria, not set directly — tick the criteria.'
            )
        return value


class CriterionOrderSerializer(serializers.Serializer):
    """`POST /api/goals/{id}/reorder/` — the ids of this goal's criteria in the order wanted.

    The whole list in one request, like `plans`' own reorder: a definition of done is read in
    order, and two adjacent swaps arriving out of order would leave it in neither arrangement.
    """

    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)


class ServesGoalMixin:
    """`goal` on a row that hangs off a node — the one nullable FK and the one rule it needs.

    **Two serializers use this** (`tasks.TaskSerializer`, `plans.PlanSerializer`) and that is why
    it is here rather than written twice: the rule is that a row may only serve a goal on its OWN
    node, it cannot be a database constraint (two generic targets, no shared column), and two
    copies of it is how one of the two surfaces starts allowing a task on a course to point at an
    organisation's goal.

    The node comes from the row being updated, and a goal can only be set by an update: both apps
    create through their own write serializer (`TaskWriteSerializer`, `PlanCreateSerializer`), which
    does not carry this field, because a node-nested POST does not carry its node in the body either
    and there would be nothing to validate against. `context['node']` is honoured if a caller does
    supply it, so that adding `goal` to a create form later is one line there and none here. A goal
    named with neither available is refused rather than written unchecked (house rule 10).
    """

    def _serves_node(self):
        if self.instance is not None:
            return getattr(self.instance, 'node', None)
        return self.context.get('node')

    def validate(self, attrs):
        attrs = super().validate(attrs)
        goal = attrs.get('goal')
        if goal is None:
            return attrs
        from config import nodes as node_seam

        from . import rules

        node = self._serves_node()
        if node is None:
            raise serializers.ValidationError({'goal': [rules.OTHER_NODE]})
        try:
            rules.goal_for_node(
                goal.pk, node_seam.node_content_type(node).pk, node.pk
            )
        except ValueError as exc:
            # 400 naming the field, not 403 or 404: the id came out of a request body, and the
            # honest answer is "that goal is not about this" rather than "it does not exist" — a
            # reader who can see the row can see its node's goals anyway (`rules.can_view_goal`).
            raise serializers.ValidationError({'goal': [str(exc)]}) from exc
        return attrs
