"""Management nodes — the things work can hang off, and who has standing on each (MANAGEMENT-BRIEF.md §2).

Six management apps (organisations, tasks, needs, plans, decisions, the work dashboard) all need
the same two answers about the course, event, material or organisation a row is attached to:
*may this person see it at all* and *where do they stand on it*. Each of those objects already
has its own rule for that — `courses.Course.can_curate`, `events.Event.can_organise`,
`coauthoring.access.can_manage` — and each answer is different in a way that matters (a course's
roster includes its participants; an event's host is not in its `staff` table; a material's
authority is its co-authoring project). This module is the one place that dispatches to those
rules by *kind*, so that six apps ask one question and never re-implement one of the answers —
house rule: "a rule that more than one endpoint needs lives in one module, and the endpoints ask
it". An app that filters `Course.objects` itself is how two surfaces start disagreeing.

The registry is deliberately a hand-written map (the `community/targets.py` reasoning): a node
kind is a short word both halves speak, not a model name lowercased. `frontend/src/lib/types/
node.ts` mirrors `NODE_KINDS` from its side and says so; adding a kind is a change to both.

Three levels of standing, in order, each implying the one before:

- **view** — the node's own visibility rule. A stranger who fails it gets 404 on everything hung
  on the node (house rule 4: for them it does not exist).
- **staff** — on the roster that runs it: course staff, event staff and host, a project's members,
  an organisation's members. `member` widens this to "in the room in any capacity" (enrolled,
  going) where the node has such a thing; for a material it is the same as staff.
- **manage** — may run it: `can_administer | can_curate`, `can_organise`, a project's governors,
  an organisation's owners and admins.
"""

from django.apps import apps
from django.contrib.contenttypes.models import ContentType
from django.contrib.auth import get_user_model

# kind -> (app_label, model). `organization` is step A's line (MANAGEMENT-BRIEF.md §3.A): the app is
# registered empty by the prep, and its rule module does not exist until A builds it, so the kind
# stays out of the registry until then — nothing dispatches to a module that is not there.
NODE_KINDS = {
    'course': ('courses', 'course'),
    'event': ('events', 'event'),
    'material': ('materials', 'material'),
    # 'organization': ('organizations', 'organization'),  # uncommented by step A
}
NODE_KIND_OF_MODEL = {v: k for k, v in NODE_KINDS.items()}


def kind_of(node) -> str | None:
    meta = node._meta
    return NODE_KIND_OF_MODEL.get((meta.app_label, meta.model_name))


def resolve_node(kind, pk):
    """The row, or None for an unknown kind or a missing id — the caller turns None into 404."""
    if kind not in NODE_KINDS:
        return None
    try:
        pk = int(pk)
    except (TypeError, ValueError):
        return None
    model = apps.get_model(*NODE_KINDS[kind])
    return model.objects.filter(pk=pk).first()


def node_content_type(node) -> ContentType:
    return ContentType.objects.get_for_model(node, for_concrete_model=False)


def node_title(node) -> str:
    for attr in ('title', 'name'):
        value = getattr(node, attr, None)
        if value:
            return str(value)
    return str(node)


def _authenticated(user) -> bool:
    return bool(user and getattr(user, 'is_authenticated', False))


# ---- course ------------------------------------------------------------------------------------


def _course_view(user, course) -> bool:
    from courses.models import LISTED_VISIBILITIES

    # Mirrors `courses/views.py: _visible_courses` — listed, or run by, or taken by this person.
    if course.visibility in LISTED_VISIBILITIES:
        return True
    return course.is_member(user)


def _course_staff_users(course):
    return get_user_model().objects.filter(course_staff_roles__course=course).distinct()


# ---- event -------------------------------------------------------------------------------------


def _event_view(user, event) -> bool:
    from events.models import PUBLIC_STATUSES, PUBLIC_VISIBILITY

    # Mirrors `events/views.py: EventViewSet._visible_to` — published and public, or the host's
    # and staff's own.
    if event.status in PUBLIC_STATUSES and event.visibility in PUBLIC_VISIBILITY:
        return True
    return event.is_staff_member(user)


