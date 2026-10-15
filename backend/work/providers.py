"""Provider registry for the work dashboard — items waiting on me, aggregated from every module.

A provider is a function that takes a user and returns a list of dicts, each representing
a work item. Providers are registered with a key (how they appear in sections), a flag key
(the feature flag that gates them), and the function itself.

House rule 10: a provider that raises is reported in `unavailable`, never fatal.
"""

import logging
from django.utils import timezone
from datetime import timedelta
from django.conf import settings
from moderation.services import is_feature_enabled

logger = logging.getLogger(__name__)

# The keys a provider's dict must carry. Every item from every provider has the same shape.
ITEM_KEYS = ('kind', 'title', 'url', 'due_at', 'status', 'count', 'urgency', 'node')

# kind: a short word the frontend has a label for
# ('task', 'need_application', 'need_decision', 'plan_step', 'plan_suggestion', 'poll',
#  'event', 'course_request', 'proposal', 'shift', 'booking', 'cards_due', 'organization',
#  'contest_registration', 'contest_stage', 'contest_judging', 'contest_complaint')
#
# url: a FRONTEND path ('/events/12'); due_at: ISO string or None
# status: a CODE from `STATUS_CODES[kind]` below — never a sentence, never English. The frontend
#         turns (kind, status, count) into words in the reader's language.
# count: an int where the row stands for several things ('3 cards due', '2 requests waiting'),
#        else None. Only the kinds in `COUNTED_KINDS` carry one.
# urgency: 0 none, 1 this month, 2 this week, 3 overdue/today
# node: config.nodes.node_ref(...) or None


#: Every status code a provider may emit, per kind. **Mirrored in
#: `frontend/src/lib/utils/labels.ts: WORK_STATUS_CODES`** (house rule 13 — say so in both files),
#: which is where each (kind, code) gets its words; a code missing there prints a neutral "status
#: unknown" rather than the raw word, so the two drifting is ugly but never English-only.
#: `StatusVocabularyTests` (work/tests.py) fails when a provider emits anything not listed here,
#: and when a set below stops matching the model enum it was copied from.
#:
#: Where a set is a slice of a model's own enum the source is named, because that is where a new
#: status would appear first:
STATUS_CODES = {
    # work/builtin.py
    'event': frozenset({'hosting', 'staffing', 'going'}),
    'course_request': frozenset({'pending'}),
    'proposal': frozenset({'pending'}),
    'shift': frozenset({'offered', 'claimed', 'confirmed'}),  # shifts.models.LIVE_STATUSES
    'booking': frozenset({'requested', 'confirmed'}),  # builtin._tutoring_bookings' own filter
    # tasks/work.py — tasks.models.OPEN_STATUSES
    'task': frozenset({'todo', 'in_progress', 'review'}),
    # needs/work.py
    'need_application': frozenset({'pending'}),
    'need_decision': frozenset({'pending'}),
    # plans/work.py — STEP_STATUS_CHOICES minus the two finished ones it excludes
    'plan_step': frozenset({'pending', 'in_progress'}),
    'plan_suggestion': frozenset({'pending'}),
    # decisions/work.py
    'poll': frozenset({'open'}),
    # flashcards/work.py
    'cards_due': frozenset({'due'}),
    # organizations/work.py (written, not registered — see work/CLAUDE.md)
    'organization': frozenset({'sole_owner'}),
    # contests/work.py — a registration is contests.models.PLACE_HOLDING_STATUSES
    'contest_registration': frozenset({'requested', 'accepted'}),
    'contest_stage': frozenset({'open'}),
    'contest_judging': frozenset({'waiting'}),
    'contest_complaint': frozenset({'open'}),
}

#: The kinds whose row stands for several things and so carries an int `count` (>= 1). Every other
#: kind sends `count: None`. Mirrored in `labels.ts` alongside `WORK_STATUS_CODES`.
COUNTED_KINDS = frozenset({'course_request', 'proposal', 'need_decision', 'cards_due', 'contest_judging'})


