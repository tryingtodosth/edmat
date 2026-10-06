"""Every "may this person" and "what is in this queue" question about a deck, in one module.

The endpoints in `flashcards/views.py` ask this file and never answer one of these themselves
(root `CLAUDE.md`, the second load-bearing boundary: a rule more than one endpoint needs lives in
one module). Three of them are asked from more than two places already — `can_study` by retrieve,
by the review queue, by grading and by `copy`; `visible_cards` by the queue, by the counts and by
the card list; `can_manage_node` (through `place_block_reason`) by both placement paths.

**Refusals are words, never booleans** (house rule 6). `place_block_reason` tells a manager that
the deck is already on this course, which is a completely different sentence from "you do not run
this course", and the frontend has a line for each (`frontend/src/lib/utils/labels.ts`).

**Visibility is a queryset filter; authority is an object-level check, and both are needed**
(house rule 4). `DeckViewSet.get_queryset` narrows to what the caller may reach so that a stranger
gets 404, and every action that arrives with an id in the URL asks `can_study` / `can_edit` here
explicitly, because a queryset filter never runs for a custom action.
"""

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.minors import is_minor
from config import nodes as node_seam

from . import scheduling
from .models import (
    GRADE_VALUES,
    PLACEABLE_NODE_KINDS,
    Card,
    Deck,
    DeckPlacement,
    ReviewLog,
    ReviewState,
)

# ---- refusal words (mirrored in frontend/src/lib/utils/labels.ts, house rule 13) ----------------

#: `place_block_reason`
NOT_OWNER = 'not_owner'
CANNOT_MANAGE = 'cannot_manage'
ALREADY_PLACED = 'already_placed'
BAD_KIND = 'kind'
#: `public_block_reason`
MINOR = 'minor'

#: How many cards one review session is served. Due first, then new, each half capped, so a deck
#: built from a 200-exercise set answers with a session rather than a corpus — every list on this
#: site is bounded by construction (root `CLAUDE.md`: no global pagination). The queue is
#: recomputed on every request, so finishing a session and asking again simply hands over the next
#: one; nothing is held server-side.
DUE_LIMIT = 50
NEW_LIMIT = 50


def _authenticated(user) -> bool:
    return bool(user is not None and getattr(user, 'is_authenticated', False))


def _is_staff(user) -> bool:
    return bool(_authenticated(user) and user.is_staff)


# ---- who may do what to a deck -----------------------------------------------------------------


def can_edit(user, deck: Deck) -> bool:
    """The owner, and nobody else — plus the global-staff bypass every gate on this site has, for
    the reason `moderation/permissions.py: feature_gate` records: a moderator must be able to reach
    the data of a feature they are investigating.

    Deliberately NOT "anybody who manages the node it is placed on". A placement is a course's
    decision to point at somebody's deck; it is not a transfer of the deck. A curator who wants
    their own version takes `POST /api/decks/{id}/copy/`, which is exactly what that endpoint is
    for — and then they own the copy and may edit it freely.
    """
    if not _authenticated(user):
        return False
    return deck.owner_id == user.pk or _is_staff(user)


def can_study(user, deck: Deck) -> bool:
    """Three answers, in the order they are cheap to check: the owner's own; a deck its owner has
    made world-readable; or a deck **placed** on a node this person can view.

    The third is this cycle's sharing mechanism (prompts/README.md §9, the integrator's decision of
    2026-10-05 against 00-DESIGN.md §4.1 read literally): without it, "make a deck from this
    lesson" would produce a deck only its maker could ever open, which is not a feature. `is_public`
    stays off by default and closed to minors and is the later, public-library step.
    """
    if deck.is_public:
        return True
    if not _authenticated(user):
        return False
    if deck.owner_id == user.pk or _is_staff(user):
        return True
    for placement in deck.placements.all():
        node = placement.node
        if node is not None and node_seam.can_view_node(user, node):
            return True
    return False


def own_decks(user):
    """`GET /api/decks/` — the caller's own, and only ever their own. A deck is a private thing by
    default and "my decks" is a page about mine; a deck somebody placed on a course I am on is
    found on that course's page, not mixed into my own list where I could not tell them apart."""
    if not _authenticated(user):
        return Deck.objects.none()
    return Deck.objects.filter(owner=user).prefetch_related('placements__content_type')


