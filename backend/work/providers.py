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
ITEM_KEYS = ('kind', 'title', 'url', 'due_at', 'status', 'urgency', 'node')

# kind: a short word the frontend has a label for
# ('task', 'need_application', 'need_decision', 'plan_step', 'plan_suggestion', 'poll',
#  'event', 'course_request', 'proposal', 'shift', 'booking')
#
# url: a FRONTEND path ('/events/12'); due_at: ISO string or None
# status: the row's own word ('going', 'pending', 'overdue', etc.)
# urgency: 0 none, 1 this month, 2 this week, 3 overdue/today
# node: config.nodes.node_ref(...) or None


# Registry: key -> (flag_key, provider_function)
_REGISTRY = {}


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

    Returns:
        {
            'sections': [{'key': '...', 'items': [...]}, ...],
            'unavailable': [keys where the provider raised],
            'generated_at': ISO timestamp
        }
    """
    sections = []
    unavailable = []

    # Fixed order for sections (as specified in MANAGEMENT-BRIEF.md §3.F)
    # This order will be: events host/staff, events attend, courses, coauthoring,
    # shifts, tutoring, then tasks/needs/plans/decisions (added at integration)
    section_order = [
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
    ]

    for key in section_order:
        if key not in _REGISTRY:
            continue

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
