"""`/api/nodes/{kind}/{id}/plans/` and `/api/plans/…`, `/api/plan-steps/…`, `/api/plan-suggestions/…`
(MANAGEMENT-BRIEF.md §3.D).

Shape notes, because two of them are deliberate departures from a plain `ModelViewSet`:

- **The node-nested list is this app's own view**, not an `@action` on somebody else's viewset —
  `config/nodes.py` is read-only for this step, and `courses`/`events`/`materials` are untouched by
  it (MANAGEMENT-BRIEF.md §4 rule 1). It resolves the node itself and 404s exactly as
  `config.views.NodeRefView` does for the same reason (house rule 4).
- **Visibility is the queryset filter; authority is an object-level check, and both are here**
  (house rule 4). `PlanViewSet.get_object` (and its `PlanStepViewSet`/`PlanSuggestionViewSet`
  cousins) narrow to plans the caller can even SEE — a stranger on a draft gets 404, because for
  them it does not exist. Every mutating action then asks `rules.can_edit` explicitly, because a
  filter never runs for an action that arrives with an id in the URL, and answers with a **403**
  (the object was visible; the actor was not the right one) rather than a second 404 — cloakroom's
  own `can_operate`/`_operable` shape.

`PlanViewSet`/`PlanStepViewSet`/`PlanSuggestionViewSet` are `GenericViewSet`s with no `list`/
`create` methods of their own — DRF's router only binds an HTTP verb to a method that actually
exists (`config/routers.py`'s own `NumericPkRouter` narrows the id pattern; the verb-binding is
plain DRF), so `GET /api/plans/` is simply unrouted, exactly like `CloakroomDeskViewSet`.
"""

from django.db import models, transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from config import nodes
from moderation.permissions import feature_gate

from . import rules
from .models import Plan, PlanStep, PlanSuggestion
from .serializers import (
    DecideSerializer,
    PlanCreateSerializer,
    PlanSerializer,
    PlanStepCreateSerializer,
    PlanStepSerializer,
    PlanStepUpdateSerializer,
    PlanSuggestionCreateSerializer,
    PlanSuggestionSerializer,
    ReorderSerializer,
    TransitionSerializer,
)

_PlansGate = feature_gate('plans')


def _forbidden(reason: str) -> Response:
    return Response({'detail': reason}, status=status.HTTP_403_FORBIDDEN)


def _conflict(reason: str) -> Response:
    return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)


