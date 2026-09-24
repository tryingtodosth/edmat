"""Every rule `needs` asks, in one module (root `CLAUDE.md`, boundary 2). The endpoints ask this
module; nothing here re-derives what `config/nodes.py` already answers about a course, an event or
a material.

Refusals are words the frontend has a sentence for (house rule 6): `apply_block_reason`,
`decide_block_reason`. `recount` is the `fulfilled` half of house rule 5 — a need's status is
RECOUNTED from its accepted applications on every decision, never incremented, so a decision that
misses a code path cannot leave the count wrong forever.
"""

from django.contrib.contenttypes.models import ContentType
from django.utils import timezone

from accounts.minors import is_minor
from config import nodes as node_seam

from .models import Need, NeedApplication

#: `apply_block_reason`. Ordered by what the applicant can do about it (house rule 6): whether the
#: posting is even open, then who they are, then whether they already answered, then whether the
#: seats are gone.
NOT_OPEN = 'not_open'
OWN_NODE = 'own_node'
MINOR = 'minor'
ALREADY_APPLIED = 'already_applied'
FULL = 'full'

#: `decide_block_reason`, and reused for a withdraw that arrives too late to mean anything —
#: `application/accepted/declined/withdrawn` is a decision that already happened either way.
ALREADY_DECIDED = 'already_decided'

#: Not one of the five `apply_block_reason` words because it never reaches an applicant: creating
#: or editing a need is a node-manager action, refused before an applicant's own rules are ever
#: consulted.
NOT_MANAGER = 'not_manager'


def can_manage(user, need: Need) -> bool:
    """May this person run the posting itself — create, edit, cancel, decide. Node manager only,
    dispatched through `config.nodes` (`can_administer|can_curate`, `can_organise`, a project's
    governors): a need is not a thing its own creator keeps editing after handing it to the node,
    it is the node's posting."""
    node = need.node
    if node is None:
        return False
    return node_seam.can_manage_node(user, node)


def _resolve_nodes(needs) -> dict:
    """Bulk-resolve the `GenericForeignKey` targets of a list of needs — one query per content
    type, not one per row. `config.nodes` has no bulk "which of these are visible" query (each
    node kind answers visibility differently, and a hand-rolled cross-kind query here is exactly
    the "an app that filters `Course.objects` itself" trap `config/nodes.py`'s own docstring
    warns about) — so each *node*, once resolved, is still asked individually, but never fetched
    row by row."""
    by_content_type: dict[int, list[int]] = {}
    for need in needs:
        by_content_type.setdefault(need.content_type_id, []).append(need.object_id)
    resolved = {}
    for content_type_id, object_ids in by_content_type.items():
        content_type = ContentType.objects.get_for_id(content_type_id)
        model = content_type.model_class()
        if model is None:
            continue
        for object_id, row in model.objects.in_bulk(object_ids).items():
            resolved[(content_type_id, object_id)] = row
    return resolved


def public_needs(user):
    """The board: open needs on nodes the reader can view are public; a node's own staff also see
    the rest of that node's needs (MANAGEMENT-BRIEF.md §3.C). A stranger asking for a need on a
    node they cannot view gets nothing here — house rule 4, "for them it does not exist" — and
    that is also what makes `NeedViewSet.get_object()` 404 rather than leak a title.

    Every list this frontend calls is bounded by construction (root `CLAUDE.md`); a help-wanted
    board is not a list anybody expects to page through, so this reads every row once rather than
    keeping a second, harder-to-trust index of "public" needs.
    """
    needs = list(Need.objects.select_related('content_type').order_by('-created_at', '-id'))
    nodes = _resolve_nodes(needs)
    visible_ids = []
    for need in needs:
        node = nodes.get((need.content_type_id, need.object_id))
        if node is None:
            continue  # the node itself is gone; nothing honest to show for it
        if not node_seam.can_view_node(user, node):
            continue
        if need.status == 'open' or node_seam.is_node_staff(user, node):
            visible_ids.append(need.pk)
    return Need.objects.filter(pk__in=visible_ids).order_by('-created_at', '-id')


def node_needs(user, node):
    """The needs of one node, for the nested `/api/nodes/{kind}/{id}/needs/` — staff see
    everything hung off it, everybody else (who already passed `can_view_node` to reach this) sees
    only the open ones."""
    content_type = node_seam.node_content_type(node)
    qs = Need.objects.filter(content_type=content_type, object_id=node.pk)
    if not node_seam.is_node_staff(user, node):
        qs = qs.filter(status='open')
    return qs


def apply_block_reason(user, need: Need) -> str | None:
    """Why this account may not apply to this posting — or `None`, meaning let them.

    An application carries free text to a stranger, so a minor never reaches this: `accounts/
    minors.py` is the one place that rule lives, asked here rather than re-decided.
    """
    if need.status != 'open':
        return NOT_OPEN
    if node_seam.is_node_staff(user, need.node):
        return OWN_NODE
    if is_minor(user):
        return MINOR
    if NeedApplication.objects.filter(need=need, user=user).exists():
        return ALREADY_APPLIED
    if need.accepted_count() >= need.wanted_count:
        return FULL
    return None


def decide_block_reason(application: NeedApplication) -> str | None:
    """Why this application cannot be accepted or declined right now. `pending` is the only
    decidable state; a decision already made — by this manager or, in a race, by another one
    claiming the same row a moment earlier — answers `already_decided`."""
    if application.status != 'pending':
        return ALREADY_DECIDED
    return None


def recount(need: Need) -> None:
    """Recompute `need.status` between `open` and `fulfilled` from ACCEPTED applications — house
    rule 5, a recount rather than a counter that drifts the first time a code path misses it.

    Deliberately leaves `cancelled` alone (a manager's own decision, not something an application
    reopens) and leaves `in_progress` alone in the direction that still needs staffing (a manager's
    own "we are actively working on it" is not something a stray decision should erase) — the only
    two transitions this function makes are INTO `fulfilled` once accepted reaches `wanted_count`,
    from whichever open-ish status the need was in, and OUT of `fulfilled` back to `open` if an
    accepted applicant later withdraws and the need is short again.

    A single WHERE-anchored `update()` (`backend/CLAUDE.md`'s SQLite rule), not a blind save — a
    second recount racing this one loses cleanly rather than overwriting a status that moved again
    in between.
    """
    if need.status == 'cancelled':
        return
    accepted = need.accepted_count()
    if accepted >= need.wanted_count:
        target = 'fulfilled'
    elif need.status == 'fulfilled':
        target = 'open'
    else:
        target = need.status
    if target != need.status:
        Need.objects.filter(pk=need.pk, status=need.status).update(
            status=target, updated_at=timezone.now()
        )
        need.status = target
