"""Who may see, edit, publish and decide — the ONE place, which every view asks.

House rule 2 in its usual shape: more than one endpoint needs each of these answers (the project
detail, the version list, the publish action, the decide action, the moderation queue and three
serializers all read at least one), and two copies of a trust rule is how one of them drifts.
`galleries/visibility.py` is the same module for that app and the shape this one copies.

House rule 4 is the other half and is why there are two functions for the same question:
`visible_projects` is a **queryset filter** (a stranger never sees a draft in any listing, and
absence is the honest answer as well as the safe one) and `can_view` is an **object-level check**
(a filter never runs for an action that arrives with a pk in the URL). They MUST agree; the test
suite pins them against each other rather than trusting that they were written on the same day.

The deciding circles, which are the part worth reading twice:

* A project whose material already exists and has members decides its own proposals. That is the
  open-science bet this feature makes, the same one posts and galleries make: reports and the kill
  switch cover abuse, and a team that cannot accept its own co-author's work is not a team.
* A **first publication** (`project.material is None`) and a proposal on an **orphan** project (no
  members at all — every one the backfill created for a corpus material with no submitter is one)
  go to staff or to the branch's governor instead. Nobody on the platform has vouched for either,
  so somebody has to.

`needs_staff_review` is the single predicate holding that split, and both the queue and
`can_decide` read it, so the queue can never show a row nobody in it is allowed to decide.
"""

from __future__ import annotations

from django.db.models import Q

from accounts.minors import is_minor
from moderation.services import (
    governed_branch_ids,
    is_feature_enabled,
    is_governor_of_course,
    is_governor_of_material,
)


def _is_authenticated(user) -> bool:
    return bool(user is not None and getattr(user, 'is_authenticated', False))


def _is_verified_contributor(user) -> bool:
    return bool(getattr(getattr(user, 'profile', None), 'is_verified_contributor', False))


def role_of(project, user) -> str | None:
    """This person's role on this project, or None if they are not on the team.

    Iterates `members.all()` rather than filtering, so a prefetched list of projects answers this
    without a query each — the same cache-preserving rule `courses.Course.role_of` documents, and
    the reason a listing of twenty projects does not cost twenty membership queries.
    """
    if not _is_authenticated(user):
        return None
    for row in project.members.all():
        if row.user_id == user.pk:
            return row.role
    return None


def is_member(project, user) -> bool:
    """On the team, in any role. Staff and governors are deliberately NOT members — they can act on
    a project without being on it, and conflating the two would put a moderator's name in the
    co-author list of everything they ever touched."""
    return role_of(project, user) is not None


def is_governor(project, user) -> bool:
    """A governor of this project's content: of the MATERIAL once one exists, of the BRANCH before
    that. The narrowing is deliberate — a material grant is the smallest unit of authority this
    platform hands out (`moderation.services.is_governor_of_material`), and it cannot apply to a
    project that has not produced a material yet, so a draft answers to the branch above it.

    Note both helpers return True for `is_staff`, which is why every caller below can check staff
    once and then fall through to this.
    """
    if not _is_authenticated(user):
        return False
    if project.material_id is not None:
        return is_governor_of_material(user, project.material)
    return is_governor_of_course(user, project.branch)


def can_manage(project, user) -> bool:
    """The team itself: adding and removing co-authors, minting and revoking invite links, deciding
    join requests, transferring ownership.

    Narrower than `can_edit` on purpose. Everybody on the team writes the material; who is ON the
    team is the owner's decision (plus staff and the governor, who need it to fix an abandoned or
    captured project).
    """
    if not _is_authenticated(user):
        return False
    if user.is_staff:
        return True
    if role_of(project, user) == 'owner':
        return True
    return is_governor(project, user)


def can_edit(project, user) -> bool:
    """Save drafts, publish them, and edit the catalogue. Any member, staff, or the governor."""
    if not _is_authenticated(user):
        return False
    if user.is_staff:
        return True
    if is_member(project, user):
        return True
    return is_governor(project, user)


def can_view(project, user) -> bool:
    """Whether this project is reachable at all. The object-level half of `visible_projects`.

    Three cases, and the third is the one that is easy to get wrong:

    * A project whose material is **published** is as public as the material — its history is how a
      reader finds out where the bytes in front of them came from.
    * A project that is still a **draft** is visible to its team, to staff and to the governor.
    * A draft that is **seeking co-authors** is visible to everybody, as a TEASER. This function
      answers "may you reach it"; the serializer answers "how much of it do you get" — a stranger
      gets the pitch and the member list's display names and nothing else. Keeping the two
      separate is what lets one queryset serve the listing and the detail page.
    """
    if project.material_id is not None:
        material = project.material
        if material is not None and getattr(material, 'published', False):
            return True
        # A material a moderator has taken down stops being public, and so does its project. The
        # people who can act on it keep reaching it — they are who would fix it.
        return can_edit(project, user)
    if project.seeking_coauthors:
        return True
    return can_edit(project, user)


