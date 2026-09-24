"""`/api/nodes/{kind}/{id}/tasks/` and `/api/tasks/…` — the board, and one task at a time.

Three shape notes, each a deliberate departure worth reading before changing anything here.

**The node-nested list is this app's own URL**, not an `@action` on `CourseViewSet` and
`EventViewSet` and `MaterialViewSet` (`MANAGEMENT-BRIEF.md` §4 rule 1: one app per step, and
nothing in anybody else's app moves). It resolves the node through `config.nodes`, which is also
the only thing that knows what a node *is*.

**Visibility cannot be a queryset filter here, and that is stated rather than silently skipped.**
House rule 4 asks for both a filter and an object check; this app's target is a
`GenericForeignKey` across three models with three different rosters, so "tasks on nodes I am staff
of" has no SQL form. What replaces the filter is that **every path scopes before it reads**: the
nested list resolves its node and 404s a non-staff caller before touching `Task`, and every
single-object path goes through `get_object`, which asks `rules.visible_task` and raises `Http404`.
There is deliberately **no `GET /api/tasks/`** — a list with no node to scope it to would be
exactly the unscoped queue that leaked once before (house rule 4's own cautionary tale).

**A refusal carries its word** (house rule 6). `_refusal` answers `{'detail': w, 'reason': w}` the
way `shifts/views.py` does, at 409 by default: `not_staff` is a 400 (the request named somebody who
cannot be an assignee — a bad request, not a race), `not_manager` / `not_allowed` are 403 (a real
party asking for something that is not theirs), and `nested`, `has_subtasks`, `already_assigned`
and `illegal_transition` are 409s.
"""

from django.db.models import Q
from django.http import Http404
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from config import nodes
from moderation.permissions import feature_gate

from . import rules
from .models import CLOSED_STATUSES, OPEN_STATUSES, Task, TaskAssignee
from .serializers import (
    AssignSerializer,
    TaskSerializer,
    TaskWriteSerializer,
    TransitionSerializer,
)

_TasksGate = feature_gate('tasks')

#: Which refusal words travel as which HTTP status. Everything not named here is a 409, because a
#: refusal that is neither "you may not" nor "that is not a request" is the world having moved.
_REFUSAL_STATUS = {
    rules.NOT_STAFF: status.HTTP_400_BAD_REQUEST,
    rules.NOT_MANAGER: status.HTTP_403_FORBIDDEN,
    rules.NOT_ALLOWED: status.HTTP_403_FORBIDDEN,
    rules.NOT_ASSIGNED: status.HTTP_400_BAD_REQUEST,
}


def _refusal(reason):
    return Response(
        {'detail': reason, 'reason': reason},
        status=_REFUSAL_STATUS.get(reason, status.HTTP_409_CONFLICT),
    )


def _tasks_for_reading(queryset):
    return queryset.select_related('created_by__profile', 'content_type').prefetch_related(
        'assignees__user__profile', 'subtasks__assignees__user__profile'
    )


def _apply_filters(queryset, request):
    """`?status=`, `?assignee=me`, `?overdue=1` — §3.B's three, and no more.

    They narrow the TOP-LEVEL rows; a subtask always travels folded under its parent, so
    `?assignee=me` answers "the tasks of mine that head a card", not "every row mentioning me".
    Said here because the alternative (promoting a matching subtask to the top of the list) would
    draw the same title twice on a board that also shows its parent.
    """
    wanted = request.query_params.get('status')
    if wanted:
        queryset = queryset.filter(status=wanted)
    if request.query_params.get('assignee') == 'me' and request.user.is_authenticated:
        queryset = queryset.filter(assignees__user=request.user)
    if request.query_params.get('overdue') == '1':
        queryset = queryset.filter(due_at__lt=timezone.now(), status__in=OPEN_STATUSES)
    return queryset.distinct()