def visible_decks(user):
    """The decks whose *detail* this caller may reach — what `DeckViewSet.get_queryset` narrows to,
    so DRF's own `get_object()` answers 404 for anything else (house rule 4: for them it does not
    exist, which is the honest answer as well as the safe one).

    Node visibility is answered per kind in Python (`config/nodes.py` — there is deliberately no
    bulk "which nodes can this user see" query, and building one here would be exactly the
    re-derivation that seam exists to prevent), so this is a queryset of the three SQL-answerable
    cases widened by the placement ids this caller can actually see. The placement table is small
    by construction — one row per deck per course — and `needs/rules.py: public_needs` records the
    same reasoning for the same shape.
    """
    base = Deck.objects.filter(is_public=True)
    if not _authenticated(user):
        return base.prefetch_related('placements__content_type')
    if _is_staff(user):
        return Deck.objects.all().prefetch_related('placements__content_type')
    placed_ids = [
        placement.deck_id
        for placement in _resolved_placements(DeckPlacement.objects.all())
        if node_seam.can_view_node(user, placement.node)
    ]
    return Deck.objects.filter(
        Q(owner=user) | Q(is_public=True) | Q(pk__in=placed_ids)
    ).distinct().prefetch_related('placements__content_type')


def my_study_decks(user):
    """`GET /api/flashcards/due/` — the decks this person has a real relationship with: their own,
    the ones placed where they study, and any they have already graded a card in.

    NOT `visible_decks`: that includes every world-readable deck on the site, and a due list is a
    list of work waiting for *me*. A public deck somebody has never opened owes them nothing; one
    they have started has a `ReviewState` and appears here because of it.
    """
    if not _authenticated(user):
        return Deck.objects.none()
    placed_ids = [
        placement.deck_id
        for placement in _resolved_placements(DeckPlacement.objects.all())
        if node_seam.can_view_node(user, placement.node)
    ]
    started_ids = list(
        ReviewState.objects.filter(user=user).values_list('card__deck_id', flat=True).distinct()
    )
    return (
        Deck.objects.filter(Q(owner=user) | Q(pk__in=placed_ids) | Q(pk__in=started_ids))
        .distinct()
        .prefetch_related('placements__content_type')
    )


def public_block_reason(user, deck: Deck) -> str | None:
    """Why this person may not make this deck world-readable. One word today: a minor may not
    publish anything carrying their display name to the open web (`accounts/minors.py`,
    AUDIENCE-BRIEF.md §2, and the same refusal a tutoring listing and a volunteering offer make).
    Placement is unaffected — a minor's deck on their own class's course page is seen by that
    class, which has a teacher accountable for it."""
    if is_minor(user):
        return MINOR
    return None


# ---- placements --------------------------------------------------------------------------------


def _resolved_placements(queryset):
    """`queryset`, with every row's node resolved in **one query per content type** rather than one
    per row (the `needs/rules.py: _resolve_nodes` shape). Rows whose node has vanished are dropped:
    a `GenericForeignKey` has no database-level cascade, so a deleted course leaves a placement
    pointing at nothing, and a row nobody can resolve is a row nobody should be shown.
    """
    rows = list(queryset.select_related('content_type'))
    by_type: dict[int, list] = {}
    for row in rows:
        by_type.setdefault(row.content_type_id, []).append(row)
    resolved = []
    for content_type_id, group in by_type.items():
        content_type = group[0].content_type
        model = content_type.model_class()
        if model is None:
            continue
        found = model.objects.in_bulk([row.object_id for row in group])
        for row in group:
            node = found.get(row.object_id)
            if node is None:
                continue
            # Assigned back through the descriptor so the serializer and the visibility check
            # below both read the object this function already fetched instead of walking the GFK
            # again. Assignment rather than poking `_state.fields_cache` by hand: the cache key a
            # `GenericForeignKey` uses has changed between Django versions, and the descriptor is
            # the documented way in. `content_type`/`object_id` are re-set to what they already
            # are, which is why this is safe on a row that is never saved afterwards.
            row.node = node
            resolved.append(row)
    return resolved


def place_block_reason(user, deck: Deck, node) -> str | None:
    """Why this deck may not go on this node. Checked in the order the words become meaningful:

    1. `not_owner` — placing somebody else's deck is not yours to do, even on a course you run.
       (Staff bypass, as everywhere.)
    2. `kind` — only a course or an event (`PLACEABLE_NODE_KINDS`); a deck on a material or an
       organisation answers no question anybody asked, and `None` for an unknown kind too.
    3. `cannot_manage` — putting study material on a course is running it, not joining it.
    4. `already_placed` — the deck is already there. The *world moved*, not a question about who is
       asking, so `views.py` answers 409 for this one and 403 for the other three (root
       `CLAUDE.md`: do not conflate them).
    """
    if not can_edit(user, deck):
        return NOT_OWNER
    if node is None or node_seam.kind_of(node) not in PLACEABLE_NODE_KINDS:
        return BAD_KIND
    if not node_seam.can_manage_node(user, node):
        return CANNOT_MANAGE
    if DeckPlacement.objects.filter(
        deck=deck,
        content_type=node_seam.node_content_type(node),
        object_id=node.pk,
    ).exists():
        return ALREADY_PLACED
    return None


