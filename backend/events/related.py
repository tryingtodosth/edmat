"""Event ↔ course, through the organisation — "this conference's workshops became these courses".

`00-DESIGN.md` §1 rule 1: a new link between two surfaces goes **through a hub** before it goes
directly, and `organizations.Organization` is the hub that answers *who runs this*. So there is
deliberately **no** `Event.course` and no `Course.event`: a conference and the courses that came
out of it are related because one body ran both, and the body is the thing that outlives either.
An FK would also only ever express one pair, while a faculty stands behind forty of each
(`organizations/CLAUDE.md`, "Why this is an app and not a field").

The walk, and what each step asks:

    event
      → `OrganizationLink` rows pointing at this event (`runs` or `supports`)
      → the organisations behind them, narrowed by `organizations.access.can_view`
      → their `OrganizationLink` rows of kind `runs` whose target is a course
      → narrowed by `courses.views._visible_courses` — the course's OWN visibility rule, asked,
        never re-implemented

Both narrowings matter and neither is decoration. `_readable_links` in `organizations/views.py`
already makes the point from the other side: a link is a claim about two things, so it is only as
public as the *less* public of them. A student circle that ran this event and also runs an
unlisted course must not advertise that course's title here — and `_visible_courses` is the one
place that knows a course may also be reachable because the reader is on its roster.

An organisation may not be linked to an organisation (`access.LINKABLE_KINDS`), so there is no
transitive step and no cycle question: one hop out, one hop back.
"""


def related_courses(event, user) -> list:
    """The courses run by the organisations that run (or support) this event, visible to `user`.

    Newest link first, deduplicated — two organisations behind one event may both run the same
    course, and it is one course either way. Returns a list of `courses.Course` rows; the caller
    serialises them.
    """
    from django.contrib.contenttypes.models import ContentType

    from courses.models import Course
    from courses.views import _visible_courses
    from events.models import Event
    from organizations import access
    from organizations.models import Organization, OrganizationLink

    event_type = ContentType.objects.get_for_model(Event)
    course_type = ContentType.objects.get_for_model(Course)

    organization_ids = OrganizationLink.objects.filter(
        content_type=event_type, object_id=event.pk
    ).values_list('organization_id', flat=True)
    # `can_view` per row rather than a second queryset: it is the function that decides, there are
    # at most a handful of bodies behind one event, and a filter written here would be the second
    # answer to a question `organizations/access.py` already answers (house rule 4 wants the
    # object-level check anyway, since these ids arrive attached to an id in a URL).
    visible_organizations = [
        organization
        for organization in Organization.objects.filter(pk__in=list(organization_ids))
        if access.can_view(user, organization)
    ]
    if not visible_organizations:
        return []

    course_ids = list(
        OrganizationLink.objects.filter(
            organization__in=visible_organizations, content_type=course_type, kind='runs'
        )
        .order_by('-added_at')
        .values_list('object_id', flat=True)
    )
    if not course_ids:
        return []

    reachable = {
        course.pk: course
        for course in _visible_courses(user).filter(pk__in=course_ids).select_related(
            'instructor', 'instructor__profile', 'field'
        )
    }
    ordered: list = []
    for course_id in course_ids:
        course = reachable.pop(course_id, None)
        if course is not None:
            ordered.append(course)
    return ordered
