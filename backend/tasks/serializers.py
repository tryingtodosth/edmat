"""What a task looks like on the wire.

Two shapes, for the usual reason: a **read** serializer that carries everything a panel needs to
draw a row *and* decide whether its buttons are live (`can_edit`, `can_assign`, `progress`,
`is_overdue`), and a **write** serializer that accepts only the five fields a person may type.
`status` is not among them — it moves through `POST /api/tasks/{id}/transition/` and nowhere else,
because a PATCH that could set it would be a second, unguarded copy of `rules.transition_block_reason`.

One GET powers the whole panel (the `shifts` precedent): a task arrives with its subtasks folded
under it, its assignees, its progress and its refusals, so no button ever has to ask a second
endpoint why it is disabled.
"""

from rest_framework import serializers

from config import nodes
from config.sanitize import sanitize_content

from . import rules
from .models import STATUS_CHOICES, Task, TaskAssignee
from goals.serializers import ServesGoalMixin
from translations.serializers import TranslatedTextMixin


def display_name(user) -> str:
    """The name a roster shows. Mirrors `config/views.py`'s own private helper — two call sites is
    not three (house rule 13), so it is copied rather than extracted, and said so in one place."""
    profile = getattr(user, 'profile', None)
    name = getattr(profile, 'display_name', '') if profile is not None else ''
    return name or user.get_username()


def person(user):
    if user is None:
        return None
    return {'id': user.pk, 'display_name': display_name(user)}


class TaskAssigneeSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    assigned_by = serializers.SerializerMethodField()

    class Meta:
        model = TaskAssignee
        fields = ['id', 'user', 'assigned_by', 'assigned_at']

    def get_user(self, obj):
        return person(obj.user)

    def get_assigned_by(self, obj):
        return person(obj.assigned_by)


class TaskSerializer(TranslatedTextMixin, serializers.ModelSerializer):
    """A task as its reader is allowed to know it — which, since only node staff ever see one at
    all, is all of it. `user` comes in through the serializer context, never from `request` inside a
    method: an `@action` that forgot to pass it should fail loudly rather than answer `can_edit`
    with a silent False.

    The context also carries `request` since 2026-10-08, and that is NOT a softening of the rule
    above: `TranslatedTextMixin` reads `?lang=` off it to answer `title`/`description` in the
    reader's language (`config.i18n_utils.request_locale`), and `user` remains the explicit key
    every authority answer here comes from. Without the request the locale falls back to 'pl' and
    an English reader silently gets the Polish — which is exactly what happened, and what a test
    in `translations/` caught."""
    # Bilingual management text (translations/, 2026-10-08): `title`/`description` answer in the
    # reader's `?lang=`, and `language`/`text_versions` say which language that actually is, what
    # else exists and whether a newer version is waiting in another one. The mixin does all of it.
    translated_heading_field = 'title'
    translated_body_field = 'description'
    language = serializers.SerializerMethodField()
    text_versions = serializers.SerializerMethodField()

    created_by = serializers.SerializerMethodField()
    assignees = TaskAssigneeSerializer(many=True, read_only=True)
    subtasks = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_assign = serializers.SerializerMethodField()
    node = serializers.SerializerMethodField()
    #: The goal this task serves (`goals/`, 2026-10-08) — the id, plus its title so a card can
    #: draw "Serves: …" without a second request. Read-only HERE: every write path on this model
    #: goes through `TaskWriteSerializer`, which is where `ServesGoalMixin` sits.
    goal = serializers.PrimaryKeyRelatedField(read_only=True)
    goal_title = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            'id', 'node', 'title', 'description', 'status', 'priority', 'due_at',
            'parent', 'order', 'created_by', 'created_at', 'updated_at', 'done_at',
            'assignees', 'subtasks', 'progress', 'is_overdue', 'can_edit', 'can_assign',
            'goal', 'goal_title',
            'language',
            'text_versions',
        ]

    def get_goal_title(self, task) -> str:
        goal = task.goal
        return goal.title if goal is not None else ''

    @property
    def _user(self):
        return self.context.get('user')

    def get_created_by(self, obj):
        return person(obj.created_by)

    def get_subtasks(self, obj):
        """One level, so this never recurses: a subtask's own `subtasks` is always `[]` by
        construction (`rules.NESTED`), and asking for it would be a query per row for a list that
        cannot exist."""
        if obj.parent_id is not None:
            return []
        children = obj.subtasks.all().prefetch_related('assignees__user__profile')
        return TaskSerializer(children, many=True, context=self.context).data

    def get_progress(self, obj):
        done, total = rules.progress(obj)
        return {'done': done, 'total': total}

    def get_is_overdue(self, obj):
        return rules.is_overdue(obj)

    def get_can_edit(self, obj):
        return rules.can_edit(self._user, obj)

    def get_can_assign(self, obj):
        return rules.can_assign(self._user, obj)

    def get_node(self, obj):
        """`config.nodes.node_ref` — the same dict `/api/nodes/{kind}/{id}/` answers, so `/tasks`
        can say what a task hangs on without a second request per row."""
        node = rules.node_of(obj)
        if node is None:
            return None
        return nodes.node_ref(node, self._user)


class TaskWriteSerializer(ServesGoalMixin, serializers.ModelSerializer):
    """The six fields a person may type. `description` is sanitized here rather than in the view,
    so every write path — create, subtask create, patch — passes through the same bleach pass
    (house rule 8: on write as well as on read).

    `goal` is the sixth (`goals/`, 2026-10-08), and `ServesGoalMixin` is the one rule it needs: the
    goal has to hang off the same node as the task. On a PATCH the node comes from the instance; on
    a create the view passes it in the context, because a node-nested POST does not carry its node
    in the body.
    """

    class Meta:
        model = Task
        fields = ['title', 'description', 'priority', 'due_at', 'order', 'goal']
        extra_kwargs = {
            'title': {'required': True, 'allow_blank': False},
            'description': {'required': False},
        }

    def validate_description(self, value):
        return sanitize_content(value or '')


class TransitionSerializer(serializers.Serializer):
    """An unknown status is a **400** here, before `rules.transition_block_reason` ever sees it: the
    request is malformed, not in conflict with the world (root `CLAUDE.md`, "409 means the world
    moved; 400 means the request was malformed")."""

    status = serializers.ChoiceField(choices=[key for key, _ in STATUS_CHOICES])


class AssignSerializer(serializers.Serializer):
    """By account id, because there is no people search in this project (root `CLAUDE.md`, known
    gaps) — the picker on the frontend is fed by `GET /api/nodes/{kind}/{id}/staff/`, so a person
    never actually types one."""

    user = serializers.IntegerField()