def place(user, deck: Deck, node) -> DeckPlacement:
    """Create the placement. The caller has already asked `place_block_reason`; this does the
    write, with `order` taken as one past whatever is already on the node so a course's decks keep
    the sequence they were added in."""
    content_type = node_seam.node_content_type(node)
    existing = DeckPlacement.objects.filter(content_type=content_type, object_id=node.pk).count()
    return DeckPlacement.objects.create(
        deck=deck,
        content_type=content_type,
        object_id=node.pk,
        order=existing,
        added_by=user,
    )


def node_placements(user, node):
    """`GET /api/nodes/{kind}/{pk}/decks/` — the placements on this node whose deck the caller may
    study. The view has already refused anybody who cannot view the node at all; this narrows
    further to decks that are genuinely reachable, which for a placed deck is everybody who got
    this far, and for a private deck placed and then *unplaced elsewhere* is still its owner."""
    rows = DeckPlacement.objects.filter(
        content_type=node_seam.node_content_type(node), object_id=node.pk
    ).select_related('deck', 'deck__owner', 'added_by').prefetch_related('deck__placements')
    return [row for row in rows if can_study(user, row.deck)]


def can_remove_placement(user, placement: DeckPlacement) -> bool:
    """The person who placed it, the deck's owner, or the node's manager. Three parties with a
    real claim: whoever made the decision, whoever owns the thing it points at, and whoever runs
    the page it appears on. Anybody else gets 404 (house rule 4)."""
    if not _authenticated(user):
        return False
    if _is_staff(user):
        return True
    if placement.added_by_id == user.pk or placement.deck.owner_id == user.pk:
        return True
    node = placement.node
    return node is not None and node_seam.can_manage_node(user, node)


# ---- what is in a deck, and what is due --------------------------------------------------------


def visible_cards(deck: Deck, user):
    """The cards of this deck that should actually be studied, as a list in order.

    An **exercise that is no longer visible to readers is skipped** — `Exercise.published` is the
    switch a moderator's removal and the auto-hide threshold both flip (`exercises/models.py`), and
    a card whose exercise has been pulled, usually because its solution was wrong, is the single
    worst thing to keep putting in front of somebody. The deck's own OWNER keeps seeing it, for the
    reason `courses.LessonExerciseSet.visible_exercises` records: they are the person who can
    replace it, and a list that silently got shorter tells them nothing.

    The card row itself is never deleted for this. It comes back the moment the exercise is
    restored (house rule 12 — nothing is hard-deleted here, and a moderator's decision is not a
    reason to lose somebody's deck).
    """
    rows = list(
        deck.cards.select_related('exercise', 'exercise__branch', 'concept').prefetch_related(
            'concept__articles__revisions'
        )
    )
    if can_edit(user, deck):
        return rows
    return [
        card
        for card in rows
        if card.exercise_id is None
        or (card.exercise.published and card.exercise.auto_hidden_at is None)
    ]


def _today_end():
    """"Due" is read on the **server's day** (00-DESIGN.md §4.3): a card scheduled for today is due
    all of today, not from the minute it was graded a day ago. There is no per-account timezone on
    this site (root `CLAUDE.md`, known gaps), so this is `settings.TIME_ZONE`'s end of day and
    saying anything more precise would be a lie dressed as rigour."""
    now = timezone.localtime(timezone.now())
    return now.replace(hour=23, minute=59, second=59, microsecond=999999)


def review_queue(user, deck: Deck) -> tuple[list, dict]:
    """`GET /api/decks/{id}/review/` — `(cards, counts)`.

    Due cards first (capped at `DUE_LIMIT`), then new ones (capped at `NEW_LIMIT`). The counts are
    the honest totals, **not** the capped lengths: somebody with 300 cards waiting should be told
    300, and handed 50.

    A card with no `ReviewState` is *new*, which is a different thing from *due* — it has no due
    date to have passed. Both are studyable now, which is why `Deck.due_count` in the API's read
    shape is their sum and says so.
    """
    cards = visible_cards(deck, user)
    if not cards:
        return [], {'due': 0, 'new': 0, 'learned': 0, 'total': 0}

    states = {
        state.card_id: state
        for state in ReviewState.objects.filter(user=user, card__in=cards)
    }
    cutoff = _today_end()
    due, fresh, learned = [], [], 0
    for card in cards:
        state = states.get(card.pk)
        if state is None:
            fresh.append(card)
        elif state.due_at <= cutoff:
            due.append(card)
        else:
            learned += 1
    return due[:DUE_LIMIT] + fresh[:NEW_LIMIT], {
        'due': len(due),
        'new': len(fresh),
        'learned': learned,
        'total': len(cards),
    }


