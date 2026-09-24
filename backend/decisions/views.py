"""Poll endpoints: /api/nodes/<kind>/<pk>/polls/ and /api/polls/…"""

from django.db import models, transaction
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from config.nodes import can_view_node, resolve_node, can_manage_node, node_content_type
from moderation.permissions import feature_gate
from . import rules
from .models import Ballot, Poll, PollOption, Vote
from .serializers import (
    BallotSerializer,
    PollCreateSerializer,
    PollOptionCreateSerializer,
    PollOptionSerializer,
    PollSerializer,
    PollUpdateSerializer,
    PollVoteSerializer,
)

_PollsGate = feature_gate('decisions')


class NodePollsView(APIView):
    """GET|POST /api/nodes/<kind>/<pk>/polls/ — polls on a node."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _PollsGate]

    def get(self, request, kind, pk):
        """List polls on a node. Visibility is ruled by the poll status and eligibility."""
        node = resolve_node(kind, pk)
        if not node or not can_view_node(request.user, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        polls = rules.visible_polls(request.user, node)
        serializer = PollSerializer(polls, many=True, context={'request': request})
        return Response(serializer.data)

    def post(self, request, kind, pk):
        """Create a new poll on this node. Requires node manager."""
        node = resolve_node(kind, pk)
        if not node or not can_view_node(request.user, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        if not can_manage_node(request.user, node):
            return Response({'detail': 'not_manager'}, status=status.HTTP_403_FORBIDDEN)

        serializer = PollCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        poll = Poll.objects.create(
            content_type=node_content_type(node),
            object_id=node.pk,
            created_by=request.user,
            status='draft',
            **serializer.validated_data,
        )

        return Response(PollSerializer(poll, context={'request': request}).data, status=status.HTTP_201_CREATED)


class PollViewSet(viewsets.GenericViewSet):
    """Individual poll operations: GET, PATCH (draft only), DELETE (draft only)."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _PollsGate]
    serializer_class = PollSerializer

    def get_queryset(self):
        """All polls — visibility is checked per-object."""
        return Poll.objects.select_related('created_by', 'closed_by').prefetch_related('options', 'ballots', 'votes')

    def retrieve(self, request, pk=None):
        """GET /api/polls/{id}/"""
        poll = self.get_object()
        if not rules.can_view_poll(request.user, poll):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        return Response(PollSerializer(poll, context={'request': request}).data)

    def partial_update(self, request, pk=None):
        """PATCH /api/polls/{id}/ — update a draft poll."""
        poll = self.get_object()
        node = rules.poll_node(poll)

        if not node or not can_manage_node(request.user, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        if poll.status != 'draft':
            return Response({'detail': rules.NOT_DRAFT}, status=status.HTTP_409_CONFLICT)

        serializer = PollUpdateSerializer(poll, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(PollSerializer(poll, context={'request': request}).data)

    def destroy(self, request, pk=None):
        """DELETE /api/polls/{id}/ — delete a draft poll."""
        poll = self.get_object()
        node = rules.poll_node(poll)

        if not node or not can_manage_node(request.user, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        if poll.status != 'draft':
            return Response({'detail': rules.NOT_DRAFT}, status=status.HTTP_409_CONFLICT)

        poll.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _PollsGate])
    def options(self, request, pk=None):
        """POST /api/polls/{id}/options/ — add an option to a draft poll."""
        poll = self.get_object()
        node = rules.poll_node(poll)

        if not node or not can_manage_node(request.user, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        if poll.status != 'draft':
            return Response({'detail': rules.NOT_DRAFT}, status=status.HTTP_409_CONFLICT)

        serializer = PollOptionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        fields = dict(serializer.validated_data)
        if 'order' not in fields:
            # `order` is part of a unique constraint with `poll`, and the model default is 0 — so a
            # body that simply says `{"text": …}` (which is the whole of what §3.E's API line
            # promises) used to hit `UNIQUE constraint failed` and 500 on the second option. Append
            # instead, the way `plans` does for a step: a caller that names an order still gets it.
            highest = poll.options.aggregate(models.Max('order'))['order__max']
            fields['order'] = 0 if highest is None else highest + 1
        option = PollOption.objects.create(poll=poll, **fields)

        return Response(PollOptionSerializer(option).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _PollsGate])
    def open(self, request, pk=None):
        """POST /api/polls/{id}/open/ — open a draft poll for voting."""
        poll = self.get_object()
        node = rules.poll_node(poll)

        if not node or not can_manage_node(request.user, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        reason = rules.open_block_reason(poll)
        if reason:
            return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)

        poll.status = 'open'
        if not poll.opens_at:
            poll.opens_at = timezone.now()
        poll.save(update_fields=['status', 'opens_at'])

        return Response(PollSerializer(poll, context={'request': request}).data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _PollsGate])
    def close(self, request, pk=None):
        """POST /api/polls/{id}/close/ {decision_note} — close the poll and record the decision."""
        poll = self.get_object()
        node = rules.poll_node(poll)

        if not node or not can_manage_node(request.user, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        reason = rules.close_block_reason(poll)
        if reason:
            return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)

        poll.status = 'closed'
        poll.decision_note = (request.data.get('decision_note', '') or '').strip()
        poll.closed_by = request.user
        poll.closed_at = timezone.now()
        poll.save(update_fields=['status', 'decision_note', 'closed_by', 'closed_at'])

        return Response(PollSerializer(poll, context={'request': request}).data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _PollsGate])
    def vote(self, request, pk=None):
        """POST /api/polls/{id}/vote/ {options: [ids]} — cast a vote."""
        poll = self.get_object()
        node = rules.poll_node(poll)

        if not node or not can_view_node(request.user, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        serializer = PollVoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        option_ids = serializer.validated_data['options']

        # Check if voting is allowed
        reason = rules.vote_block_reason(request.user, poll, option_ids)
        if reason:
            return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)

        # Record the vote (atomically to avoid race conditions)
        with transaction.atomic():
            # Create ballot record (who voted)
            ballot = Ballot.objects.create(poll=poll, user=request.user)

            # Create vote records (what they voted for)
            votes = [Vote(poll=poll, option_id=opt_id, ballot=ballot if not poll.anonymous else None)
                     for opt_id in option_ids]
            Vote.objects.bulk_create(votes)

        return Response({'detail': 'ok'}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticatedOrReadOnly, _PollsGate])
    def results(self, request, pk=None):
        """GET /api/polls/{id}/results/ — poll results (ballots only for managers)."""
        poll = self.get_object()
        node = rules.poll_node(poll)

        # The same visibility gate `retrieve` uses, and for a stronger reason: this body carries
        # the option texts and the tally. Until §17BI.H it asked only `can_view_node`, so a reader
        # of a public course could read the results of a poll the course had never put to them.
        if not rules.can_view_poll(request.user, poll, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        if not rules.can_see_results(request.user, poll):
            return Response({'detail': 'not_authorized'}, status=status.HTTP_403_FORBIDDEN)

        results = {
            'options': [
                {'id': opt.id, 'text': opt.text, 'count': opt.votes.count()}
                for opt in poll.options.all().order_by('order')
            ],
            'ballots': BallotSerializer(
                poll.ballots.all().order_by('-cast_at'), many=True
            ).data if can_manage_node(request.user, node) else [],
            'eligible_count': rules.eligible_count(poll, node),
        }

        return Response(results)


class PollOptionViewSet(viewsets.GenericViewSet):
    """Delete poll options (draft only)."""

    permission_classes = [permissions.IsAuthenticated, _PollsGate]

    def get_queryset(self):
        return PollOption.objects.select_related('poll')

    def destroy(self, request, pk=None):
        """DELETE /api/poll-options/{id}/ — delete an option from a draft poll."""
        option = self.get_object()
        poll = option.poll
        node = rules.poll_node(poll)

        if not node or not can_manage_node(request.user, node):
            return Response({'detail': 'not_found'}, status=status.HTTP_404_NOT_FOUND)

        if poll.status != 'draft':
            return Response({'detail': rules.NOT_DRAFT}, status=status.HTTP_409_CONFLICT)

        option.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
