"""Who may see a contest and where they stand on it — the four answers `config/nodes.py`
dispatches to for the `contest` kind, plus the role lookup the model's thin methods use.

One module, asked by the node seam, the viewsets, the discussion locations and every panel that
hangs off a contest (CLAUDE.md boundary 2). A view that filters `Contest.objects` by itself is how
two surfaces start disagreeing about whether a draft exists.

Standing, in the order `config/nodes.py` documents:

- **view** — public (`Contest.is_public`) or on the staff. A stranger gets 404 on everything hung
  on a draft (house rule 4).
- **staff** — the organiser who founded it, or anyone with a `ContestStaff` row in any role.
- **member** — staff, or a participant whose registration holds a place. The prep has no
  registration model, so `is_member` equals `is_staff` until step A widens it
  (`prompts/18-contests-a-core.md` says exactly where: `_registered(user, contest)` below).
- **manage** — the organiser who founded it, or a staff row with role `organiser`.

Platform staff (`is_staff`) are NOT given anything here: a moderator reaches a contest through
the admin and through `feature_gate`'s bypass, not by being a silent organiser of every contest.
"""

from django.contrib.auth import get_user_model

from .models import ORGANISING_ROLES, SCORING_ROLES


def _authenticated(user) -> bool:
    return bool(user and getattr(user, 'is_authenticated', False))


def role_of(user, contest) -> str | None:
    if not _authenticated(user):
        return None
    if contest.organiser_id == user.pk:
        return 'organiser'
    for row in contest.staff.all():
        if row.user_id == user.pk:
            return row.role
    return None


def _registered(user, contest) -> bool:
    """Step A replaces this body with "has a registration in a place-holding status". Until then
    nobody is a participant, which is the honest answer for a model that has no participants."""
    return False


def can_view(user, contest) -> bool:
    if contest.is_public:
        return True
    return role_of(user, contest) is not None


def is_staff(user, contest) -> bool:
    return role_of(user, contest) is not None


def is_member(user, contest) -> bool:
    return is_staff(user, contest) or _registered(user, contest)


def can_manage(user, contest) -> bool:
    return role_of(user, contest) in ORGANISING_ROLES


def can_score(user, contest) -> bool:
    return role_of(user, contest) in SCORING_ROLES


def staff_users(contest):
    User = get_user_model()
    # `.distinct()` because the organiser normally also holds a staff row (the same duplicate the
    # event picker once produced as a Svelte `each_key_duplicate`).
    return (
        User.objects.filter(pk=contest.organiser_id)
        | User.objects.filter(contest_staff_roles__contest=contest)
    ).distinct()


def visible_contests(user, qs=None):
    """The list a reader may see: public ones, plus every one they are on the staff of."""
    from django.db.models import Q

    from .models import PUBLIC_STATUSES, PUBLIC_VISIBILITY, Contest

    qs = Contest.objects.all() if qs is None else qs
    public = Q(status__in=PUBLIC_STATUSES, visibility__in=PUBLIC_VISIBILITY)
    if not _authenticated(user):
        return qs.filter(public)
    return qs.filter(public | Q(organiser=user) | Q(staff__user=user)).distinct()


# ---- the names `config/nodes.py` imports, spelled the way the organisation ones are ----------


def can_view_contest(user, contest) -> bool:
    return can_view(user, contest)


def is_contest_staff(user, contest) -> bool:
    return is_staff(user, contest)


def is_contest_member(user, contest) -> bool:
    return is_member(user, contest)


def can_manage_contest(user, contest) -> bool:
    return can_manage(user, contest)


def contest_staff_users(contest):
    return staff_users(contest)
