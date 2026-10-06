"""`/api/decks/…`, `/api/cards/…`, `/api/deck-placements/…`, `/api/nodes/{kind}/{pk}/decks/` and
`/api/flashcards/due/` (prompts/02-flashcards.md §API).

**Every path is behind `feature_gate('flashcards')`**, reads included — that is what a kill switch
means here (`moderation/permissions.py`: every action, not just writes, with a global-staff
bypass). The frontend's half of house rule 3 is that the account-menu item, the save-menu section,
the "make a deck" buttons and the placement panels all disappear with it.

**Visibility is the queryset filter; authority is an object-level check, and both are here**
(house rule 4). `DeckViewSet.get_queryset()` is `rules.visible_decks`, so a stranger's
`GET /api/decks/{id}/` 404s through DRF's own `get_object()`; every action then asks
`rules.can_study` or `rules.can_edit` explicitly, because a queryset filter never runs for an
action that arrives with an id in the URL — and `can_study` is wider than `can_edit`, so a
participant who may study a placed deck must not be able to rename it.

**Refusals carry a word** (house rule 6), and the word's status code says which kind of refusal it
is (root `CLAUDE.md`): `already_placed` is the world having moved → **409**; `not_owner`, `kind`
and `cannot_manage` are about who is asking → **403**; a malformed body is **400**.
"""

from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from config import nodes as node_seam
from config.audience import DEFAULT_AUDIENCE
from exercises.models import Exercise
from moderation.permissions import feature_gate

from . import rules
from .models import Card, Deck, DeckPlacement
from .serializers import (
    CardDraftSerializer,
    CardEditSerializer,
    CardSerializer,
    DeckDraftSerializer,
    DeckPlacementSerializer,
    DeckSerializer,
    GradeSerializer,
    NodeDeckPlacementSerializer,
    NodeRefSerializer,
    ReviewStateSerializer,
)

_FlashcardsGate = feature_gate('flashcards')

#: `place_block_reason` words that mean "the world moved" rather than "who you are".
_PLACE_CONFLICTS = {rules.ALREADY_PLACED}


def _place_refusal_status(reason: str) -> int:
    return (
        status.HTTP_409_CONFLICT if reason in _PLACE_CONFLICTS else status.HTTP_403_FORBIDDEN
    )


def _card_queryset():
    return Card.objects.select_related(
        'deck', 'deck__owner', 'exercise', 'exercise__branch', 'concept'
    ).prefetch_related('exercise__translations', 'concept__articles__revisions')


def _resolve_source(kind: str, raw_id: str, user):
    """`({'source_kind', 'source_id', 'source_set'})` for a `{kind, id}` the client sent.

    The four kinds are addressed differently on this site (`SourceRefSerializer` says why), so this
    is the one place that translates. An id that resolves to nothing leaves `source_id` null and
    keeps the kind: provenance that has lost its target is still provenance, and refusing the whole
    deck because a lesson was renumbered would be the wrong trade.

    For a **set** it also fills `source_set`, the one real FK — and only for a set this person may
    actually read (`study/views.py`'s own rule: public, or their own), so that a deck cannot be
    made to hold a pointer into somebody else's private set.
    """
    out = {'source_kind': kind, 'source_id': None, 'source_set': None}
    raw_id = (raw_id or '').strip()
    if not raw_id:
        return out
    if kind == 'set':
        from study.models import ExerciseSet

        qs = ExerciseSet.objects.all()
        found = (
            qs.filter(pk=int(raw_id)).first() if raw_id.isdigit() else qs.filter(slug=raw_id).first()
        )
        if found is not None and (
            found.is_public
            or (user is not None and user.is_authenticated and found.owner_id == user.pk)
        ):
            out['source_set'] = found
            out['source_id'] = found.pk
        return out
    if kind == 'concept':
        from concepts.models import Concept

        if raw_id.isdigit():
            out['source_id'] = int(raw_id)
        else:
            found = Concept.objects.filter(slug=raw_id).first()
            out['source_id'] = found.pk if found is not None else None
        return out
    # A lesson (step C) and a session (step E) are plain numeric pks in their own apps. Stored as a
    # number and never joined on — this app does not import `courses` or `events` for it, which is
    # exactly prompts/README.md §5 rule 1 (no migration, and no dependency, outside your own app).
    out['source_id'] = int(raw_id) if raw_id.isdigit() else None
    return out


