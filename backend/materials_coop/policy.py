"""The contribution policy, as a rule module — the ONE place that says what `open`, `request` and
`closed` mean (root CLAUDE.md, second load-bearing boundary).

Two callers, and the direction of the dependency is deliberate:

* `coauthoring.access.propose_block_reason` and `join_block_reason` import from here (lazily, the
  same way they import their own models) so that the policy is enforced on the write path that
  already exists — `POST /material-projects/{id}/versions/` and `…/join-requests/` — rather than
  being a decoration the overview page shows and the API ignores.
* `materials_coop.views` asks the same functions for the `can_*` it draws, so no button is drawn
  for a call that would be refused.

A project with no `CoopSettings` row is `open`; see `models.py` for why that is the default.
"""

from django.core.exceptions import ObjectDoesNotExist

from .models import DEFAULT_POLICY


def settings_for(project):
    """The row, or None. Reads the reverse one-to-one without raising, and without a query when the
    caller already `select_related('coop')`."""
    try:
        return project.coop
    except ObjectDoesNotExist:
        return None


def policy_of(project) -> str:
    row = settings_for(project)
    return row.policy if row is not None else DEFAULT_POLICY


def contribution_block_reason(project, user) -> str | None:
    """Why the policy stops this person proposing a version, or None.

    Only ever about OUTSIDERS: `coauthoring.access.propose_block_reason` has already answered
    `member` for the team before it asks here, so a member never reaches this — which is the point
    of the ordering rather than a coincidence of it.
    """
    from coauthoring.access import can_edit

    if can_edit(project, user):
        return None
    policy = policy_of(project)
    if policy == 'request':
        return 'members_only'
    if policy == 'closed':
        return 'closed'
    return None


def join_block_reason_after_publication(project) -> str | None:
    """What a PUBLISHED project says to somebody asking to join.

    Before this app, the answer was always `published` — a published material takes improvements,
    not applicants, because proposing was open to everybody. A `request` policy is exactly the case
    where that stops being true: proposing is closed to outsiders, so asking to join is the only way
    in and must be allowed. `closed` says so in its own word rather than borrowing `not_seeking`,
    which is about a DRAFT nobody has published.
    """
    policy = policy_of(project)
    if policy == 'request':
        return None
    if policy == 'closed':
        return 'closed'
    return 'published'


def can_post(project, user) -> bool:
    """Who may write in the cooperation thread.

    Readable by whoever can see the project (it hangs off a public page for a published material),
    writable by the team, staff and the governor always — and by any signed-in reader while the
    policy is `open`, because that is the reader the thread is for: somebody deciding whether to
    propose. Under `request` and `closed` the thread is the team's room.
    """
    from coauthoring.access import can_edit

    if not getattr(user, 'is_authenticated', False):
        return False
    if can_edit(project, user):
        return True
    return policy_of(project) == 'open'


def post_block_reason(project, user) -> str | None:
    if not getattr(user, 'is_authenticated', False):
        return 'authentication_required'
    return None if can_post(project, user) else 'members_only'


__all__ = [
    'settings_for',
    'policy_of',
    'contribution_block_reason',
    'join_block_reason_after_publication',
    'can_post',
    'post_block_reason',
]