def due_count(user, deck: Deck) -> int:
    """How many cards of this deck this person could study right now — due **plus** new, because
    both are "ready", and a brand-new deck of ten cards that reported 0 would be telling somebody
    there is nothing to do. The split is in `review_queue`'s `counts`."""
    if not _authenticated(user):
        return 0
    _queue, counts = review_queue(user, deck)
    return counts['due'] + counts['new']


def apply_grade(user, card: Card, grade: int) -> ReviewState:
    """Record one press of one of the four buttons: the new schedule, and the log row.

    One `update_or_create` and one insert inside a short `atomic()` — two fast adjacent statements,
    which is the only shape `atomic()` is for on SQLite (`backend/CLAUDE.md` rule 2). **No
    `select_for_update`**: SQLite has no row locking, Django silently no-ops it, and the
    surrounding block lock turns concurrency into `database is locked` (rule 1). There is nothing
    to lock against anyway — a `ReviewState` is unique per `(user, card)`, so the only writer of
    this row is this person, and two taps of the same button in the same second are two honest
    reviews whose second one wins.
    """
    if grade not in GRADE_VALUES:
        raise ValueError(f'grade must be one of {GRADE_VALUES} — got {grade!r}')
    now = timezone.now()
    existing = ReviewState.objects.filter(user=user, card=card).first()
    before = (
        None
        if existing is None
        else {
            'interval_days': existing.interval_days,
            'ease': existing.ease,
            'repetitions': existing.repetitions,
            'lapses': existing.lapses,
        }
    )
    interval_before = existing.interval_days if existing else 0
    nxt = scheduling.review(before, grade, now)
    with transaction.atomic():
        state, _created = ReviewState.objects.update_or_create(
            user=user,
            card=card,
            defaults={
                'due_at': nxt['due_at'],
                'interval_days': nxt['interval_days'],
                'ease': nxt['ease'],
                'repetitions': nxt['repetitions'],
                'lapses': nxt['lapses'],
            },
        )
        ReviewLog.objects.create(
            user=user, card=card, grade=grade, interval_before=interval_before
        )
    return state


def copy_for(user, deck: Deck) -> Deck:
    """`POST /api/decks/{id}/copy/` — a private copy of a deck this person may study.

    A **membership snapshot** exactly as 00-DESIGN.md §1 rule 2 and `courses.LessonExerciseSet`
    define it: the card list is copied once, each card's exercise/concept is a live FK, and nothing
    links the copy back to the original. No placements travel (placing is the node manager's
    decision, not a property of the deck) and `is_public` does not either — a copy starts private,
    like every new deck.

    Only the **visible** cards are copied: a card whose exercise a moderator has pulled is not
    something to hand somebody as a fresh deck.
    """
    source_kind = deck.source_kind
    copy = Deck.objects.create(
        owner=user,
        name=deck.name,
        audience=deck.audience,
        is_public=False,
        source_kind=source_kind,
        source_id=deck.source_id,
        source_set=deck.source_set,
    )
    Card.objects.bulk_create(
        [
            Card(
                deck=copy,
                order=index,
                exercise=card.exercise,
                concept=card.concept,
                front=card.front,
                back=card.back,
                include_hint=card.include_hint,
                include_solution=card.include_solution,
            )
            for index, card in enumerate(visible_cards(deck, user))
        ]
    )
    return copy


def parse_placed_on(raw: str):
    """`?placed_on=course:7` → `(kind, pk)`, or `None` for anything malformed. A browse filter
    degrades to "no filter" rather than refusing (`config/audience.py`'s own posture)."""
    if not raw or ':' not in raw:
        return None
    kind, _, pk = raw.partition(':')
    kind = kind.strip()
    if kind not in PLACEABLE_NODE_KINDS or not pk.strip().isdigit():
        return None
    return kind, int(pk)


def content_type_for_kind(kind: str) -> ContentType | None:
    from django.apps import apps as django_apps

    if kind not in node_seam.NODE_KINDS:
        return None
    return ContentType.objects.get_for_model(django_apps.get_model(*node_seam.NODE_KINDS[kind]))


__all__ = [
    'ALREADY_PLACED',
    'BAD_KIND',
    'CANNOT_MANAGE',
    'DUE_LIMIT',
    'MINOR',
    'NEW_LIMIT',
    'NOT_OWNER',
    'apply_grade',
    'can_edit',
    'can_remove_placement',
    'can_study',
    'content_type_for_kind',
    'copy_for',
    'due_count',
    'my_study_decks',
    'node_placements',
    'own_decks',
    'parse_placed_on',
    'place',
    'place_block_reason',
    'public_block_reason',
    'review_queue',
    'visible_cards',
    'visible_decks',
]
