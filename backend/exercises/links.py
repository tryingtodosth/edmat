"""Who may change or remove an exercise↔material link, in ONE place.

Two call sites need the same answer and they need it in two different shapes — a queryset filter
(so a stranger's PATCH is a 404 rather than a 403, backend/CLAUDE.md's API conventions) and an
object-level check (root CLAUDE.md house rule 4: a filter never runs for an action that arrives
with an id in the URL, and `ExerciseMaterialLinkViewSet` has both). Keeping the two halves in one
module is what stops them drifting into disagreement, which is the failure mode where a governor
can list a link and then cannot delete it.

The circle is deliberately wider than "whoever added it":

- the link's creator — they made the claim, they can withdraw it;
- **staff**, as everywhere;
- a **governor of the material** (`moderation.services.is_governor_of_material`, which already
  cascades material → branch → discipline) — looking after a material means looking after what
  claims to be in it;
- the material's own **submitter** — they are the person who knows what is actually in the file.

Deliberately NOT in the circle: the linked exercise's author. A link is a claim about the
MATERIAL ("this is on page 34 of my script"), and the exercise's author is not the person who can
settle it. They can still report it like anything else.
"""

from django.db.models import Q

# --- the submission draft's half of the same feature ---------------------------------------------
#
# An exercise submitted "for material X" carries the material in its `ExerciseSubmission.payload`
# JSON draft, and FOUR places then have to agree on what those keys are called: the submission
# serializer that validates them, the queue serializer that shows the moderator "for material X",
# the queue builder that resolves those titles in bulk, and `_apply_submission`, which turns them
# into the real link once the exercise exists. The key names live here, read through these two
# functions, so a rename is one edit rather than four that can half-land.
#
# `materialId` is accepted beside `material_id` for the same reason `_apply_submission` already
# accepts `topicIds` beside `topic_ids`: the draft is written by a camelCase frontend, and a
# submission that spelled it the other way is a real draft, not a malformed one.


def submission_material_id(payload):
    """The material a draft names, as an int, or None. Never raises on junk — a payload is a blob
    somebody's client wrote, so an unparseable value means "no material named", which is what the
    validator then refuses at submission time."""
    if not isinstance(payload, dict):
        return None
    raw = payload.get('material_id', payload.get('materialId'))
    if raw in (None, ''):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def submission_link_fields(payload):
    """`(material_id, role, locator)` — everything `_apply_submission` needs to build the link.

    `role` falls back to `source`, which is the honest default for this flow: somebody writing an
    exercise from a material's page is far more often transcribing one that is IN it than inventing
    extra practice for it, and the value is editable afterwards by anybody who may manage the link.
    """
    from .models import EXERCISE_LINK_ROLE_CHOICES

    if not isinstance(payload, dict):
        return None, 'source', ''
    role = payload.get('material_role', payload.get('materialRole')) or 'source'
    if role not in dict(EXERCISE_LINK_ROLE_CHOICES):
        role = 'source'
    locator = payload.get('material_locator', payload.get('materialLocator')) or ''
    return submission_material_id(payload), role, str(locator).strip()[:120]


def can_manage_link(user, link) -> bool:
    """The authoritative answer for ONE link — what `partial_update`/`destroy` ask before mutating.

    `link.material` is a plain FK access; callers that already `select_related('material__branch')`
    pay nothing extra, which is why the viewset's queryset does.
    """
    from moderation.services import is_governor_of_material

    if user is None or not user.is_authenticated:
        return False
    if user.is_staff:
        return True
    if link.added_by_id == user.pk:
        return True
    if link.material.submitted_by_id == user.pk:
        return True
    return is_governor_of_material(user, link.material)


def manageable_links(queryset, user):
    """The same rule as a queryset filter — the visibility half.

    A strict mirror of `can_manage_link`, not an approximation: `is_governor_of_material` resolves
    a grant on the material itself, on its branch, or on the discipline above it, and all three are
    expressible here (`governed_branch_ids` already flattens discipline grants down to branches).
    An unauthenticated caller gets nothing, so a link id guessed from the wire is a 404 rather than
    a 401 that confirms the row exists.
    """
    from django.contrib.contenttypes.models import ContentType

    from materials.models import Material
    from moderation.models import NodeGovernor
    from moderation.services import governed_branch_ids

    if user is None or not user.is_authenticated:
        return queryset.none()
    if user.is_staff:
        return queryset
    material_ct = ContentType.objects.get_for_model(Material)
    governed_material_ids = NodeGovernor.objects.filter(
        user=user, content_type=material_ct
    ).values_list('object_id', flat=True)
    # `governed_branch_ids` answers `None` for staff (handled above) and a real, possibly empty set
    # for everybody else — never collapse the two, moderation/CLAUDE.md.
    branch_ids = governed_branch_ids(user) or set()
    return queryset.filter(
        Q(added_by=user)
        | Q(material__submitted_by=user)
        | Q(material_id__in=list(governed_material_ids))
        | Q(material__branch_id__in=branch_ids)
    )
