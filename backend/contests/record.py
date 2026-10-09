"""The learning record's view of contests: what this person actually achieved, from the PUBLISHED
results and nothing else.

    placements_for(user) -> [{'contest_id': int, 'title': str, 'result_title': str,
                              'published_at': str}]

**Not imported anywhere on this branch** (CONTESTS-BRIEF.md §4 rule 13): step B registers it in
`identity/record.py` behind the person's own learning-record consent, and nothing here is shown
without it. This module does not read that consent — it does not know about it, deliberately, so
that the one place consent is checked stays the one place it is checked.

**Only `ContestResult` rows count**, which means only published results. A live, recounted ranking
is staff-only until `publish_results` writes the frozen rows (`rules.py`), and a learning record
built on the live one would show somebody a placement that could still move — or, worse, show it to
a reader of their public profile. A `participant` title is included: taking part in a contest is a
true thing about somebody's learning, and dropping it would make the record read as "nothing here"
for every person who entered and did not place.

A cancelled contest's results are still results if they were published: house rule 12 — the record
of what happened stays. The contest's own page says it was cancelled.
"""

from __future__ import annotations


def placements_for(user) -> list[dict]:
    if not (user and getattr(user, 'is_authenticated', False)):
        return []

    from .models import ContestResult

    rows = (
        ContestResult.objects.filter(registration__user=user)
        .select_related('contest')
        .order_by('-published_at', 'rank')
    )
    return [
        {
            'contest_id': row.contest_id,
            'title': row.contest.title,
            'result_title': row.title,
            'published_at': row.published_at.isoformat() if row.published_at else None,
        }
        for row in rows
    ]
