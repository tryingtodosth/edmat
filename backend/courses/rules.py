"""Who may do what with a course's *school mode* and its completion certificates.

Learning step C (`prompts/04-courses-school-mode.md`). The app's older refusals live as methods on
`Course` itself (`enrollment_block_reason`, `can_administer`, the four `progress_*` predicates) and
stay there — they are facts about the row and about nothing else. The three answers in this module
are different in kind: every one of them needs a second app (`organizations`, `accounts`) or a
second table (`LessonProgress`) to answer at all, so putting them on the model would make
`courses.models` import `organizations.models` at class-definition time for the sake of one
question. One rule module, asked by the endpoints (root `CLAUDE.md`, boundary 2).

**School mode is not a model.** `00-DESIGN.md` §1 rule 1: a new link between two surfaces goes
through a hub before it goes directly, and `organizations.Organization` is the hub that answers
*who runs this*. A class is therefore a course that an organisation of kind `school` has a `runs`
link to — no `Course.is_class` column, no `SchoolClass` model, nothing for the five other places
that read a course to learn about. What school mode changes is two answers, both about STAFF:

1. staff see every participant's progress statements whatever `progress_visibility` narrows them to
   (`off` excepted — `staff_sees_all_progress` says why at length), because a teacher who cannot see
   whether a twelve-year-old did the homework is not running a class; and
2. the roster names each pupil's guardians, because the guardian is who a teacher writes to.

A participant's own view is untouched in both cases. Nothing here lets staff *write* a progress row
— `LessonProgress` is still a statement its subject made, and school mode does not put words in a
pupil's mouth (`courses/models.py: LessonProgress`).

**The `organizations` kill switch deliberately does not reach this.** Turning the organisations
surface off takes away the directory, the panel and the "run by" line — links and pages, house
rule 3 — and must not silently un-school a class in the middle of a term, which would change what a
teacher is shown and what the roster says about a child. The flag governs the *organisations*
surface; the link is a fact about this course either way. Said out loud because it is the one place
in this step where a flag does less than a reader might expect.
"""

from __future__ import annotations

from .models import ACTIVE_ENROLLMENT_STATUSES, CourseCompletion, Lesson, LessonProgress

#: The link kind that makes a course a class. `supports` deliberately does not: a faculty that
#: lends its name to a reading group has not taken responsibility for its roster, and the whole of
#: school mode is about who is answerable for the children on it (`organizations/models.py`:
#: "`runs` is 'this is ours'; `supports` is 'we are behind it'").
SCHOOL_LINK_KIND = 'runs'
#: The organisation kind. One value rather than a set — a university runs courses too, and does not
#: make them classes with guardians on the roster.
SCHOOL_ORGANIZATION_KIND = 'school'


def _school_link_queryset():
    """Every `runs` link from an active school to a course — the one copy of this filter.

    Both public functions below are the same question asked of one course and of all of them, so the
    predicate lives here. Two spellings of "is this a school course" is exactly how the roster and
    the progress panel would start disagreeing about one child.
    """
    from django.contrib.contenttypes.models import ContentType

    from organizations.models import OrganizationLink

    from .models import Course

    return OrganizationLink.objects.filter(
        content_type=ContentType.objects.get_for_model(Course),
        kind=SCHOOL_LINK_KIND,
        organization__kind=SCHOOL_ORGANIZATION_KIND,
        organization__is_active=True,
    ).select_related('organization')


def schools_running_courses() -> dict[int, object]:
    """``{course_id: Organization}`` for every course an active school says it runs.

    One query for the whole map rather than one per course, because `CourseSerializer` draws this on
    every row of a list and a per-course lookup would be an N+1 on the course directory. The honest
    limit: the map is as large as the number of classes every school on the platform runs, loaded
    whole. That is a few hundred rows for any deployment this project is aimed at, and the day it is
    not, the fix is a narrowed query by course id rather than a cache.
    """
    # Last row wins where a course is somehow run by two schools. Deliberately not an error: two
    # schools genuinely co-running a class is a thing that happens, and school mode asks a yes/no
    # question ("is a school answerable for this roster") that either of them answers the same way.
    return {row.object_id: row.organization for row in _school_link_queryset()}


