"""Every `plans` rule, in one module, asked by the endpoints (root `CLAUDE.md`, boundary 2;
MANAGEMENT-BRIEF.md §3.D).

Every "who is this node / may this person" question is asked of `config.nodes` and never
re-implemented here (MANAGEMENT-BRIEF.md §2, §4 rule 3) — a plan's own authority is always the
node's: a course's `can_administer|can_curate`, an event's `can_organise`, a project's governors,
an organisation's owners/admins, all behind `config.nodes.can_manage_node`.

Refusals are words, not booleans (house rule 6) — `not_active` and `minor` are the same boolean
and completely different sentences to a person looking at a suggestion box. Visibility is a
queryset filter (`visible_plans`, used by the nested list); authority is an object-level check
(`can_edit`, asked again by every single-object action) — house rule 4, because a filter never
runs for an action that arrives with an id in the URL.
"""

from accounts.minors import is_minor
from config import nodes

DRAFT, ACTIVE, COMPLETED, ARCHIVED = 'draft', 'active', 'completed', 'archived'

# Legal forward transitions — a graph, not a boolean. `archived` is terminal; `draft` is the only
# status a plan may be deleted from (`views.py`), and a plan may be archived straight from draft
# (a roadmap abandoned before it ever went live) without ever having been active.
_TRANSITIONS = {
    DRAFT: {ACTIVE, ARCHIVED},
    ACTIVE: {COMPLETED, ARCHIVED},
    COMPLETED: {ARCHIVED},
    ARCHIVED: set(),
}

# Refusal words. Kept as constants so the views, the tests and this module cannot drift on a
# spelling.
NOT_EDITOR = 'not_editor'
NOT_ACTIVE = 'not_active'
MINOR = 'minor'
OWN_PLAN = 'own_plan'
STEPS_PENDING = 'steps_pending'
ALREADY_DECIDED = 'already_decided'
ILLEGAL_TRANSITION = 'illegal_transition'
NESTED = 'nested'
NOT_DRAFT = 'not_draft'
NOT_OWN_SUGGESTION = 'not_own_suggestion'


def _authenticated(user) -> bool:
    return bool(user and getattr(user, 'is_authenticated', False))


def visible_plans(user, node):
    """The plans of one node, for the nested list — house rule 4's queryset half.

    Node staff see every plan, draft included (they are the ones deciding whether to activate it).
    Everyone else who can already see the node (the caller of this function checked that) sees only
    `active` plans, read-only — MANAGEMENT-BRIEF.md §3.D: "an `active` plan on a node the user can
    view is readable by anyone".
    """
    from .models import Plan

    qs = Plan.objects.filter(content_type=nodes.node_content_type(node), object_id=node.pk)
    if nodes.is_node_staff(user, node):
        return qs
    return qs.filter(status=ACTIVE)


def can_view_plan(user, plan) -> bool:
    """The object-level half of the same rule, for `/api/plans/{id}/` and everything nested under
    it — asked before `get_object()` ever hands a plan back, so a stranger gets 404 on a draft
    exactly as they would on the node itself."""
    node = plan.node
    if node is None or not nodes.can_view_node(user, node):
        return False
    if nodes.is_node_staff(user, node):
        return True
    return plan.status == ACTIVE


def can_edit(user, plan) -> bool:
    """A node manager, or the plan's own creator — the two people who may change what a roadmap
    says. Draws no line at `is_node_staff`: ordinary staff may read a draft plan but not edit it,
    the same as an event's ordinary volunteer reads the programme a co-organiser is still drafting."""
    node = plan.node
    if node is None:
        return False
    if nodes.can_manage_node(user, node):
        return True
    return _authenticated(user) and plan.created_by_id == getattr(user, 'id', None)


def transition_block_reason(plan, to_status: str) -> str | None:
    """Why `plan.status` may not become `to_status` — or `None`, meaning go ahead.

    Completing is the one transition that carries a second rule of its own
    (`complete_block_reason`): every step must be done or skipped first, so "completed" always
    means what it says rather than being a word somebody typed early.
    """
    if to_status not in _TRANSITIONS.get(plan.status, set()):
        return ILLEGAL_TRANSITION
    if to_status == COMPLETED:
        reason = complete_block_reason(plan)
        if reason:
            return reason
    return None


def complete_block_reason(plan) -> str | None:
    if plan.steps.exclude(status__in=['done', 'skipped']).exists():
        return STEPS_PENDING
    return None


def suggest_block_reason(user, plan) -> str | None:
    """Why this reader may not drop a suggestion into the box.

    `own_plan` is deliberate, not an oversight: an editor who wants a step just adds one
    (`POST …/steps/`) — a suggestion is the read-only reader's way of proposing, and giving an
    editor that same button would be two ways to do the one thing, disagreeing about which is
    "official" the moment somebody uses both.
    """
    if plan.status != ACTIVE:
        return NOT_ACTIVE
    if is_minor(user):
        # A suggestion carries free text to a stranger the moment a manager reads it — the same
        # reasoning `accounts/minors.py` already applies to messaging and to a need's application
        # (MANAGEMENT-BRIEF.md §1, §6.1).
        return MINOR
    if can_edit(user, plan):
        return OWN_PLAN
    return None


def decide_block_reason(suggestion) -> str | None:
    if suggestion.status != 'pending':
        return ALREADY_DECIDED
    return None


def withdraw_block_reason(user, suggestion) -> str | None:
    if suggestion.user_id != getattr(user, 'id', None):
        return NOT_OWN_SUGGESTION
    if suggestion.status != 'pending':
        return ALREADY_DECIDED
    return None


def progress(plan) -> dict:
    """Done over (total − skipped) — **recounted**, never stored (house rule 5): two `COUNT`s over
    an indexed FK is cheap, and a stored tally is one missed code path away from a bar that
    disagrees with the steps underneath it."""
    statuses = list(plan.steps.values_list('status', flat=True))
    total = len(statuses)
    skipped = statuses.count('skipped')
    done = statuses.count('done')
    denom = total - skipped
    percent = round(done / denom * 100) if denom else 0
    return {'done': done, 'total': total, 'skipped': skipped, 'percent': percent}


def reorder(plan, ids: list[int], parent_id=None) -> bool:
    """Whether `ids` is exactly one group of the plan's steps — its top-level steps when
    `parent_id` is `None`, or one step's sub-steps when it names one. `True` means go ahead; the
    caller turns `False` into `400` (a malformed request, not a state that moved)."""
    candidates = plan.steps.filter(parent_id=parent_id)
    valid = set(candidates.values_list('id', flat=True))
    return len(ids) == len(valid) and set(ids) == valid
