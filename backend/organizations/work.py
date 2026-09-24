"""What this app contributes to the personal work dashboard (MANAGEMENT-BRIEF.md §3.F).

One function, `work_items(user)`, returning a list of dicts in the `work/providers.py` shape:

    ('kind', 'title', 'url', 'due_at', 'status', 'urgency', 'node')

The integrator registers it — step F may not import this app and this app may not edit `work/`
(§4 rule 13), so the two halves meet at this signature and nowhere else.

**What organisations have that is genuinely waiting on somebody.** Step A has no queue: there are no
join requests and no invitations (both named out of scope in §3.A, "Not in A"), so "pending
decisions" would be an empty section forever and a provider that returned everything I am a member
of would be a list of links, not a list of work.

The one real single point of failure a roster can have is **one owner and other people relying on
them**. That is a thing to act on (promote a second owner), it resolves when acted on, and it is
deliberately narrowed so it is not permanent noise: an organisation founded by one person and still
consisting of one person does NOT produce a row, because there is nobody it could fail. Only a body
with a roster — at least one member besides the single owner — does.

Urgency 1 ("this month"), never higher: nothing is overdue, nothing has a date, and a dashboard that
shouted about this would train its reader to ignore the rows that matter. `due_at` is honestly
`None` rather than a made-up deadline (house rule 10).
"""

from django.db.models import Count, Q

from .models import Organization, OrganizationMember


def work_items(user) -> list[dict]:
    """Organisations this person is the ONLY owner of, and which somebody else is relying on."""
    if not (user and getattr(user, 'is_authenticated', False)):
        return []

    # The membership filter is a SUBQUERY rather than a join, and that is load-bearing: filtering
    # `Organization.objects.filter(members__user=..., members__role='owner')` and then annotating
    # `Count('members')` reuses the SAME join, so both counts come back as 1 and the roster is never
    # seen. Written the obvious way first, and caught by the test that asserts the row's shape.
    owned = OrganizationMember.objects.filter(user=user, role='owner').values_list(
        'organization_id', flat=True
    )
    rows = (
        Organization.objects.filter(is_active=True, pk__in=owned)
        .annotate(
            owner_count=Count('members', filter=Q(members__role='owner'), distinct=True),
            roster_count=Count('members', distinct=True),
        )
        .filter(owner_count=1, roster_count__gt=1)
        .order_by('name')
    )

    items = []
    for organization in rows:
        items.append(
            {
                'kind': 'organization',
                'title': organization.name,
                # A FRONTEND path, which is what the dashboard links to (§3.F). The manage page
                # rather than the public one, because the row exists in order to be acted on and the
                # roster is where the action is.
                'url': f'/organizations/{organization.slug}/manage',
                'due_at': None,
                'status': 'sole_owner',
                'urgency': 1,
                'node': {
                    'kind': 'organization',
                    'id': organization.pk,
                    'title': organization.name,
                    'is_staff': True,
                    'is_member': True,
                    'can_manage': True,
                },
            }
        )
    return items
