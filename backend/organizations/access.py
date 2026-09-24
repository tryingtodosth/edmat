"""Who may see, join, run and link an organisation — the one module every endpoint here asks.

Root `CLAUDE.md`, boundary 2: a rule more than one endpoint needs lives in one module, and the
endpoints ask it. Five questions live here and nothing outside this file answers any of them:

- **Where does this person stand?** `role_of`, `is_member`, `can_manage`.
- **Which organisations exist for this reader?** `visible_organizations` — a queryset filter, which
  is *visibility*; every pk-addressed action still asks `can_view` for itself, because a filter
  never runs for an id in a URL (house rule 4).
- **May this organisation be linked to this thing?** `link_block_reason`, which answers a WORD.
- **May this person be removed from the roster, or demoted?** `remove_block_reason` → `last_owner`.
- **May this person found an organisation at all?** `found_block_reason` → `minor`.

And, at the bottom, **the four answers `config/nodes.py` dispatches to for the `organization`
kind**. They are thin wrappers over the functions above on purpose: the node seam asks a fixed set
of questions of every kind, and this app's own vocabulary ("a member", "a manager") is what those
questions mean here. `NODE_KINDS` in `config/nodes.py` carries the `organization` line that makes
the dispatch live — the one edit to a shared backend file this step makes (MANAGEMENT-BRIEF.md §4
rule 3).

**A minor may not found an organisation** (`accounts/minors.py`, MANAGEMENT-BRIEF.md §6.1). Founding
one means standing publicly behind a body, being its contact, and being the person a stranger writes
to about it — the same reasoning that already closes event hosting and tutoring listings to an
under-16. A minor may perfectly well be *on* a roster: somebody else put them there, and nothing
about being listed opens a channel to a stranger.
"""

from django.db.models import Q

from .models import ORGANIZATION_MANAGER_ROLES, Organization, OrganizationLink, OrganizationMember

#: The flag this whole app hides behind. Named once so that a check can never be spelled
#: differently in two files.
FEATURE_KEY = 'organizations'

#: The node kinds an organisation may point at — `config.nodes.NODE_KINDS` minus `organization`
#: itself. An organisation inside an organisation is a hierarchy this step does not model
#: (MANAGEMENT-BRIEF.md §3.A, "Not in A"), and a self-referential link with no cycle rule is worse
#: than no link. Read by `link_block_reason` and by the write serializer, never re-listed.
LINKABLE_KINDS = ('course', 'event', 'material')


def _authenticated(user) -> bool:
    return bool(user and getattr(user, 'is_authenticated', False))


# ---- standing -----------------------------------------------------------------------------------


def role_of(user, organization) -> str | None:
    """`'owner' | 'admin' | 'member' | None`. The single source for every other answer here."""
    if not _authenticated(user) or organization is None:
        return None
    row = OrganizationMember.objects.filter(organization=organization, user=user).only('role').first()
    return row.role if row else None


def is_member(user, organization) -> bool:
    return role_of(user, organization) is not None


def can_manage(user, organization) -> bool:
    """Owner or administrator, and **deliberately not platform `is_staff`**.

    `venues.access.is_venue_admin` lets platform staff in because that is the only way a building
    gets its first administrator (a venue is created by staff). An organisation is founded by the
    person who runs it, who is its first owner in the same transaction, so there is no bootstrap
    that needs a back door — and a moderator who genuinely has to intervene has the Django admin and
    the report queue, which leave a record. `feature_gate`'s own `is_staff` bypass is about the kill
    switch and is unaffected by this.
    """
    return role_of(user, organization) in ORGANIZATION_MANAGER_ROLES


def can_view(user, organization) -> bool:
    """An active organisation is public; an inactive one exists only for its own roster.

    Not "public unless deleted": there is no delete. A body that dissolves keeps its page for the
    people who were in it and disappears from everybody else's list and search — 404, because for a
    stranger it no longer exists, which is the honest answer as well as the safe one (house rule 4).
    """
    if organization is None:
        return False
    if organization.is_active:
        return True
    return is_member(user, organization)


def visible_organizations(user, qs=None):
    """The queryset filter behind `/api/organizations/` — visibility, never authority.

    Platform staff see every row, the way every other moderated surface here works, so that a
    moderator can find a body somebody reported after it went quiet.
    """
    qs = Organization.objects.all() if qs is None else qs
    if _authenticated(user) and getattr(user, 'is_staff', False):
        return qs
    if not _authenticated(user):
        return qs.filter(is_active=True)
    return qs.filter(Q(is_active=True) | Q(members__user=user)).distinct()


