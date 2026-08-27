"""The solution/hint pool's shared rules — who may publish without review, who may review, who may
decide an edit suggestion against an entry, what a given caller may SEE, and how a list is ordered.
One module rather than logic scattered across serializers/views/moderation, because every one of
these answers is read from at least two places (the exercise detail's embedded list, the entry
actions, and the moderation queue) and two copies of a trust rule is how one of them drifts.

The role model, decided with the owner (2026-08-27):

- **Publishing**: an entry by a verified contributor, staff, or a governor of the exercise's
  branch goes live immediately; anybody else's starts `pending`.
- **Reviewing** (accept/deny a pending entry): the same circle — any verified contributor, staff,
  or a branch governor. ONE accept publishes; one deny (note required) rejects.
- **Deciding an edit suggestion against an entry**: the entry's own AUTHOR, staff, or a branch
  governor — deliberately NOT every verified contributor: folding somebody's words into somebody
  ELSE'S solution is a different act than reviewing a new, standalone entry.

`can_review_entry` / `can_decide_entry_suggestion` are also the seam where the planned
field/branch-expert tier (the SKILL system, LAUNCHCHECKLIST §3a) will slot in — an expert in the
exercise's own branch joining each circle — so that lands as one clause in each function here, not
a hunt across the codebase.
"""

def _is_verified_contributor(user) -> bool:
    return bool(getattr(getattr(user, 'profile', None), 'is_verified_contributor', False))


def can_autopublish_entry(user, branch) -> bool:
    """May this person's brand-new entry skip the queue? Mirrors the §18.4 verified-contributor
    fast path for whole exercises, extended (by the same trust reasoning) to staff and governors."""
    from moderation.services import is_governor_of_course

    if user is None or not user.is_authenticated:
        return False
    if user.is_staff or _is_verified_contributor(user):
        return True
    return is_governor_of_course(user, branch)


def can_review_entry(user, branch) -> bool:
    """May this person accept/deny somebody else's pending entry? Today identical to
    `can_autopublish_entry`; kept as its own function because the two circles are one by
    coincidence of v1, not by definition — the future expert tier may widen them differently."""
    return can_autopublish_entry(user, branch)


def can_decide_entry_suggestion(user, entry) -> bool:
    """May this person approve/reject an edit suggestion against `entry`? Author + staff +
    governors — see the module docstring for why verified contributors are not in this circle."""
    from moderation.services import is_governor_of_course

    if user is None or not user.is_authenticated:
        return False
    if user.is_staff:
        return True
    if entry.author_id is not None and entry.author_id == user.pk:
        return True
    return is_governor_of_course(user, entry.exercise.branch)


def visible_entries(exercise, user):
    """Every entry this caller may see, as a plain list (reads `.all()` so a caller's
    prefetch_related('entries') is honored — the same cache-preserving rule
    `_published_translations` documents):

    - published, not removed/auto-hidden → everyone;
    - pending → its own author, and anybody who could review it;
    - rejected → its own author only (they were told why; the note stays readable);
    - removed/auto-hidden → reviewers only (the same "a moderator judges the real text" rule the
      report queue follows), never ordinary readers.
    """
    reviewer = can_review_entry(user, exercise.branch)
    user_id = user.pk if user is not None and user.is_authenticated else None
    out = []
    for entry in exercise.entries.all():
        hidden = entry.is_removed or entry.auto_hidden_at is not None
        if entry.status == 'published' and not hidden:
            out.append(entry)
        elif entry.status == 'pending' and not hidden and (reviewer or entry.author_id == user_id):
            out.append(entry)
        elif entry.status == 'rejected' and not hidden and entry.author_id == user_id:
            out.append(entry)
        elif hidden and reviewer:
            out.append(entry)
    return out


def sort_entries(entries) -> list:
    """Pinned first, then net weighted vote score descending, then oldest first — the one ordering
    every list of entries uses. Reads `.votes.all()` (prefetch-friendly)."""
    from materials.services import _net_vote_weight

    return sorted(
        entries,
        key=lambda e: (not e.pinned, -_net_vote_weight(e), e.created_at, e.pk),
    )


def entry_queryset_for_queue(branch_ids=None):
    """Pending entries for the moderation queue, governor-scoped exactly like every other
    section of the payload."""
    from .models import SolutionEntry

    qs = (
        SolutionEntry.objects.filter(status='pending', is_removed=False)
        .select_related('exercise__branch', 'author__profile')
        .order_by('created_at')
    )
    if branch_ids is not None:
        qs = qs.filter(exercise__branch_id__in=branch_ids)
    return qs


__all__ = [
    'can_autopublish_entry',
    'can_review_entry',
    'can_decide_entry_suggestion',
    'visible_entries',
    'sort_entries',
    'entry_queryset_for_queue',
]
