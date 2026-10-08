"""`/api/nodes/{kind}/{id}/goals/`, `/api/goals/{id}/…` and `/api/goal-criteria/{id}/…`.

**Visibility is the queryset filter; authority is an object-level check, and both are here** (house
rule 4). `GoalViewSet.get_queryset()` cannot be a visibility filter — a goal's node is a
`GenericForeignKey` across four models with four different rules, so the join does not exist — which
is why every path through this module asks `rules.can_view_goal` explicitly and raises `Http404`,
and every path that MUTATES then asks `rules.can_edit` or `rules.can_tick` on top of it.

**`destroy` is bounded rather than absent.** A goal carries a discussion thread
(`community/discussions.py`, `goals/<id>`) and tasks and plans point at it, so `abandoned` is the
tombstone for anything anybody has relied on (house rule 12) — but a goal somebody typed by mistake
a minute ago never meant anything, and a board accumulating "Abandoned: Untitlde" forever is a board
people stop reading. `rules.delete_block_reason` is the `sweep_discussion_locations` test applied to
a goal: no task or plan serving it and no comment of any kind under it, else 409 with the word. A
*criterion* deletes unconditionally, because nothing hangs off one and editing a checklist means
removing lines from it.
"""

from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from config import nodes as node_seam
from moderation.permissions import feature_gate

from . import rules
from .models import Goal, GoalCriterion
from .serializers import CriterionOrderSerializer, GoalCriterionSerializer, GoalSerializer

_GoalsGate = feature_gate('goals')

#: What a goal's rows need loaded before they are serialized: the criteria and, for both the goal
#: and each criterion, the languages its text has been written in (`translations/`). Without the
#: second one, a node with ten goals of five criteria each resolves sixty times.
_PREFETCH = ('criteria__text_versions', 'criteria__met_by__profile', 'text_versions')


def _goals_queryset():
    return Goal.objects.select_related(
        'content_type', 'created_by__profile', 'met_by__profile'
    ).prefetch_related(*_PREFETCH)