def visible_projects(user):
    """The queryset half of `can_view` — every project this caller may reach.

    House rule 4: a filter is not a permission check and a permission check is not a filter, and
    this app needs both. This one is what makes `GET /material-projects/{id}/` answer **404** for a
    stranger poking at a draft: for them it does not exist, which is the honest answer as well as
    the safe one.

    `governed_branch_ids` returns **None for staff** ("do not filter") and a real, possibly empty
    set for a governor — never collapse the two (`moderation/CLAUDE.md`), or a zero-grant governor
    becomes indistinguishable from staff at the query layer.
    """
    from .models import MaterialProject

    queryset = MaterialProject.objects.all()
    public = Q(material__isnull=False, material__published=True) | Q(
        material__isnull=True, seeking_coauthors=True
    )
    if not _is_authenticated(user):
        return queryset.filter(public)
    if user.is_staff:
        return queryset

    branch_ids = governed_branch_ids(user) or set()
    reachable = public | Q(members__user=user)
    if branch_ids:
        reachable |= Q(branch_id__in=branch_ids)
    material_ids = _governed_material_ids(user)
    if material_ids:
        reachable |= Q(material_id__in=material_ids)
    # `distinct()` because the membership join can duplicate a row — a project the caller is a
    # member of AND governs would otherwise appear twice in a listing.
    return queryset.filter(reachable).distinct()


def _governed_material_ids(user) -> set[int]:
    """Material pks this person holds a DIRECT governor grant on.

    Its own helper because `governed_branch_ids` deliberately does not resolve material-level
    grants — they are one level below anything the moderation queue scopes by — and the queryset
    half of `can_view` is the one place that needs them expressed as ids rather than as a per-object
    question.
    """
    from django.contrib.contenttypes.models import ContentType

    from materials.models import Material
    from moderation.models import NodeGovernor

    material_ct = ContentType.objects.get_for_model(Material)
    return set(
        NodeGovernor.objects.filter(user=user, content_type=material_ct).values_list(
            'object_id', flat=True
        )
    )


def can_view_version(version, user) -> bool:
    """One version's own visibility, which is narrower than its project's.

    * `published` / `superseded` — whoever can see the project. This is the history a reader is
      entitled to: what the material used to be, and who changed it.
    * `draft` — the team (and staff/governor). An unfinished version is not an announcement.
    * `proposed` / `rejected` / `withdrawn` — its own author, plus whoever may act on it. A
      rejection and its note stay readable by the person who was refused, which is house rule 6
      applied to a row rather than to a response body.
    """
    project = version.project
    if version.status in ('published', 'superseded'):
        return can_view(project, user)
    if not _is_authenticated(user):
        return False
    if version.status == 'draft':
        return can_edit(project, user)
    return version.created_by_id == user.pk or can_edit(project, user)


def can_decide(version, user) -> bool:
    """May this person accept or reject this proposal? See the module docstring for the two circles.

    Reads `needs_staff_review` rather than re-deriving the condition, so the moderation queue (which
    reads the same predicate to decide what to show) and this check cannot disagree about a row.
    """
    if not _is_authenticated(user):
        return False
    if user.is_staff:
        return True
    project = version.project
    if needs_staff_review(project):
        # Nobody has vouched for this project yet, so its own (possibly empty) team does not get to
        # decide. The branch's governor is the nearest person who has been trusted with anything.
        return is_governor_of_course(user, project.branch)
    return is_member(project, user) or is_governor_of_material(user, project.material)


def governing_switch(project) -> str:
    """Which kill switch a publication or a decision on this project answers to.

    Two switches because there are two abilities (COAUTHORING-BRIEF.md §0), and which one applies is
    a property of the PROJECT rather than of the endpoint: a project with no material yet is still
    somebody bringing a NEW material into being — exactly what the retired `/submit-material` form
    did and what `material_submissions` has always gated — while everything after that first
    publication is collaboration on a material that exists, which is `coauthoring`. Killing one must
    leave the other working, and that is only true if the publish and decide actions ask this
    question per version instead of carrying one class-level gate.
    """
    return 'material_submissions' if project.material_id is None else 'coauthoring'


def switch_allows(project, user) -> bool:
    """Whether that switch is currently open for this caller.

    Deliberately the same two lines `moderation.permissions.feature_gate` runs — staff always pass,
    everybody else gets the flag — because the views turn this into the identical 403 that gate
    produces, and the serializers read it so a Publish button is never drawn for a publish the
    server would refuse.
    """
    if _is_authenticated(user) and user.is_staff:
        return True
    return is_feature_enabled(governing_switch(project))


def can_autopublish_first(user, branch) -> bool:
    """May this person's FIRST publication on a brand-new project skip the queue?

    Staff, a verified contributor, or a governor of the branch — deliberately the same circle
    `exercises.entries.can_autopublish_entry` grants for a brand-new solution entry, and the same
    one the retired `MaterialSubmissionViewSet.perform_create` granted for a brand-new material
    upload, so folding that form in here changed who gets published without waiting.
    Written out here rather than imported from `exercises`: the two are one circle by coincidence of
    today's trust model, not by definition (that module's own docstring says so), and a materials
    rule that silently followed an exercises rule would be the wrong thing to notice late.

    After the first publication this never runs again — a project with a material and a team
    publishes its own versions, which is the whole feature.
    """
    if not _is_authenticated(user):
        return False
    if user.is_staff or _is_verified_contributor(user):
        return True
    return is_governor_of_course(user, branch)


