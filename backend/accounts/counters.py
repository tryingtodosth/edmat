"""Stored per-account counters, and the one function that keeps them true.

`Profile.exercises_published_count` / `exercises_private_count` exist because the profile page used
to COUNT what the activity feed happened to return, and the feed slices every source at 50 — so
anybody who had contributed more than fifty exercises read as having contributed exactly fifty.
A stored integer is read in the same query as the profile itself, and it is right however many
exercises there are.

The counters are RECOUNTED, never incremented. Two `COUNT(*)` over an indexed foreign key are
cheap, and a recount cannot drift: an increment that misses one code path (a bulk update, a
signal that did not fire, a crash between two writes) is wrong forever, while a recount is right
the next time anything about that person's exercises changes. Every write path that touches an
Exercise goes through `exercises/signals.py`, which calls this.
"""

from django.db.models import Count, Q

from .models import Profile


def recount_exercises(user_id) -> None:
    """Recompute both exercise counters for one account from the Exercise table itself."""
    if user_id is None:
        return
    from exercises.models import Exercise

    totals = Exercise.objects.filter(submitted_by_id=user_id).order_by().aggregate(
        # Named so as not to shadow the `published` column inside the second filter.
        n_published=Count('pk', filter=Q(published=True)),
        n_private=Count('pk', filter=Q(published=False)),
    )
    # A plain UPDATE rather than load-modify-save: it never touches the other Profile columns, so
    # it cannot overwrite a concurrent edit to somebody's bio with a stale copy, and it is a no-op
    # (0 rows) for a user that has no Profile row yet rather than an exception.
    Profile.objects.filter(user_id=user_id).update(
        exercises_published_count=totals['n_published'] or 0,
        exercises_private_count=totals['n_private'] or 0,
    )