class NodeGoalsView(APIView):
    """`/api/nodes/{kind}/{id}/goals/` — this app's own nested route (MANAGEMENT-BRIEF.md §2: the
    nested routes hang under the same prefix in *this* app's `urls.py`, so nothing in `courses`,
    `events`, `materials` or `organizations` moves).

    GET is anybody who can see the node — a goal is the outside of a team, not the inside
    (`rules.py`, "Visibility is the node's"). POST is the node's own manager: stating what a course
    or an organisation is trying to achieve is running it.
    """

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _GoalsGate]

    def _node(self, request, kind, pk):
        node = node_seam.resolve_node(kind, pk)
        if node is None or not node_seam.can_view_node(request.user, node):
            raise Http404
        return node

    def get(self, request, kind, pk):
        node = self._node(request, kind, pk)
        ids = rules.visible_goals(request.user, node).values_list('pk', flat=True)
        qs = _goals_queryset().filter(pk__in=list(ids))
        return Response(GoalSerializer(qs, many=True, context={'request': request}).data)

    def post(self, request, kind, pk):
        node = self._node(request, kind, pk)
        if not node_seam.can_manage_node(request.user, node):
            return Response({'detail': rules.NOT_MANAGER}, status=status.HTTP_403_FORBIDDEN)
        serializer = GoalSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        goal = serializer.save(
            content_type=node_seam.node_content_type(node),
            object_id=node.pk,
            created_by=request.user,
        )
        return Response(
            GoalSerializer(goal, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class GoalViewSet(
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """`/api/goals/{id}/` — one goal, its edits, its criteria and its hand transitions.

    No `list`: a goal has no site-wide board. It is always read through the node it belongs to,
    which is also the only place a reader has any context for it — "740 exercises with verified
    solutions" means nothing without the body that said it.
    """

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _GoalsGate]
    serializer_class = GoalSerializer

    def get_queryset(self):
        return _goals_queryset()

    def get_object(self) -> Goal:
        goal = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        if not rules.can_view_goal(self.request.user, goal):
            # 404, not 403: for this reader the node does not exist, so neither does its goal
            # (house rule 4).
            raise Http404
        return goal

    def _editable(self, goal: Goal):
        if not rules.can_edit(self.request.user, goal):
            return Response({'detail': rules.NOT_MANAGER}, status=status.HTTP_403_FORBIDDEN)
        return None

    def update(self, request, *args, **kwargs):
        goal = self.get_object()
        refusal = self._editable(goal)
        if refusal is not None:
            return refusal
        serializer = self.get_serializer(goal, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        # A status in the body goes through the hand-transition table, not straight onto the row:
        # `open -> abandoned` is a decision, and `open -> met` is not a decision anybody gets to
        # make (`rules.py`, "`met` is DERIVED"). The serializer has already refused a literal `met`.
        wanted = serializer.validated_data.get('status')
        if wanted is not None and wanted != goal.status:
            reason = rules.transition_block_reason(goal, wanted)
            if reason is not None:
                return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)
        serializer.save()
        goal.refresh_from_db()
        return Response(GoalSerializer(goal, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        """Only a goal nobody has relied on — `rules.delete_block_reason` argues which, and
        answers `has_work` or `has_comments`, each of which is a 409: the request was understood,
        the world is just not where it thought it was. `abandoned` is what to do with the rest."""
        goal = self.get_object()
        refusal = self._editable(goal)
        if refusal is not None:
            return refusal
        reason = rules.delete_block_reason(goal)
        if reason is not None:
            return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)
        goal.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='criteria')
    def add_criterion(self, request, pk=None):
        """One line of the definition of done at a time. A whole-list PUT would make two people
        editing two different criteria overwrite each other's."""
        goal = self.get_object()
        refusal = self._editable(goal)
        if refusal is not None:
            return refusal
        serializer = GoalCriterionSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        # Appended at the end unless the client says otherwise: a new condition is the next one,
        # and `order` ties fall back to `id` so an unset order is still stable.
        order = serializer.validated_data.get('order')
        if order is None:
            order = goal.criteria.count()
        criterion = serializer.save(goal=goal, order=order)
        # Adding an open criterion to a goal the criteria had declared met re-opens it — the
        # recount is the only writer and it runs on every change to the list (house rule 5).
        rules.recount(goal)
        return Response(
            GoalCriterionSerializer(criterion, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'], url_path='reorder')
    def reorder(self, request, pk=None):
        """The whole list of criterion ids in the order wanted — `plans`' own reorder shape, and
        for the same reason: a definition of done is read in order, and two adjacent swaps arriving
        out of order would leave it in neither arrangement."""
        goal = self.get_object()
        refusal = self._editable(goal)
        if refusal is not None:
            return refusal
        serializer = CriterionOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        wanted = serializer.validated_data['ids']
        mine = {criterion.pk for criterion in goal.criteria.all()}
        if set(wanted) != mine:
            # The whole list or nothing: a partial order would silently renumber the rows it did
            # not mention. 400 because the request is malformed, not because the world moved.
            return Response(
                {'ids': ['Send every criterion of this goal exactly once.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        for position, criterion_id in enumerate(wanted):
            GoalCriterion.objects.filter(pk=criterion_id, goal=goal).update(order=position)
        goal.refresh_from_db()
        return Response(GoalSerializer(goal, context={'request': request}).data)


class GoalCriterionViewSet(
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """`/api/goal-criteria/{id}/` — edit a line, remove a line, tick it off, un-tick it.

    A criterion deletes for real, unlike its goal: nothing hangs off one — no thread, no task
    pointing at it — so removing a line from a checklist is just that, and a tombstoned criterion
    would make a definition of done unreadable.
    """

    permission_classes = [permissions.IsAuthenticated, _GoalsGate]
    serializer_class = GoalCriterionSerializer

    def get_queryset(self):
        return GoalCriterion.objects.select_related('goal', 'met_by__profile').prefetch_related(
            'text_versions'
        )

    def get_object(self) -> GoalCriterion:
        criterion = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        if not rules.can_view_goal(self.request.user, criterion.goal):
            raise Http404
        return criterion

    def update(self, request, *args, **kwargs):
        criterion = self.get_object()
        if not rules.can_edit(request.user, criterion.goal):
            return Response({'detail': rules.NOT_MANAGER}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(criterion, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        criterion = self.get_object()
        goal = criterion.goal
        if not rules.can_edit(request.user, goal):
            return Response({'detail': rules.NOT_MANAGER}, status=status.HTTP_403_FORBIDDEN)
        criterion.delete()
        # Removing the last OPEN line is how a goal can become met by a deletion — which is honest
        # (the definition of done is now shorter and entirely satisfied) and is why the recount runs
        # here too rather than only on a tick.
        rules.recount(goal)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post', 'delete'], url_path='tick')
    def tick(self, request, pk=None):
        """`POST` records this criterion as met, `DELETE` un-records it — the node's staff, not
        only its managers (`rules.can_tick`).

        A WHERE-anchored `update()` on `met_at`, so two people ticking the same line at once do not
        both think they were the one who did it: the loser changes no row and the response simply
        says what is now true (`backend/CLAUDE.md`'s SQLite rule).
        """
        criterion = self.get_object()
        goal = criterion.goal
        if not rules.can_tick(request.user, goal):
            return Response({'detail': rules.NOT_STAFF}, status=status.HTTP_403_FORBIDDEN)
        if request.method == 'POST':
            GoalCriterion.objects.filter(pk=criterion.pk, met_at__isnull=True).update(
                met_at=timezone.now(), met_by=request.user
            )
            # Whoever closed the last open line is who the goal records as having met it.
            goal.met_by = request.user
        else:
            GoalCriterion.objects.filter(pk=criterion.pk, met_at__isnull=False).update(
                met_at=None, met_by=None
            )
        criterion.refresh_from_db()
        rules.recount(goal)
        goal.refresh_from_db()
        return Response(
            {
                'criterion': GoalCriterionSerializer(
                    criterion, context={'request': request}
                ).data,
                # The goal comes back with it, because ticking the last line changes the goal's own
                # status and a client that had to re-fetch to find out would draw a stale "open" for
                # a moment.
                'goal': GoalSerializer(goal, context={'request': request}).data,
            }
        )