def is_school_course(course):
    """The school running this course, or ``None``.

    The single-object form, for the paths that hold one course and ask about it once (the progress
    override, the roster, issuing a certificate).
    """
    if course is None or not getattr(course, 'pk', None):
        return None
    link = _school_link_queryset().filter(object_id=course.pk).first()
    return link.organization if link else None


def _school_staff(user, course, school):
    """Whether this viewer runs a class — the shared half of both widenings.

    `can_curate` rather than `is_staff_member`, matching every other "acts on participants" check in
    this app: an assistant marks the register, and the question school mode answers is about the
    people who run the room rather than about anybody who happens to hold a staff row.

    `school` may be passed in already resolved, so a response rendering thirty lessons asks the
    organisations table once rather than thirty times.
    """
    if not course.can_curate(user):
        return False
    return bool(school if school is not None else is_school_course(course))


def staff_sees_all_progress(user, course, *, school=None) -> bool:
    """Whether this viewer reads every participant's statements whatever the course's mode says.

    **`off` is the one mode this does not widen, and that is a decision rather than an oversight.**
    The other three are *narrowings* — there is a tracker, and this is who may read how much of it —
    so a class removing the narrowing for its own staff takes nothing away from anybody. `off` is
    different in kind: it is the course saying there is no tracker at all, and
    `Course.progress_visibility`'s own comment records that it "blinds staff too… an instructor who
    turns tracking off has told their participants nobody is watching". A school override would
    quietly make that untrue, for children, after the fact. A class that wants the register turns
    tracking on — one setting, already an administrator's to set, and visible to the participants.
    """
    if course.progress_visibility == 'off':
        return False
    return _school_staff(user, course, school)


def staff_sees_guardians(user, course, *, school=None) -> bool:
    """Whether the roster names each pupil's guardians to this viewer.

    Deliberately **not** routed through `staff_sees_all_progress`: the two widenings arrive together
    because they are one decision ("a school is answerable for these children"), but they are not one
    rule. A guardian is who a teacher writes to about a child; it has nothing to do with whether the
    course keeps a progress tracker, and a class that turned tracking off would otherwise lose its
    guardian column for no reason anybody could explain. The first draft of this module did exactly
    that, by making one function call the other.
    """
    return _school_staff(user, course, school)


# ---- the completion certificate ----------------------------------------------------------------
#
# Issued by hand, by course staff, to a participant whose OWN statements say every lesson is done.
# Never automatic: a certificate is somebody putting their name to a claim about somebody else, and
# a row that appeared on its own would be EdMat making that claim, which it has no standing to do
# (`00-DESIGN.md` §4.5). And never a grade — `PRODUCT.md` has no gradebook and §5 of the design says
# why: a mark is an institution's judgement, and this platform is not one.


def lesson_count(course) -> int:
    """How many lessons the course has, over every chapter.

    Counted from the database rather than from a prefetched tree: this number is the denominator of
    a claim printed on a document, and a count taken from a serializer's filtered view of the
    chapters would quietly exclude a locked week — which the participant still has to do.
    """
    return Lesson.objects.filter(chapter__course=course).count()


def lessons_done_count(course, participant) -> int:
    """How many of them this person has said they finished. Recounted, never stored (house rule 5)."""
    return LessonProgress.objects.filter(
        lesson__chapter__course=course, participant=participant, status='done'
    ).count()


def completion_note(course, participant) -> str:
    """The basis of the certificate, in words, as it is recorded on the row at issue time.

    Stored rather than recomputed when the sheet is drawn, so the document carries its own basis: a
    week added to the course next term must not retroactively turn "12 of 12 lessons" into a lie,
    and a lesson deleted must not turn it into "13 of 11".
    """
    total = lesson_count(course)
    done = lessons_done_count(course, participant)
    return f"{done} of {total} lessons, by the participant's own statements"


