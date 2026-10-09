""""Prefilling with current users" — the people a founder already works with, offered as the
candidates for a contest's roles.

This is the owner's own phrase from the ask of 2026-10-09 (*"add presets with making it possible by
prefilling with current users"*), and it is the honest substitute for the gap the root `CLAUDE.md`
has named for months: **there is no people search on this site**, so granting a role anywhere else
needs somebody's numeric account id. A contest needs three to five named people before it can be
announced at all (KC art. 921 §2 — a jury exists only because the regulamin creates one), and
asking a teacher to type five account ids is how a jury ends up being one person.

So the wizard offers the four rosters the founder is already on, each candidate carrying **why they
are being suggested** — "staff with you on Analiza I" — because a list of names with no reason is
worse than a search box: the founder cannot tell two people with the same display name apart, and
cannot tell whether the suggestion is about this contest at all.

    suggested_people(user) -> [{'id': int, 'display_name': str, 'via': [str, ...]}]

Each `via` entry is `'<kind>:<title>'` — `course:Analiza I`, `event:Dzien otwarty`,
`organization:…`, `project:…` — and **the sentence is the frontend's**, not this module's: "staff
with you on Analiza I" is a message-catalogue key with the title interpolated, in both languages
(house rule 1). A server that sent the English sentence would be a third i18n axis nobody asked for.

The four rosters, and why each one:

1. **Course staff** on courses this person staffs (`courses.CourseStaff` + `Course.instructor`) —
   the people who already mark work with them.
2. **Event staff** on events they host or staff (`events.EventStaff` + `Event.host`) — the people
   who already turn up and run a room.
3. **Organisation members** of organisations they belong to (`organizations.OrganizationMember`) —
   the school, the faculty, the circle.
4. **Project members** of material projects they co-write (`coauthoring.ProjectMember`).

**It is a suggestion list and nothing else.** It confers no permission, it is never a membership
test, and adding somebody from it is the same `ContestStaff` write as adding them by account id —
which stays available as the fallback, because the person a founder most wants on a jury may be
somebody they have never shared a roster with.

**Privacy.** Everything here is already visible to this user: they are on the same roster as every
person listed, and `display_name` is what every byline on the site shows. No email, no account
beyond a display name and an id, and nothing about anybody the caller does not already share a
roster with. An anonymous caller gets an empty list rather than an error.
"""

from __future__ import annotations


def _display_name(user) -> str:
    profile = getattr(user, 'profile', None)
    if profile is not None and profile.display_name:
        return profile.display_name
    return user.username


def _add(found: dict, user, reason: str) -> None:
    if user is None:
        return
    row = found.setdefault(user.pk, {'id': user.pk, 'display_name': _display_name(user), 'via': []})
    if reason not in row['via']:
        row['via'].append(reason)


def suggested_people(user) -> list[dict]:
    """The four rosters, unioned, with the caller themself removed.

    Each roster is read with its own two queries rather than one clever join: the four models have
    four different shapes (two of them denormalise the owner onto the parent row), and a join that
    happened to work would be a second implementation of "who staffs this" in an app that has no
    business knowing.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return []

    found: dict[int, dict] = {}

    # 1. courses this person runs or helps run. The instructor is denormalised onto the course
    #    row and is not necessarily a `CourseStaff` row, so both arms are read.
    from courses.models import Course, CourseStaff

    courses = list(
        Course.objects.filter(pk__in=_course_ids(user)).select_related('instructor__profile')
    )
    for course in courses:
        for row in CourseStaff.objects.filter(course=course).select_related('user__profile'):
            _add(found, row.user, f'course:{course.title}')
        _add(found, course.instructor, f'course:{course.title}')

    # 2. events they host or staff. `events.EventStaff` DOES carry the host as a real `organiser`
    #    row (`Event.save()` creates it), so one arm is enough here — and the difference between
    #    the two apps is exactly why this is four reads and not one join.
    from events.models import Event, EventStaff

    events = list(Event.objects.filter(pk__in=_event_ids(user)))
    for event in events:
        for row in EventStaff.objects.filter(event=event).select_related('user__profile'):
            _add(found, row.user, f'event:{event.title}')

    # 3. organisations they belong to
    from organizations.models import OrganizationMember

    my_orgs = OrganizationMember.objects.filter(user=user).values_list('organization_id', flat=True)
    for row in (
        OrganizationMember.objects.filter(organization_id__in=list(my_orgs))
        .select_related('user__profile', 'organization')
    ):
        _add(found, row.user, f'organization:{row.organization.name}')

    # 4. material projects they co-write
    from coauthoring.models import ProjectMember

    my_projects = ProjectMember.objects.filter(user=user).values_list('project_id', flat=True)
    for row in (
        ProjectMember.objects.filter(project_id__in=list(my_projects))
        .select_related('user__profile', 'project__material')
    ):
        # A project has no title of its own — `MaterialProject` is a `OneToOne` on the material,
        # whose own name lives in its translations. `str(project)` is the one label this app may
        # rely on without reaching into another app's i18n (it reads
        # "project for <branch>/<slug>"), and the slug is the part a founder recognises.
        _add(found, row.user, f'project:{_project_label(row.project)}')

    found.pop(user.pk, None)
    return sorted(found.values(), key=lambda row: (-len(row['via']), row['display_name'].lower()))


def _project_label(project) -> str:
    material = getattr(project, 'material', None)
    slug = getattr(material, 'slug', '') if material is not None else ''
    return slug or str(project)


def _course_ids(user):
    from django.db.models import Q

    from courses.models import Course

    return list(
        Course.objects.filter(Q(instructor=user) | Q(staff__user=user))
        .distinct()
        .values_list('pk', flat=True)
    )


def _event_ids(user):
    from django.db.models import Q

    from events.models import Event

    return list(
        Event.objects.filter(Q(host=user) | Q(staff__user=user))
        .distinct()
        .values_list('pk', flat=True)
    )