def _event_member(user, event) -> bool:
    from events.models import SEAT_HOLDING_STATUSES

    if event.is_staff_member(user):
        return True
    if not _authenticated(user):
        return False
    return event.attendances.filter(attendee=user, status__in=SEAT_HOLDING_STATUSES).exists()


def _event_staff_users(event):
    User = get_user_model()
    # `.distinct()` because the host normally also holds an `EventStaff` row, and the union would
    # list them twice — which step B's assignee picker found as a Svelte `each_key_duplicate`.
    return (
        User.objects.filter(pk=event.host_id) | User.objects.filter(event_staff_roles__event=event)
    ).distinct()


# ---- material — its co-authoring project is the authority ---------------------------------------


def _material_project(material):
    try:
        return material.project
    except Exception:  # RelatedObjectDoesNotExist — a material with no project
        return None


def _material_staff(user, material) -> bool:
    from coauthoring.access import is_member

    project = _material_project(material)
    if project is None:
        return bool(_authenticated(user) and user.is_staff)
    return is_member(project, user)


def _material_manage(user, material) -> bool:
    from coauthoring.access import can_manage

    project = _material_project(material)
    if project is None:
        return bool(_authenticated(user) and user.is_staff)
    return can_manage(project, user)


def _material_staff_users(material):
    project = _material_project(material)
    User = get_user_model()
    if project is None:
        return User.objects.none()
    return User.objects.filter(pk__in=project.members.values_list('user_id', flat=True))


# ---- organization — answered by step A's `organizations/access.py` --------------------------------


def _org(name):
    from organizations import access

    return getattr(access, name)


# ---- the public face ----------------------------------------------------------------------------


def can_view_node(user, node) -> bool:
    kind = kind_of(node)
    if kind == 'course':
        return _course_view(user, node)
    if kind == 'event':
        return _event_view(user, node)
    if kind == 'material':
        return True  # a material is public content; its project's visibility gates the project, not it
    if kind == 'organization':
        return _org('can_view_organization')(user, node)
    return False


def is_node_staff(user, node) -> bool:
    if not _authenticated(user):
        return False
    kind = kind_of(node)
    if kind == 'course':
        return node.is_staff_member(user)
    if kind == 'event':
        return node.is_staff_member(user)
    if kind == 'material':
        return _material_staff(user, node)
    if kind == 'organization':
        return _org('is_organization_member')(user, node)
    return False


def is_node_member(user, node) -> bool:
    if not _authenticated(user):
        return False
    kind = kind_of(node)
    if kind == 'course':
        return node.is_member(user)
    if kind == 'event':
        return _event_member(user, node)
    # A material's "members" are its project's members; an organisation's are its roster.
    return is_node_staff(user, node)


def can_manage_node(user, node) -> bool:
    if not _authenticated(user):
        return False
    kind = kind_of(node)
    if kind == 'course':
        return node.can_administer(user) or node.can_curate(user)
    if kind == 'event':
        return node.can_organise(user)
    if kind == 'material':
        return _material_manage(user, node)
    if kind == 'organization':
        return _org('can_manage_organization')(user, node)
    return False


def node_staff_users(node):
    """The people on the roster, for an assignee or decider picker. A QuerySet of users."""
    kind = kind_of(node)
    if kind == 'course':
        return _course_staff_users(node)
    if kind == 'event':
        return _event_staff_users(node)
    if kind == 'material':
        return _material_staff_users(node)
    if kind == 'organization':
        return _org('organization_member_users')(node)
    return get_user_model().objects.none()


def node_ref(node, user) -> dict:
    """What `GET /api/nodes/{kind}/{id}/` answers, and what a serializer embeds for a row's node."""
    return {
        'kind': kind_of(node),
        'id': node.pk,
        'title': node_title(node),
        'is_staff': is_node_staff(user, node),
        'is_member': is_node_member(user, node),
        'can_manage': can_manage_node(user, node),
    }