def needs_staff_review(project) -> bool:
    """Whether this project's proposals go to the moderation queue instead of to its own team.

    True in exactly two cases, for one reason: there is nobody whose acceptance would mean
    anything. A project with no `material` has never published — accepting its first version is
    deciding whether a new material exists at all. A project with no `members` is orphaned (every
    backfilled project for a corpus material with no `submitted_by` is one), so "the team decides"
    would mean nobody decides and the proposal would sit forever.
    """
    if project.material_id is None:
        return True
    return not any(True for _ in project.members.all())


def published_basis(version):
    """The version whose PUBLISHED content this one was written on top of, or None.

    Walks `based_on` past every row that was never the material — drafts, and a first publication
    still waiting in the queue — to the first row that was (`published` or `superseded`). Reads the
    project's `versions.all()` rather than following the FK, so a prefetched project answers the
    whole walk without a query per hop.
    """
    by_pk = {row.pk: row for row in version.project.versions.all()}
    current = by_pk.get(version.based_on_id)
    seen = set()
    while current is not None and current.pk not in seen:
        if current.status in ('published', 'superseded'):
            return current
        seen.add(current.pk)
        current = by_pk.get(current.based_on_id)
    return None


def publish_block_reason(version) -> str | None:
    """Why this version cannot be published right now, or None. The ONE answer both
    `services.publish_version` and the serializer's `can_publish` read, so a button is never drawn
    for a publish the server would refuse.

    * `not_draft` — only a draft publishes (an accepted proposal is moved to `draft` first).
    * `stale` — it was not written against what is published now. A higher number is not enough:
      a draft saved while somebody's proposal was waiting, and published after that proposal was
      accepted, is numbered above it yet was written without it. Publishing it would silently
      overwrite accepted work, so the author has to save again from the current version.
    """
    if version.status != 'draft':
        return 'not_draft'
    published = version.project.published_version
    if published is not None and version.number <= published.number:
        return 'stale'
    basis = published_basis(version)
    if getattr(basis, 'pk', None) != getattr(published, 'pk', None):
        return 'stale'
    return None


def propose_block_reason(project, user) -> str | None:
    """Why this person cannot propose a new version, or None if they can.

    A reason rather than a boolean (house rule 6) — the frontend has a separate sentence for each
    of the five, and "sign in" and "you are already a co-author, just edit it" are the same refusal
    to a boolean and completely different to a person.

    Order matters: the checks run from the most specific thing about the CALLER to the most general
    thing about the PROJECT, so somebody who is a member is told that rather than being told the
    material was taken down.
    """
    if not _is_authenticated(user):
        return 'authentication_required'
    if is_member(project, user):
        # Not a refusal so much as a redirection: a member's save IS a draft they can publish, so
        # proposing would be a strictly worse version of what they can already do.
        return 'member'
    if project.material_id is None or project.published_version is None:
        return 'not_published'
    if not getattr(project.material, 'published', False):
        return 'removed'
    from .models import MaterialVersion

    if MaterialVersion.objects.filter(
        project=project, created_by=user, status='proposed'
    ).exists():
        # One open proposal per person, so a disagreement becomes a conversation on the one they
        # already filed rather than a stack of near-identical rows nobody can compare.
        return 'pending_exists'
    return None


def join_block_reason(project, user) -> str | None:
    """Why this person cannot ask to join, or None if they can.

    `minor` is a rule rather than a judgement, and it is the one that most needs its own sentence:
    an account belonging to somebody under 18 may still PROPOSE a version, because a person always
    reads a proposal before it goes anywhere. What it may not do is become a co-author, whose work
    publishes with nobody in between (COAUTHORING-BRIEF.md §0).
    """
    if not _is_authenticated(user):
        return 'authentication_required'
    if is_member(project, user):
        return 'member'
    if is_minor(user):
        return 'minor'
    if project.material_id is not None:
        # A published material takes improvements, not applicants: proposing is open to everybody
        # and needs no permission, so asking to join would be asking for something slower.
        return 'published'
    if not project.seeking_coauthors:
        return 'not_seeking'
    from .models import ProjectJoinRequest

    if ProjectJoinRequest.objects.filter(
        project=project, user=user, status='pending'
    ).exists():
        return 'pending_exists'
    return None


__all__ = [
    'role_of',
    'is_member',
    'is_governor',
    'can_manage',
    'can_edit',
    'can_view',
    'visible_projects',
    'can_view_version',
    'can_decide',
    'governing_switch',
    'switch_allows',
    'can_autopublish_first',
    'needs_staff_review',
    'published_basis',
    'publish_block_reason',
    'propose_block_reason',
    'join_block_reason',
]
