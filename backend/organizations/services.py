"""The two things that are neither a rule nor a view: allocating a slug, and founding a body.

`found` is here rather than in the viewset because "create the organisation AND make its creator its
first owner" is one fact, not two steps a caller could do half of — an organisation with no owner
would violate the invariant `access.remove_block_reason` exists to defend before anybody had a
chance to break it.
"""

from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from .models import Organization, OrganizationMember


def allocate_slug(name: str) -> str:
    """A free slug for a new organisation — the `concepts.services.allocate_slug` shape.

    `slugify`, or the literal word `organization` when the name has nothing sluggable in it (a name
    written entirely in a non-Latin script is real), then `-2`, `-3` … while the name is taken.
    Bounded, because a loop that cannot end is worse than a refusal somebody can retry.
    """
    base = slugify(name or '')[:100] or 'organization'
    candidate = base
    suffix = 2
    while Organization.objects.filter(slug=candidate).exists():
        candidate = f'{base}-{suffix}'[:120]
        suffix += 1
        if suffix > 1000:  # pragma: no cover - a thousand bodies of one name is not a race
            candidate = f'{base}-{timezone.now().timestamp():.0f}'[:120]
            break
    return candidate


def found(*, creator, **fields) -> Organization:
    """Create the organisation and its first owner in one transaction.

    `atomic()` around two fast adjacent statements on two tables is exactly what
    `backend/CLAUDE.md`'s SQLite rule 2 permits; the alternative — create, then add the owner — has
    a window in which the invariant is false, and the window is where a crash leaves a body nobody
    can run.
    """
    with transaction.atomic():
        organization = Organization.objects.create(
            slug=allocate_slug(fields.get('name', '')), created_by=creator, **fields
        )
        OrganizationMember.objects.create(
            organization=organization, user=creator, role='owner', added_by=creator
        )
    return organization