def completion_block_reason(user, course, participant) -> str | None:
    """Why this certificate may not be issued — or ``None``.

    - ``not_staff`` — you do not run this course. Answered as **404** by the endpoint, matching
      every other staff action here (`decide`, `update`, `staff_detail`): for somebody who does not
      run a course, its staff surface does not exist.
    - ``not_participant`` — the named person is not on the roster. **400**: the request named the
      wrong person, and no amount of waiting makes it right.
    - ``not_done`` — their own statements do not yet say every lesson is finished. **409**: the
      request is well formed and the world is simply not there yet, which is the same shape as
      "this is full" and deliberately not a 400.
    - ``already_issued`` — there is a row for this pair. **409**. A revoked one counts: the record
      of a revoked certificate is kept (house rule 12), and issuing again is `revoke`'s inverse,
      which this step does not build — named in "Left open" rather than guessed at.

    A course with **no lessons at all** answers `not_done`. "0 of 0" is vacuously complete and would
    print a certificate for turning up to an empty course, which is the one reading nobody means.
    """
    if not course.can_curate(user):
        return 'not_staff'
    if participant is None or not course.enrollments.filter(
        participant=participant, status__in=ACTIVE_ENROLLMENT_STATUSES
    ).exists():
        return 'not_participant'
    if CourseCompletion.objects.filter(course=course, participant=participant).exists():
        return 'already_issued'
    total = lesson_count(course)
    if total == 0 or lessons_done_count(course, participant) < total:
        return 'not_done'
    return None


def revoke_block_reason(user, completion) -> str | None:
    """Why this certificate may not be withdrawn — or ``None``.

    - ``not_staff`` — **404**, as above.
    - ``already_revoked`` — **409**, the world moved; two staff pressing the button is one decision
      taken twice, not an error worth a 400.
    """
    if not completion.course.can_curate(user):
        return 'not_staff'
    if completion.revoked_at is not None:
        return 'already_revoked'
    return None