class NodeTasksView(APIView):
    """`GET|POST /api/nodes/{kind}/{id}/tasks/` — the board of one course, event or material.

    `AllowAny` plus our own 404 rather than `IsAuthenticated`: an anonymous caller and a signed-in
    stranger should get the same answer, and that answer is "there is nothing here" (house rule 4),
    not a 401 that confirms the node exists and has a task board.
    """

    permission_classes = [permissions.AllowAny, _TasksGate]

    def _node_or_404(self, request, kind, pk):
        node = nodes.resolve_node(kind, pk)
        if node is None or not nodes.can_view_node(request.user, node):
            raise Http404
        if not nodes.is_node_staff(request.user, node):
            raise Http404
        return node

    def get(self, request, kind, pk):
        node = self._node_or_404(request, kind, pk)
        queryset = rules.visible_tasks(request.user, node).filter(parent__isnull=True)
        queryset = _apply_filters(_tasks_for_reading(queryset), request)
        serializer = TaskSerializer(queryset, many=True, context={'user': request.user})
        return Response(serializer.data)

    def post(self, request, kind, pk):
        node = self._node_or_404(request, kind, pk)
        # Any staff member may write a task; only a manager may put somebody on it (rules.can_assign).
        serializer = TaskWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = Task.objects.create(
            content_type=nodes.node_content_type(node),
            object_id=node.pk,
            created_by=request.user,
            **serializer.validated_data,
        )
        return Response(
            TaskSerializer(task, context={'user': request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class TaskViewSet(
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """One task: read it, edit its words, move it, staff it, fold a subtask under it, delete it.

    No `list` route on purpose — see the module docstring. `queryset` exists only because DRF's
    generic machinery wants one; the real scoping is `get_object`, which every route below goes
    through.
    """

    queryset = Task.objects.all()
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated, _TasksGate]

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['user'] = self.request.user
        return context

    def get_object(self):
        task = _tasks_for_reading(Task.objects.all()).filter(pk=self.kwargs['pk']).first()
        if task is None or not rules.visible_task(self.request.user, task):
            raise Http404
        return task

    # ---- edit ---------------------------------------------------------------------------------

    def update(self, request, *args, **kwargs):
        task = self.get_object()
        if not rules.can_edit(request.user, task):
            return _refusal(rules.NOT_ALLOWED)
        serializer = TaskWriteSerializer(task, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        task.refresh_from_db()
        return Response(TaskSerializer(task, context={'user': request.user}).data)

    def destroy(self, request, *args, **kwargs):
        task = self.get_object()
        reason = rules.delete_block_reason(request.user, task)
        if reason:
            return _refusal(reason)
        task.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ---- move ---------------------------------------------------------------------------------

    @action(detail=True, methods=['post'])
    def transition(self, request, pk=None):
        """`{status}` → the task, or a 409 with the word.

        **One WHERE-anchored `update()`**, not a read-then-save (`backend/CLAUDE.md` SQLite rule 1):
        two people clicking Done at the same moment must not both succeed, and `select_for_update`
        is a no-op on SQLite. The loser sees 0 rows changed and gets the same
        `illegal_transition` a genuinely wrong move gets — which is honest, because by the time
        their request ran, it *was* one.
        """
        task = self.get_object()
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = serializer.validated_data['status']
        if not rules.can_edit(request.user, task):
            return _refusal(rules.NOT_ALLOWED)
        reason = rules.transition_block_reason(task, target, request.user)
        if reason:
            return _refusal(reason)
        fields = {'status': target}
        # `done_at` records WHEN, which `status` cannot: set on the way in, cleared on a reopen so
        # a task that is todo again does not claim to have been finished.
        fields['done_at'] = timezone.now() if target == 'done' else None
        changed = Task.objects.filter(pk=task.pk, status=task.status).update(**fields)
        if not changed:
            return _refusal(rules.ILLEGAL_TRANSITION)
        task.refresh_from_db()
        return Response(TaskSerializer(task, context={'user': request.user}).data)

    # ---- staffing -----------------------------------------------------------------------------

    def _target_user(self, request):
        from django.contrib.auth import get_user_model

        serializer = AssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return get_user_model().objects.filter(pk=serializer.validated_data['user']).first()

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        task = self.get_object()
        target = self._target_user(request)
        reason = rules.assign_block_reason(request.user, task, target)
        if reason:
            return _refusal(reason)
        TaskAssignee.objects.create(task=task, user=target, assigned_by=request.user)
        task.refresh_from_db()
        return Response(TaskSerializer(task, context={'user': request.user}).data)

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        task = self.get_object()
        target = self._target_user(request)
        reason = rules.unassign_block_reason(request.user, task, target)
        if reason:
            return _refusal(reason)
        task.assignees.filter(user=target).delete()
        task.refresh_from_db()
        return Response(TaskSerializer(task, context={'user': request.user}).data)

    # ---- subtasks -----------------------------------------------------------------------------

    @action(detail=True, methods=['post'])
    def subtasks(self, request, pk=None):
        """One level. A subtask inherits its parent's node — it is never given one of its own, so
        the two can never drift apart and a subtask can never end up on a board its parent is not
        on."""
        parent = self.get_object()
        reason = rules.subtask_block_reason(request.user, parent)
        if reason:
            return _refusal(reason)
        serializer = TaskWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        child = Task.objects.create(
            content_type_id=parent.content_type_id,
            object_id=parent.object_id,
            parent=parent,
            created_by=request.user,
            **serializer.validated_data,
        )
        return Response(
            TaskSerializer(child, context={'user': request.user}).data,
            status=status.HTTP_201_CREATED,
        )

    # ---- mine ---------------------------------------------------------------------------------

    @action(detail=False, methods=['get'])
    def mine(self, request):
        """`GET /api/tasks/mine/` — everything of mine, in two lists.

        Two rather than one because they answer different questions: *assigned* is work waiting on
        me, *created* is work I am waiting on somebody else for. A task in both appears only in
        `assigned` — the same card twice on one page reads as a bug.

        The node-staff check runs in Python, over one person's own rows: it is bounded by how much
        one account carries, and there is no SQL form of it (see the module docstring).
        """
        user = request.user
        rows = _tasks_for_reading(
            Task.objects.filter(Q(assignees__user=user) | Q(created_by=user))
        ).distinct()
        assigned, created = [], []
        assigned_ids = set()
        for task in rows:
            if not rules.visible_task(user, task):
                continue
            if task.assignees.filter(user=user).exists():
                assigned.append(task)
                assigned_ids.add(task.pk)
            elif task.created_by_id == user.pk:
                created.append(task)
        assigned.sort(key=_mine_order)
        created.sort(key=_mine_order)
        context = {'user': user}
        return Response(
            {
                'assigned': TaskSerializer(assigned, many=True, context=context).data,
                'created': TaskSerializer(created, many=True, context=context).data,
            }
        )


def _mine_order(task):
    """Overdue first, then by due date, then by priority, then newest last.

    A task with no due date sorts after every dated one rather than before them: "no deadline" is
    not "due at the beginning of time", and sorting it first is how a board full of someday-items
    buries the thing that is due tomorrow.
    """
    closed = task.status in CLOSED_STATUSES
    overdue = rules.is_overdue(task)
    return (
        closed,
        not overdue,
        task.due_at is None,
        task.due_at or timezone.now(),
        task.priority,
        task.created_at,
    )