class NodePlansView(APIView):
    """`GET|POST /api/nodes/{kind}/{id}/plans/` — the roadmaps hung off one node.

    POST is node-manager only, like opening a cloakroom desk: drafting a roadmap is running the
    thing, not a contribution anybody on the roster makes casually. Suggesting on an active plan is
    the reader's way in (`plans/suggestions`, below).
    """

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _PlansGate]

    def _node(self, request, kind, pk):
        node = nodes.resolve_node(kind, pk)
        if node is None or not nodes.can_view_node(request.user, node):
            raise Http404
        return node

    def get(self, request, kind, pk):
        node = self._node(request, kind, pk)
        qs = (
            rules.visible_plans(request.user, node)
            .select_related('created_by')
            .prefetch_related('steps', 'steps__substeps')
        )
        return Response(PlanSerializer(qs, many=True, context={'request': request}).data)

    def post(self, request, kind, pk):
        node = self._node(request, kind, pk)
        if not nodes.can_manage_node(request.user, node):
            return _forbidden(rules.NOT_EDITOR)
        serializer = PlanCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        plan = Plan.objects.create(
            content_type=nodes.node_content_type(node),
            object_id=node.pk,
            created_by=request.user,
            **serializer.validated_data,
        )
        return Response(
            PlanSerializer(plan, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class PlanViewSet(viewsets.GenericViewSet):
    """One plan: reading it, editing its title/description, deleting a draft, moving its status,
    adding steps and reordering them, and its suggestion box."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _PlansGate]
    serializer_class = PlanSerializer

    def get_queryset(self):
        return Plan.objects.select_related('created_by').prefetch_related('steps', 'steps__substeps')

    def get_object(self):
        plan = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        if not rules.can_view_plan(self.request.user, plan):
            raise Http404
        return plan

    def retrieve(self, request, pk=None):
        return Response(PlanSerializer(self.get_object(), context={'request': request}).data)

    def partial_update(self, request, pk=None):
        """Title/description only — status moves through `transition/` so every change is checked
        against the same table, never a stray `PATCH {"status": …}` that skips it."""
        plan = self.get_object()
        if not rules.can_edit(request.user, plan):
            return _forbidden(rules.NOT_EDITOR)
        title = request.data.get('title', plan.title)
        description = request.data.get('description', plan.description)
        if not str(title).strip():
            raise DRFValidationError({'title': 'A plan needs a title.'})
        plan.title = str(title).strip()[:200]
        plan.description = description
        plan.save(update_fields=['title', 'description', 'updated_at'])
        return Response(PlanSerializer(plan, context={'request': request}).data)

    def destroy(self, request, pk=None):
        """Only while `draft` — a plan somebody has already seen active is a record of a decision
        (house rule 12), archived rather than deleted."""
        plan = self.get_object()
        if not rules.can_edit(request.user, plan):
            return _forbidden(rules.NOT_EDITOR)
        if plan.status != rules.DRAFT:
            return _conflict(rules.NOT_DRAFT)
        plan.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def transition(self, request, pk=None):
        plan = self.get_object()
        if not rules.can_edit(request.user, plan):
            return _forbidden(rules.NOT_EDITOR)
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        to_status = serializer.validated_data['status']
        reason = rules.transition_block_reason(plan, to_status)
        if reason:
            return _conflict(reason)
        # A single WHERE-anchored `update()` (backend/CLAUDE.md's SQLite rule 1): claim the CURRENT
        # status atomically so two editors racing the same transition don't both believe they made
        # it. The loser sees 0 rows and the world has genuinely moved by then.
        claimed = Plan.objects.filter(pk=plan.pk, status=plan.status).update(
            status=to_status, updated_at=timezone.now()
        )
        if not claimed:
            return _conflict(rules.ILLEGAL_TRANSITION)
        plan.refresh_from_db()
        return Response(PlanSerializer(plan, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def steps(self, request, pk=None):
        plan = self.get_object()
        if not rules.can_edit(request.user, plan):
            return _forbidden(rules.NOT_EDITOR)
        serializer = PlanStepCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent_id = serializer.validated_data.get('parent')
        parent = None
        if parent_id:
            parent = get_object_or_404(plan.steps, pk=parent_id)
            if parent.parent_id is not None:
                return _conflict(rules.NESTED)
        siblings = plan.steps.filter(parent=parent)
        next_order = (siblings.aggregate(models.Max('order'))['order__max'] or 0) + 1
        step = plan.steps.create(
            parent=parent,
            title=serializer.validated_data['title'],
            description=serializer.validated_data.get('description', ''),
            due_at=serializer.validated_data.get('due_at'),
            order=next_order,
        )
        return Response(
            PlanStepSerializer(step, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def reorder(self, request, pk=None):
        plan = self.get_object()
        if not rules.can_edit(request.user, plan):
            return _forbidden(rules.NOT_EDITOR)
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data['ids']
        parent_id = serializer.validated_data.get('parent')
        if not rules.reorder(plan, ids, parent_id=parent_id):
            raise DRFValidationError({'ids': "Must be exactly this group's step ids, once each."})
        with transaction.atomic():
            for index, step_id in enumerate(ids):
                PlanStep.objects.filter(pk=step_id, plan=plan).update(order=index)
        plan.refresh_from_db()
        return Response(PlanSerializer(plan, context={'request': request}).data)

    @action(detail=True, methods=['get', 'post'])
    def suggestions(self, request, pk=None):
        plan = self.get_object()
        if request.method == 'GET':
            if not rules.can_edit(request.user, plan):
                return _forbidden(rules.NOT_EDITOR)
            qs = plan.suggestions.select_related('user', 'decided_by', 'created_step')
            return Response(
                PlanSuggestionSerializer(qs, many=True, context={'request': request}).data
            )

        serializer = PlanSuggestionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = rules.suggest_block_reason(request.user, plan)
        if reason:
            # `not_active` is the plan having moved since the reader opened it (409); `minor` and
            # `own_plan` are about who is asking, not what state the plan is in (403).
            if reason == rules.NOT_ACTIVE:
                return _conflict(reason)
            return _forbidden(reason)
        suggestion = plan.suggestions.create(user=request.user, text=serializer.validated_data['text'])
        return Response(
            PlanSuggestionSerializer(suggestion, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class PlanStepViewSet(viewsets.GenericViewSet):
    """`PATCH|DELETE /api/plan-steps/{id}/` — everything about ONE step except its order, which
    moves through the plan's own `reorder/` action so a drag always describes a complete group."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _PlansGate]
    serializer_class = PlanStepUpdateSerializer

    def get_object(self):
        step = get_object_or_404(PlanStep.objects.select_related('plan'), pk=self.kwargs['pk'])
        if not rules.can_view_plan(self.request.user, step.plan):
            raise Http404
        return step

    def partial_update(self, request, pk=None):
        step = self.get_object()
        if not rules.can_edit(request.user, step.plan):
            return _forbidden(rules.NOT_EDITOR)
        serializer = PlanStepUpdateSerializer(step, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        was_done = step.status == 'done'
        step = serializer.save()
        # `done_by`/`done_at` are a fact about the moment a step became done, not folded into
        # `status` itself (models.py) — kept in step with `status` here, the one place it changes.
        if step.status == 'done' and not was_done:
            step.done_by, step.done_at = request.user, timezone.now()
            step.save(update_fields=['done_by', 'done_at'])
        elif step.status != 'done' and was_done:
            step.done_by, step.done_at = None, None
            step.save(update_fields=['done_by', 'done_at'])
        return Response(PlanStepSerializer(step, context={'request': request}).data)

    def destroy(self, request, pk=None):
        step = self.get_object()
        if not rules.can_edit(request.user, step.plan):
            return _forbidden(rules.NOT_EDITOR)
        step.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlanSuggestionViewSet(viewsets.GenericViewSet):
    """`POST /api/plan-suggestions/{id}/decide/` and `/withdraw/` — a suggestion never PATCHes;
    it only ever moves once, from `pending` to one terminal word."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _PlansGate]
    serializer_class = PlanSuggestionSerializer

    def get_object(self):
        suggestion = get_object_or_404(
            PlanSuggestion.objects.select_related('plan', 'user'), pk=self.kwargs['pk']
        )
        if not rules.can_view_plan(self.request.user, suggestion.plan):
            raise Http404
        return suggestion

    @action(detail=True, methods=['post'])
    def decide(self, request, pk=None):
        suggestion = self.get_object()
        if not rules.can_edit(request.user, suggestion.plan):
            return _forbidden(rules.NOT_EDITOR)
        serializer = DecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = rules.decide_block_reason(suggestion)
        if reason:
            return _conflict(reason)
        decision = serializer.validated_data['decision']
        with transaction.atomic():
            claimed = PlanSuggestion.objects.filter(pk=suggestion.pk, status='pending').update(
                status='accepted' if decision == 'accept' else 'rejected',
                decided_by=request.user,
                decided_at=timezone.now(),
            )
            if not claimed:
                return _conflict(rules.ALREADY_DECIDED)
            if decision == 'accept':
                plan = suggestion.plan
                siblings = plan.steps.filter(parent__isnull=True)
                next_order = (siblings.aggregate(models.Max('order'))['order__max'] or 0) + 1
                text = suggestion.text.strip()
                step = plan.steps.create(
                    title=text[:200],
                    # Only carried into the description when the title actually had to truncate —
                    # a short suggestion becoming a step whose title AND description repeat the
                    # same sentence read as a rendering bug the first time this was looked at in a
                    # browser (house rule 2), not two pieces of information.
                    description=text if len(text) > 200 else '',
                    order=next_order,
                )
                PlanSuggestion.objects.filter(pk=suggestion.pk).update(created_step=step)
        suggestion.refresh_from_db()
        return Response(PlanSuggestionSerializer(suggestion, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def withdraw(self, request, pk=None):
        suggestion = self.get_object()
        reason = rules.withdraw_block_reason(request.user, suggestion)
        if reason == rules.NOT_OWN_SUGGESTION:
            return _forbidden(reason)
        if reason:
            return _conflict(reason)
        claimed = PlanSuggestion.objects.filter(pk=suggestion.pk, status='pending').update(
            status='withdrawn'
        )
        if not claimed:
            return _conflict(rules.ALREADY_DECIDED)
        suggestion.refresh_from_db()
        return Response(PlanSuggestionSerializer(suggestion, context={'request': request}).data)