def can_read_completion(user, completion) -> bool:
    """The holder, the issuer, and anybody who runs the course. Nobody else — a stranger gets 404
    from the endpoint, because for them this document does not exist (house rule 4).

    The *issuer* is in the list separately from "course staff" on purpose: somebody who signed a
    certificate and has since been taken off the course's staff must still be able to see what they
    put their name to.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return False
    if completion.participant_id == user.pk or completion.issued_by_id == user.pk:
        return True
    return completion.course.is_staff_member(user)


# ---- the course tree: subcourses and university/faculty versions (owner, 2026-10-14 / 2026-10-21) --
#
# 2026-10-14: "A default/general course, and subcourses for specific universities and faculties."
# 2026-10-21: "courses can have their own courses (subcourses) … having parent-child relationship."
#
# One column answers both: `Course.parent` is the course this one is PART OF, and the relation a
# child has to its parent is READ from the two rows rather than stored (`relation_to_parent`):
#
# - a **version** — a `university` course under a `topic` (general) course: one university's and
#   faculty's own group for the subject ("UW · MIM · 1000-112bAM2" under "Analiza matematyczna 2");
# - a **subcourse** — anything else: a part of a course that is itself a whole course, with its own
#   staff, roster, weeks and board ("Analiza 1" and "Analiza 2" under "Analiza", or a lab group under
#   one university's course).
#
# The tree may nest (`MAX_COURSE_DEPTH` levels, counted from a root), may not loop, and a child is
# never more visible than its parent. Every rule about the shape is here, asked by the serializer
# and the viewsets (root CLAUDE.md boundary 2); the frontend mirrors the refusal words in
# `frontend/src/lib/utils/labels.ts` (`SUBCOURSE_REFUSAL_LABELS`) — house rule 13.
#
# **Who may add a child differs by relation, and that is the point of telling them apart.**
# A VERSION may be added by anyone the creation gate lets found a course (`config/creation.py`,
# asked by `CourseViewSet.create` before this module is) and who can see the general course —
# deliberately NOT the general course's managers only: the students of one faculty should not need
# a stranger's permission to gather their course's materials, and a version is its own course that
# adds nothing to the parent's content and takes nothing from it. A SUBCOURSE is the parent's own
# structure — "week 1–7 is Analiza 1" is a statement about the parent — so it takes somebody who
# curates the parent (`not_parent_staff`). A stranger may still open a version under a public
# course; they may not carve somebody else's course into parts.

#: Visibility, narrowest first — a child may never be MORE visible than its parent.
VISIBILITY_RANK = {'only_you': 0, 'private': 1, 'public': 2}

#: How deep the tree goes, counted in rows from a root (a root alone is depth 1). Four levels is
#: "course › part › subpart › a university's group of that", which is already more than anybody
#: asked for; the cap exists so that a walk up or down the tree is bounded by construction.
MAX_COURSE_DEPTH = 4

#: The refusal words `subcourse_block_reason` answers with. Mirrored in labels.ts.
SUBCOURSE_REFUSALS = (
    'parent_not_found',
    'parent_is_self',
    'parent_is_descendant',
    'parent_is_class',
    'not_parent_staff',
    'too_deep',
    'more_visible_than_parent',
)


def relation_to_parent(course) -> str | None:
    """`'version'`, `'subcourse'`, or None for a root. Read from the two rows, never stored:
    a version is a `university` course under a `topic` one, and everything else with a parent is a
    subcourse. `CourseSerializer.parent_relation` carries it; the course page draws the two lists
    from it and `labels.ts` names them."""
    parent = course.parent if course.parent_id is not None else None
    if parent is None:
        return None
    if course.kind == 'university' and parent.kind == 'topic':
        return 'version'
    return 'subcourse'


def ancestors_of(course) -> list:
    """The chain above a course, ROOT FIRST, bounded by `MAX_COURSE_DEPTH` so that a loop the
    database somehow holds (the API refuses one) can never hang a request."""
    chain = []
    seen = {course.pk}
    node = course.parent if course.parent_id is not None else None
    while node is not None and node.pk not in seen and len(chain) < MAX_COURSE_DEPTH:
        chain.append(node)
        seen.add(node.pk)
        node = node.parent if node.parent_id is not None else None
    chain.reverse()
    return chain


def depth_of(course) -> int:
    """1 for a root, 2 for its child, and so on."""
    return len(ancestors_of(course)) + 1


def descendant_ids(course, *, max_depth: int = MAX_COURSE_DEPTH) -> list[int]:
    """Every course under this one, any depth, as ids — breadth first, this course NOT included.
    One query per level rather than one per row; the cap bounds it. Used by the course board
    (`activity.PostViewSet.list?course=`), the materials index and the cycle guard below."""
    from .models import Course

    found: list[int] = []
    frontier = [course.pk]
    seen = {course.pk}
    for _level in range(max_depth):
        children = list(
            Course.objects.filter(parent_id__in=frontier).values_list('pk', flat=True)
        )
        children = [pk for pk in children if pk not in seen]
        if not children:
            break
        seen.update(children)
        found.extend(children)
        frontier = children
    return found


def subtree_height(course) -> int:
    """1 for a leaf, 2 for a course with children, … — how much room the thing being moved takes
    up below the parent it is moved under."""
    from .models import Course

    height = 1
    frontier = [course.pk]
    for _level in range(MAX_COURSE_DEPTH):
        frontier = list(
            Course.objects.filter(parent_id__in=frontier).values_list('pk', flat=True)
        )
        if not frontier:
            break
        height += 1
    return height


def visible_courses(qs, user):
    """THE visibility filter for courses, applied by `CourseViewSet.get_queryset` and by the claim
    viewset's lookup alike (house rule 4 — visibility is a queryset filter).

    A course is visible when it is listed (`public`), or the caller runs it or is an active
    participant — and, for a course under a parent, ALSO only when its parent is visible to the
    caller by the same tests. That second half is what keeps "never more visible than its parent"
    true after the parent's owner narrows the parent: the write-time check
    (`subcourse_block_reason`) cannot see the future, the read-time filter does not need to. People
    inside the child itself still reach it — they are in it, and a parent going private must not
    lock a faculty's group out of its own course.

    Honest limit: the filter looks ONE level up. A grandparent narrowed after the fact hides the
    parent but not the grandchild, whose own parent row still says `public`. A filter cannot walk
    an unbounded chain; the write-time rank check keeps the chain consistent at every edit.
    """
    from django.db.models import Q

    from .models import LISTED_VISIBILITIES

    own = Q(visibility__in=LISTED_VISIBILITIES)
    parent = Q(parent__isnull=True) | Q(parent__visibility__in=LISTED_VISIBILITIES)
    if user is not None and user.is_authenticated:
        inside = Q(staff__user=user) | Q(
            enrollments__participant=user, enrollments__status__in=ACTIVE_ENROLLMENT_STATUSES
        )
        own |= inside
        parent |= (
            inside
            | Q(parent__staff__user=user)
            | Q(
                parent__enrollments__participant=user,
                parent__enrollments__status__in=ACTIVE_ENROLLMENT_STATUSES,
            )
        )
    return qs.filter(own & parent).distinct()


def course_visible_to(user, course) -> bool:
    """`visible_courses` for one row already in hand."""
    from .models import Course

    return visible_courses(Course.objects.filter(pk=course.pk), user).exists()


def subcourse_block_reason(
    user, parent, *, visibility, kind, instance=None, placing=True
) -> str | None:
    """Why `user` may not have a course of this `kind` and `visibility` under `parent` — or None.
    Asked on create and on a PATCH that touches the parent, the kind or the visibility
    (`instance` is then the course being edited). `placing` is False when the parent is NOT being
    set by this request — an administrator of a subcourse narrowing its visibility is not asking
    to place it anywhere, so only the rank check is asked then (and `parent_is_self`). One word each
    (house rule 6):

      - `parent_is_self`;
      - `parent_not_found` — the caller cannot see the parent (as good as absent);
      - `parent_is_descendant` — the parent is already under the course being moved: a loop;
      - `parent_is_class` — a school class (a course an active school `runs`, `is_school_course`
        above) is one school's group of pupils; it is neither carved into parts nor given
        university versions. Asked by its own word because a class's `kind` is still the default
        `topic` (school mode is a link, not a kind), so no kind test sees it (WP11);
      - `not_parent_staff` — a SUBCOURSE is the parent's own structure and takes somebody who
        curates the parent; a VERSION needs only to see it (the note at the top of this section);
      - `too_deep` — the result would be deeper than `MAX_COURSE_DEPTH`, counting what the moved
        course already carries beneath it;
      - `more_visible_than_parent` — e.g. a public child of an unlisted course, which would
        publish the existence of something its owner chose not to list.
    """
    if instance is not None and parent.pk == instance.pk:
        return 'parent_is_self'
    if placing:
        # The words about PLACING. An edit that leaves the parent alone skips them all: a child's
        # administrator who cannot see the parent any more (it went private, they were never on
        # its staff) must still be able to narrow their own course — the one PATCH that makes the
        # rank rule true again.
        if not course_visible_to(user, parent):
            return 'parent_not_found'
        if instance is not None and parent.pk in descendant_ids(instance):
            return 'parent_is_descendant'
        if is_school_course(parent) is not None:
            return 'parent_is_class'
        is_version = kind == 'university' and parent.kind == 'topic'
        if not is_version and not parent.can_curate(user):
            return 'not_parent_staff'
        below = subtree_height(instance) if instance is not None else 1
        if depth_of(parent) + below > MAX_COURSE_DEPTH:
            return 'too_deep'
    if VISIBILITY_RANK.get(visibility, 0) > VISIBILITY_RANK.get(parent.visibility, 0):
        return 'more_visible_than_parent'
    return None


# ---- what a "general course" is, and which courses a school may take on (WP12) ------------------
#
# Two edges WP11 left. School mode is a `runs` LINK, not a kind (top of this module), so a class is
# still `kind='topic'`, `parent=None` — which is exactly the shape of a general course. Every place
# that asks "is this a general course" therefore has to ask about the school as well, and every
# place that makes a course a class has to ask about the tree.


def general_courses(qs):
    """GENERAL courses only — `?general=true` on `/api/courses/`, and the meaning of the `/courses`
    hub's "General courses" chip.

    A general course is `kind='topic'`, has no parent, and is not a school class. Each half rules
    out one thing that has the other two: a child (it has a parent — a version or a subcourse; the
    hub lists roots and a course page lists what is under it), a stand-alone university course (it
    is one university's, `kind='university'`), and a class (an active school `runs` it — one
    school's group of pupils, not a community around a subject). The third is the one that used to
    slip through, because without the `organizations` table a class's row is indistinguishable
    from a general course's; the hub's chip filtered on "has no parent" alone (WP12).

    **Mirrored** row by row in `frontend/src/lib/utils/labels.ts: isGeneralCourse`, which the hub
    filters with client-side over the rows it already holds (the list is bounded by construction).
    It reads the payload's `kind`, `parent` and `school` — the last resolved by this module's own
    `schools_running_courses` — so the two spellings ask the same three facts (house rule 13).
    """
    class_ids = _school_link_queryset().values('object_id')
    return qs.filter(kind='topic', parent__isnull=True).exclude(pk__in=class_ids)


#: The refusal words `school_run_block_reason` answers with. Mirrored in
#: `frontend/src/lib/utils/labels.ts` (`ORGANIZATION_BLOCK_LABELS` — the refusal surfaces on the
#: organisation's link form, so it reads from that table; house rule 13).
SCHOOL_RUN_REFUSALS = ('course_is_version', 'course_is_subcourse', 'course_has_versions')


def makes_a_class(organization_kind: str, link_kind: str) -> bool:
    """Whether a link of this kind from an organisation of this kind would make its course a class.
    The same two constants `_school_link_queryset` filters on, asked before the row exists."""
    return organization_kind == SCHOOL_ORGANIZATION_KIND and link_kind == SCHOOL_LINK_KIND


def school_run_block_reason(course) -> str | None:
    """Why a school may not start to RUN this course (a `runs` link, which makes it a class) — or
    None. The other half of `parent_is_class`: that word stops a child being made UNDER a class;
    this stops a course that is already in the tree becoming a class afterwards.

      - `course_is_version` — it is one university's/faculty's version of a general course. A class
        is one school's group of pupils; a version is one faculty's companion to a subject. A row
        cannot be both without the general course's page listing a school class among its
        university versions, under a university and faculty that are not the school's.
      - `course_is_subcourse` — it is a part of another course (2026-10-21). A class run by a school
        inside somebody else's course would put the school's pupils under a parent whose staff the
        school did not choose.
      - `course_has_versions` — it has courses under it (versions or subcourses). Making it a class
        would turn every one of them into "a part of a school class", the exact state
        `parent_is_class` exists to prevent, reached from the other side. The word predates
        subcourses and is kept: it is mirrored on the organisation form, and what it refuses has
        not changed, only widened.

    Asked by `organizations.access.link_block_reason` for a new link and by
    `organizations.access.kind_change_block_reason` for a body that becomes a school while it
    already `runs` courses — two doors into one state, one rule. A course that is none of these is
    untouched, including a stand-alone university course (no parent, no children): odd for a
    school, but nothing on any page contradicts itself, and refusing it is a decision about what
    schools may run that nobody has taken.
    """
    if course.parent_id is not None:
        return 'course_is_version' if relation_to_parent(course) == 'version' else 'course_is_subcourse'
    if course.subcourses.exists():
        return 'course_has_versions'
    return None


# --- one item's own audience, and how its licence sits with the course's (2026-11-02) -----------
#
# Owner, 2026-11-02: "different privacy settings per content", and a licence per course with "a
# smooth, subtle, classy warning on content marked otherwise". Both are questions several endpoints
# ask — the item list, the lesson and chapter serializers, the materials index, the in-course search
# — so both live here and nowhere else (root CLAUDE.md, boundary 2).


def _is_submitter(item, user) -> bool:
    return bool(
        item.submitted_by_id
        and user is not None
        and getattr(user, 'is_authenticated', False)
        and item.submitted_by_id == user.pk
    )


def audience_admits(course, visibility: str, user) -> bool:
    """The ladder itself (`models.ITEM_VISIBILITY_CHOICES`), for anything in a course that carries
    it — an item, a pinned set. Only ever a narrowing of the course's rule: the caller has already
    decided the person may open the course."""
    visibility = visibility or 'course'
    if visibility == 'course':
        return True
    if visibility == 'participants':
        return course.is_member(user)
    # `staff`, and any value this module does not know — fail closed.
    return course.is_staff_member(user)


def item_audience_admits(item, user) -> bool:
    """Whether `user` is inside this item's own audience (`models.ITEM_VISIBILITY_CHOICES`).

    The submitter is always admitted: an offer a curator narrowed to staff is still the submitter's
    own, and watching it vanish without a word would read as a removal.
    """
    visibility = getattr(item, 'visibility', 'course') or 'course'
    if visibility != 'course' and _is_submitter(item, user):
        return True
    return audience_admits(item.course, visibility, user)


def item_visibility_block_reason(user, course, visibility: str) -> str | None:
    """Why `user` may not set an item of `course` to `visibility`, or None.

    Narrowing past `course` is a curator's decision: a participant offering something offers it to
    the course, and choosing who in the course sees it is the job of the people who run it.
    """
    from .models import ITEM_VISIBILITY_CHOICES

    if visibility not in {key for key, _ in ITEM_VISIBILITY_CHOICES}:
        return 'item_visibility_unknown'
    if visibility != 'course' and not course.can_curate(user):
        return 'item_visibility_curators_only'
    return None


def item_target_licence(item) -> str | None:
    """The licence of the thing an item points at, when that thing carries one of its own: a corpus
    material or exercise, or a file uploaded to the course. None for everything else (an event, a
    thread, a course, an outside link, a board post) — those are not works this site licenses."""
    if item.material_id is not None:
        return item.material.licence
    if item.exercise_id is not None:
        return item.exercise.licence
    if item.attachment_id is not None:
        return item.attachment.licence
    return None


def item_licence_relation(item) -> str | None:
    """How the item's own licence sits with its course's — `licensing.licences.compare_to_container`
    — or None when the target carries no licence. The page draws a quiet note for everything but
    `same` and `wider`."""
    from licensing.licences import compare_to_container

    target = item_target_licence(item)
    if target is None:
        return None
    return compare_to_container(target, item.course.licence)


def attachment_audience_admits(attachment, user) -> bool:
    """Whether a member of the course is inside one file's own audience
    (`models.ATTACHMENT_VISIBILITY_CHOICES`). Its uploader always is."""
    if getattr(attachment, 'visibility', 'participants') == 'participants':
        return True
    if (
        attachment.uploaded_by_id
        and user is not None
        and getattr(user, 'is_authenticated', False)
        and attachment.uploaded_by_id == user.pk
    ):
        return True
    # `staff`, and any value this module does not know — fail closed.
    return attachment.course.is_staff_member(user)


def attachment_visibility_block_reason(user, attachment, visibility: str) -> str | None:
    """Why `user` may not set this file's audience to `visibility`, or None. Its uploader may (it is
    their file; narrowing it to the staff is how a participant hands something to the teacher alone),
    and so may a curator. Anybody else: `attachment_visibility_not_yours` (answered 404 by the view —
    a file somebody may see but not manage is not theirs to know the controls of)."""
    from .models import ATTACHMENT_VISIBILITY_CHOICES

    if visibility not in {key for key, _ in ATTACHMENT_VISIBILITY_CHOICES}:
        return 'attachment_visibility_unknown'
    is_uploader = bool(attachment.uploaded_by_id and attachment.uploaded_by_id == getattr(user, 'pk', None))
    if not (is_uploader or attachment.course.can_curate(user)):
        return 'attachment_visibility_not_yours'
    return None