def organizations_managed_by(user):
    """The ids this person owns or administers — what "link this organisation" offers, and what the
    account menu's own list is scoped by. A values queryset, evaluated by the caller."""
    if not _authenticated(user):
        return OrganizationMember.objects.none().values_list('organization_id', flat=True)
    return OrganizationMember.objects.filter(
        user=user, role__in=ORGANIZATION_MANAGER_ROLES
    ).values_list('organization_id', flat=True)


# ---- refusals, as words (house rule 6) -----------------------------------------------------------


def found_block_reason(user):
    """Why this person may not found an organisation — or `None`.

    - ``minor`` — under 16 (`accounts/minors.py`). See the module docstring.
    """
    from accounts.minors import is_minor

    if is_minor(user):
        return 'minor'
    return None


def link_block_reason(user, organization, node):
    """Why this organisation may not be linked to this node — or `None`.

    - ``not_org_manager`` — you do not run the organisation whose name would go on the badge (403).
    - ``not_node_manager`` — you do not run the thing being claimed (403). **Both are required**:
      the badge is a statement about two parties, and either half alone is one party announcing the
      other's endorsement.
    - ``already_linked`` — this pair already has a row (409: the world moved, somebody got there
      first). Changing `runs` to `supports` is a PATCH of nothing — the link is deleted and made
      again, because the two are different claims rather than two settings of one.
    - ``not_linkable`` — the target is not one of `LINKABLE_KINDS` (400).

    The node's own visibility is NOT checked here: the caller resolved it through
    `config.nodes.resolve_node` and 404s a node it may not see before ever reaching this function,
    which is the order house rule 4 asks for.
    """
    from config import nodes

    if not can_manage(user, organization):
        return 'not_org_manager'
    kind = nodes.kind_of(node)
    if kind not in LINKABLE_KINDS:
        return 'not_linkable'
    if not nodes.can_manage_node(user, node):
        return 'not_node_manager'
    if OrganizationLink.objects.filter(
        organization=organization,
        content_type=nodes.node_content_type(node),
        object_id=node.pk,
    ).exists():
        return 'already_linked'
    return None


def remove_block_reason(organization, membership, *, wanted_role=None):
    """Why this membership may not be removed or demoted — or `None`.

    - ``last_owner`` — this is the only owner left, and an organisation with no owner is a page
      nobody can ever correct again. **Recounted** against the database every time (house rule 5),
      never tracked as a counter: an owner count that misses one code path is wrong forever, and two
      `COUNT`s over an indexed FK are cheap.

    `wanted_role=None` means "remove"; any other value means "set the role to this", and demoting
    the last owner is refused for exactly the same reason removing them is — the end state is
    identical and a rule that only guarded `DELETE` would be walked around by a `PATCH`.
    """
    if membership.role != 'owner':
        return None
    if wanted_role == 'owner':
        return None
    others = (
        OrganizationMember.objects.filter(organization=organization, role='owner')
        .exclude(pk=membership.pk)
        .count()
    )
    if others == 0:
        return 'last_owner'
    return None


# ---- the four answers `config/nodes.py` dispatches to (MANAGEMENT-BRIEF.md §2) --------------------
#
# An organisation is itself a node: tasks, needs, plans and polls hang off it exactly as they hang
# off a course or an event, which is what makes "the student circle's own to-do list" a thing this
# platform has without any of the other five steps knowing this app exists. `config/nodes.py`
# imports these BY NAME and nothing else from here.


def can_view_organization(user, organization) -> bool:
    return can_view(user, organization)


def is_organization_member(user, organization) -> bool:
    """The node seam's "staff" tier. An organisation's roster has no reader tier — everybody on it
    is on it — so `member` and `staff` are the same set here, and `config/nodes.py` answers
    `is_node_member` from this same function for that reason."""
    return is_member(user, organization)


def can_manage_organization(user, organization) -> bool:
    return can_manage(user, organization)


def organization_member_users(organization):
    """The roster as a queryset of users — the assignee / decider picker every management step
    needs, so that no step lists people itself."""
    from django.contrib.auth import get_user_model

    return get_user_model().objects.filter(organization_memberships__organization=organization).distinct()