def item_problems(item) -> list[str]:
    """Everything wrong with one item's shape, as sentences — empty when it is well-formed.

    The tests' single check, and a reader's: the item shape is a contract between eight apps and
    one page, and this is the contract written as code.
    """
    problems = []
    if set(item) != set(ITEM_KEYS):
        problems.append(f'keys {sorted(item)} are not {sorted(ITEM_KEYS)}')
    kind = item.get('kind')
    codes = STATUS_CODES.get(kind)
    if codes is None:
        problems.append(f'kind {kind!r} declares no status codes')
    elif item.get('status') not in codes:
        problems.append(f'{kind}: status {item.get("status")!r} is not one of {sorted(codes)}')
    count = item.get('count')
    if kind in COUNTED_KINDS:
        if not (isinstance(count, int) and not isinstance(count, bool) and count >= 1):
            problems.append(f'{kind}: count {count!r} should be a positive int')
    elif count is not None:
        problems.append(f'{kind}: count {count!r} should be None')
    return problems


# Registry: key -> (flag_key, provider_function)
_REGISTRY = {}

# Preferred order for sections (MANAGEMENT-BRIEF.md §3.F): events host/staff, events attend,
# courses, coauthoring, shifts, tutoring, then tasks/needs/plans/decisions (added at integration,
# §5). This is ordering ONLY — it does not gate whether a provider runs. A key registered here
# that has not yet landed is simply never IN `_REGISTRY`, so it is skipped exactly like any other
# unregistered key; a key registered that is NOT in this list still runs, appended after the known
# ones, so a provider is never silently dropped for the crime of being new (see `collect()`).
_SECTION_ORDER = [
    'event_hosting',
    'event_attendance',
    'course_request',
    'proposal',
    'shift',
    'booking',
    'task',
    'need_application',
    'need_decision',
    'plan_step',
    'plan_suggestion',
    'poll',
    # The learning cycle, 2026-10-06. Last on purpose: cards being due is the one section with no
    # deadline in it (`flashcards/work.py` — urgency never reaches 3), so it reads after everything
    # somebody could actually be late for.
    'cards_due',
    # Contests (contests/, CONTESTS-BRIEF.md §3.B). After the cards for the same reason the cards
    # are after everything else: a contest's rows carry real dates, but this is the newest section
    # and putting it above a reader's overdue tasks would reorder a page people already read.
    # The four keys ARE the four kinds `contests/work.py` yields.
    'contest_registration',
    'contest_judging',
    'contest_complaint',
    'contest_stage',
]


def register(key, flag_key, provider):
    """Register a provider for the work dashboard.

    Args:
        key: The section key (e.g., 'event', 'course_request')
        flag_key: The feature flag that gates this provider (e.g., 'events', 'courses')
        provider: A function(user) -> list[dict] that returns work items
    """
    _REGISTRY[key] = (flag_key, provider)


def collect(user):
    """Collect work items from all registered providers.

    Every key in `_REGISTRY` is attempted, regardless of whether it appears in `_SECTION_ORDER` —
    an unlisted key (a provider registered by a test, or one integration has not yet given a fixed
    slot) still runs and can still land in `unavailable`. `_SECTION_ORDER` only decides the order
    the KNOWN keys come back in; anything else is appended after, in registration order.

    Returns:
        {
            'sections': [{'key': '...', 'items': [...]}, ...],
            'unavailable': [keys where the provider raised],
            'generated_at': ISO timestamp
        }
    """
    sections = []
    unavailable = []

    ordered_keys = [key for key in _SECTION_ORDER if key in _REGISTRY]
    ordered_keys += [key for key in _REGISTRY if key not in _SECTION_ORDER]

    for key in ordered_keys:
        flag_key, provider_func = _REGISTRY[key]

        # Skip if the feature flag is off
        if not is_feature_enabled(flag_key):
            continue

        try:
            items = provider_func(user)
            if items:  # Only add non-empty sections
                sections.append({
                    'key': key,
                    'items': items
                })
        except Exception:
            logger.exception(f"Provider {key} raised, reporting as unavailable")
            unavailable.append(key)

    return {
        'sections': sections,
        'unavailable': unavailable,
        'generated_at': timezone.now().isoformat(),
    }