def _addable_exercises(ids, user):
    """`{pk: Exercise}` for the ids this caller may actually put on a card.

    "May see" is `Exercise.published` — the switch a moderator's removal and the auto-hide
    threshold both flip (`exercises/models.py`) and the one `ExerciseViewSet.get_queryset` browses
    by. Widened by the two cases that endpoint also widens: global staff, and somebody's own
    unpublished submission (its `?unpublished=1` branch). Everything else is silently **skipped**
    and counted, because a "make a deck from this set" that refused the whole set over one pulled
    exercise would be useless at exactly the moment it mattered.
    """
    if not ids:
        return {}
    qs = Exercise.objects.filter(pk__in=ids).select_related('branch')
    if not (user is not None and user.is_authenticated and user.is_staff):
        condition = Q(published=True)
        if user is not None and user.is_authenticated:
            condition = condition | Q(submitted_by=user)
        qs = qs.filter(condition)
    return {exercise.pk: exercise for exercise in qs}


class DeckViewSet(viewsets.ModelViewSet):
    """`/api/decks/` and `/api/decks/{id}/…`."""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _FlashcardsGate]
    serializer_class = DeckSerializer

    def get_queryset(self):
        return rules.visible_decks(self.request.user)

    # ---- list / create ------------------------------------------------------------------------

    def list(self, request, *args, **kwargs):
        """The caller's **own** decks, or — with `?placed_on=<kind>:<id>` — the decks placed on
        that node which the caller may study.

        Own decks only, deliberately: "My decks" is a page about mine, and a deck somebody placed
        on a course I am enrolled on belongs on that course's page where I can tell whose it is.
        Mixing them would make a list nobody could read.
        """
        placed_on = request.query_params.get('placed_on')
        if placed_on:
            parsed = rules.parse_placed_on(placed_on)
            if parsed is None:
                # A malformed filter degrades to "no filter" rather than refusing
                # (`config/audience.py`'s own posture for `?audience=`).
                return Response(self.get_serializer(rules.own_decks(request.user), many=True).data)
            node = node_seam.resolve_node(*parsed)
            if node is None or not node_seam.can_view_node(request.user, node):
                # Naming a node this caller cannot see must not confirm that it exists — house
                # rule 4, the same 404 `NodeDecksView` gives for the same question.
                raise Http404
            placements = rules.node_placements(request.user, node)
            decks = [placement.deck for placement in placements]
            return Response(self.get_serializer(decks, many=True).data)
        return Response(self.get_serializer(rules.own_decks(request.user), many=True).data)

    def create(self, request, *args, **kwargs):
        """Make a deck, optionally from a list of exercises, optionally placed somewhere.

        The ONE endpoint steps C, D and E call (`prompts/02-flashcards.md` §API; their button is
        `frontend/src/lib/services/flashcards.ts: createDeckFromExercises`, whose signature the prep
        commit fixed before this app existed). Three things it guarantees to them:

        1. **One card per id, in the order the ids arrived** — a problem set is a sequence, and a
           deck made from week 3 should open in week 3's order.
        2. **Ids the caller may not see are skipped, not refused**, and the count rides back as
           `skipped` so the button can say "two were left out" instead of failing.
        3. **A refused placement does not lose the deck.** The deck is created first and answered
           in the 403 body, so a curator who was not the deck's owner still has the thing they
           made. Refusing the whole request would mean a round trip that silently did nothing.
        """
        draft = DeckDraftSerializer(data=request.data, context={'request': request})
        draft.is_valid(raise_exception=True)
        data = draft.validated_data
        source = data.get('source') or {}
        resolved = (
            _resolve_source(source['kind'], source['id'], request.user)
            if source
            else {'source_kind': '', 'source_id': None, 'source_set': None}
        )
        deck = Deck.objects.create(
            owner=request.user,
            name=data['name'],
            audience=data.get('audience') or DEFAULT_AUDIENCE,
            **resolved,
        )

        raw_ids = data.get('exercise_ids') or []
        # De-duplicated, keeping first appearance: the same exercise twice in one deck is the same
        # card twice with two schedules, which is not something anybody asked for. Counted as
        # skipped so the number the client is told matches the number of cards it did not get.
        wanted, seen = [], set()
        for pk in raw_ids:
            if pk in seen:
                continue
            seen.add(pk)
            wanted.append(pk)
        found = _addable_exercises(wanted, request.user)
        cards = [
            Card(deck=deck, order=index, exercise=found[pk])
            for index, pk in enumerate(pk for pk in wanted if pk in found)
        ]
        # `bulk_create` skips `Card.save()`, which is where the faces are sanitized — safe here
        # and only here, because every card built on this path is an EXERCISE card whose `front`
        # and `back` are empty strings. A free-text card always goes through `cards` below.
        Card.objects.bulk_create(cards)
        skipped = len(raw_ids) - len(cards)

        placement = data.get('placement')
        placement_reason = None
        if placement:
            node = node_seam.resolve_node(placement['kind'], placement['id'])
            placement_reason = rules.place_block_reason(request.user, deck, node)
            if placement_reason is None:
                rules.place(request.user, deck, node)

        deck.refresh_from_db()
        body = DeckSerializer(deck, context={'request': request}).data
        body['skipped'] = skipped
        if placement_reason is not None:
            return Response(
                {'detail': placement_reason, 'deck': body},
                status=_place_refusal_status(placement_reason),
            )
        return Response(body, status=status.HTTP_201_CREATED)

    # ---- retrieve / edit / delete --------------------------------------------------------------

    def retrieve(self, request, *args, **kwargs):
        deck = self.get_object()
        if not rules.can_study(request.user, deck):
            raise Http404
        return Response(self.get_serializer(deck).data)

    def _editable_or_404(self) -> Deck:
        deck = self.get_object()
        if not rules.can_edit(self.request.user, deck):
            # 404 rather than 403: the queryset let them SEE it because it is placed on their
            # course, and "you may look but not touch" is not a thing this API says about a deck —
            # for a non-owner, an editable deck does not exist.
            raise Http404
        return deck

    def update(self, request, *args, **kwargs):
        """PATCH **and PUT**, through one method. `UpdateModelMixin` binds both verbs, and
        overriding only `partial_update` leaves PUT running DRF's own — which asks `get_queryset()`
        (visibility) and never the authority check. That exact hole shipped once in `needs`
        (§17BI.H) and is recorded in `needs/views.py`; it is not shipping again here."""
        deck = self._editable_or_404()
        serializer = self.get_serializer(
            deck, data=request.data, partial=kwargs.get('partial', False)
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """A real delete, unlike most things here. House rule 12 asks for a tombstone where a
        thread or a link would break: nothing on this site links to a deck except its own
        placements (cascaded) and its own review rows (the schedule for cards that no longer
        exist), there is no conversation anchored to it, and a deck somebody built for one exam is
        not a decision the platform has a reason to keep. The `ReviewLog` rows go with it, which is
        the honest reading of "delete my deck" — a learner removing their own measurement."""
        deck = self._editable_or_404()
        deck.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ---- cards --------------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'])
    def cards(self, request, pk=None):
        deck = self.get_object()
        if request.method == 'GET':
            if not rules.can_study(request.user, deck):
                raise Http404
            rows = rules.visible_cards(deck, request.user)
            return Response(CardSerializer(rows, many=True, context={'request': request}).data)

        if not rules.can_edit(request.user, deck):
            raise Http404
        draft = CardDraftSerializer(data=request.data)
        draft.is_valid(raise_exception=True)
        data = draft.validated_data
        exercise = None
        concept = None
        if data.get('exercise') is not None:
            exercise = _addable_exercises([data['exercise']], request.user).get(data['exercise'])
            if exercise is None:
                # Not 404 on the deck — the deck is fine; the exercise is the problem, and saying
                # so is the difference between "your deck is gone" and "that exercise is not
                # available".
                return Response(
                    {'detail': 'exercise_not_available'}, status=status.HTTP_400_BAD_REQUEST
                )
        elif (data.get('concept') or '').strip():
            from concepts.access import visible_concepts

            slug = data['concept'].strip()
            concept = visible_concepts(request.user).filter(slug=slug).first()
            if concept is None:
                return Response(
                    {'detail': 'concept_not_available'}, status=status.HTTP_400_BAD_REQUEST
                )
        card = Card.objects.create(
            deck=deck,
            order=deck.cards.count(),
            exercise=exercise,
            concept=concept,
            front=data.get('front', '') or '',
            back=data.get('back', '') or '',
            include_hint=data.get('include_hint', False),
            include_solution=data.get('include_solution', False),
        )
        card = _card_queryset().get(pk=card.pk)
        return Response(
            CardSerializer(card, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    # ---- the review queue ----------------------------------------------------------------------

    @action(detail=True, methods=['get'])
    def review(self, request, pk=None):
        """`{cards: [...], counts: {due, new, learned, total}}` — this caller's own queue, never
        anybody else's (`rules.review_queue`, and `ReviewState` is unique per person per card).
        Recomputed on every request: nothing is held server-side, so finishing a session and asking
        again hands over the next one."""
        deck = self.get_object()
        if not rules.can_study(request.user, deck):
            raise Http404
        if not request.user.is_authenticated:
            # A deck can be world-readable; a schedule cannot. A guest gets the cards with no
            # counts rather than an error, so an anonymous reader of a public deck still sees what
            # is on it.
            cards = rules.visible_cards(deck, request.user)
            return Response(
                {
                    'cards': CardSerializer(cards, many=True, context={'request': request}).data,
                    'counts': {'due': 0, 'new': len(cards), 'learned': 0, 'total': len(cards)},
                }
            )
        cards, counts = rules.review_queue(request.user, deck)
        return Response(
            {
                'cards': CardSerializer(cards, many=True, context={'request': request}).data,
                'counts': counts,
            }
        )

    # ---- copy ---------------------------------------------------------------------------------

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _FlashcardsGate])
    def copy(self, request, pk=None):
        """A private copy of a deck the caller can study — a **membership snapshot**
        (`rules.copy_for`). This is the answer to "may a curator edit a deck placed on their
        course": no, and here is the copy they can."""
        deck = self.get_object()
        if not rules.can_study(request.user, deck):
            raise Http404
        copy = rules.copy_for(request.user, deck)
        return Response(
            DeckSerializer(copy, context={'request': request}).data, status=status.HTTP_201_CREATED
        )

    # ---- placements ----------------------------------------------------------------------------

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _FlashcardsGate])
    def placements(self, request, pk=None):
        deck = self.get_object()
        draft = NodeRefSerializer(data=request.data)
        draft.is_valid(raise_exception=True)
        node = node_seam.resolve_node(draft.validated_data['kind'], draft.validated_data['id'])
        reason = rules.place_block_reason(request.user, deck, node)
        if reason:
            return Response({'detail': reason}, status=_place_refusal_status(reason))
        placement = rules.place(request.user, deck, node)
        return Response(
            DeckPlacementSerializer(placement, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class CardViewSet(
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """`/api/cards/{id}/` — edit or delete one card, and grade it.

    No `list` and no `retrieve`: a card is always reached through its deck
    (`/api/decks/{id}/cards/` or the review queue), the same shape
    `exercises.ExerciseRequirementViewSet` already uses for a row that has no page of its own.
    """

    permission_classes = [permissions.IsAuthenticated, _FlashcardsGate]
    serializer_class = CardEditSerializer

    def get_queryset(self):
        return _card_queryset()

    def _editable_or_404(self) -> Card:
        card = get_object_or_404(self.get_queryset(), pk=self.kwargs['pk'])
        if not rules.can_edit(self.request.user, card.deck):
            raise Http404
        return card

    def update(self, request, *args, **kwargs):
        """PATCH and PUT through one method — the same `UpdateModelMixin` trap `DeckViewSet.update`
        documents."""
        card = self._editable_or_404()
        serializer = self.get_serializer(
            card, data=request.data, partial=kwargs.get('partial', False)
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        card = _card_queryset().get(pk=card.pk)
        return Response(CardSerializer(card, context={'request': request}).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        card = self._editable_or_404()
        card.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def grade(self, request, pk=None):
        """One press of one of the four buttons. `can_study`, not `can_edit`: grading is what a
        participant does to a deck placed on their course, and it writes only to their own rows."""
        card = get_object_or_404(self.get_queryset(), pk=pk)
        if not rules.can_study(request.user, card.deck):
            raise Http404
        draft = GradeSerializer(data=request.data)
        draft.is_valid(raise_exception=True)
        state = rules.apply_grade(request.user, card, draft.validated_data['grade'])
        return Response(ReviewStateSerializer(state).data)


class DeckPlacementViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """`DELETE /api/deck-placements/{id}/` — unplace a deck. Three parties may
    (`rules.can_remove_placement`); everyone else gets 404."""

    permission_classes = [permissions.IsAuthenticated, _FlashcardsGate]
    serializer_class = DeckPlacementSerializer
    queryset = DeckPlacement.objects.select_related('deck', 'deck__owner', 'content_type')

    def destroy(self, request, *args, **kwargs):
        placement = get_object_or_404(self.get_queryset(), pk=kwargs['pk'])
        if not rules.can_remove_placement(request.user, placement):
            raise Http404
        placement.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NodeDecksView(APIView):
    """`GET /api/nodes/{kind}/{pk}/decks/` — this app's own nested route, not an `@action` on
    `courses` or `events` (prompts/README.md §5 rule 1: nothing in those apps moves). 404 unless
    the caller can view the node, which is the same answer the node's own page gives them."""

    permission_classes = [permissions.AllowAny, _FlashcardsGate]

    def get(self, request, kind, pk):
        node = node_seam.resolve_node(kind, pk)
        if node is None or not node_seam.can_view_node(request.user, node):
            raise Http404
        rows = rules.node_placements(request.user, node)
        return Response(
            NodeDeckPlacementSerializer(rows, many=True, context={'request': request}).data
        )


class DueView(APIView):
    """`GET /api/flashcards/due/` — `{decks: [{id, name, due}], total}` across the decks this
    person has a real relationship with (`rules.my_study_decks`, whose docstring says why that is
    narrower than "every deck they may study")."""

    permission_classes = [permissions.IsAuthenticated, _FlashcardsGate]

    def get(self, request):
        rows = []
        total = 0
        for deck in rules.my_study_decks(request.user):
            due = rules.due_count(request.user, deck)
            if due == 0:
                continue
            rows.append({'id': str(deck.pk), 'name': deck.name, 'due': due})
            total += due
        rows.sort(key=lambda row: (-row['due'], row['name']))
        return Response({'decks': rows, 'total': total})
