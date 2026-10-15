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


# ---- general courses and their university/faculty versions (owner, 2026-10-14) ---------------------
#
# "A default/general course, and subcourses for specific universities and faculties." A course may
# have a `parent` — ONE level only: a general course ("Analiza matematyczna 2", a community around
# the subject, no university) and under it the versions for one university and faculty ("UW · MIM ·
# 1000-112bAM2"). Every rule about that shape is here, asked by the serializer and the viewsets
# (root CLAUDE.md boundary 2); the frontend mirrors the refusal words in
# `frontend/src/lib/utils/labels.ts` (`SUBCOURSE_REFUSAL_LABELS`) — house rule 13.
#
# **Who may add a version: anyone the creation gate lets found a course** (`config/creation.py`,
# asked by `CourseViewSet.create` before this module is) **and who can see the general course.**
# Deliberately NOT the general course's managers only: the students of one faculty should not need
# a stranger's permission to gather their course's materials, and a version is its own course with
# its own staff, roster and moderation — it adds nothing to the parent's content and takes nothing
# from it. What the parent's managers keep is everything that is theirs: the parent itself.

#: Visibility, narrowest first — a version may never be MORE visible than its general course.
VISIBILITY_RANK = {'only_you': 0, 'private': 1, 'public': 2}

#: The refusal words `subcourse_block_reason` answers with. Mirrored in labels.ts.
SUBCOURSE_REFUSALS = (
    'parent_not_found',
    'parent_is_subcourse',
    'parent_not_general',
    'parent_is_class',
    'has_subcourses',
    'parent_is_self',
    'parent_fixed',
    'more_visible_than_parent',
)


def visible_courses(qs, user):
    """THE visibility filter for courses, applied by `CourseViewSet.get_queryset` and by the claim
    viewset's lookup alike (house rule 4 — visibility is a queryset filter).

    A course is visible when it is listed (`public`), or the caller runs it or is an active
    participant — and, for a version under a general course, ALSO only when its parent is visible
    to the caller by the same tests. That second half is what keeps "never more visible than its
    parent" true after the parent's owner narrows the parent: the write-time check
    (`subcourse_block_reason`) cannot see the future, the read-time filter does not need to. People
    inside the version itself still reach it — they are in it, and a parent going private must not
    lock a faculty's group out of its own course.
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


def subcourse_block_reason(user, parent, *, visibility, instance=None) -> str | None:
    """Why `user` may not have a course under `parent` with this `visibility` — or None.

    One word each (house rule 6):
      - `parent_is_self`;
      - `parent_not_found` — the caller cannot see the general course (as good as absent);
      - `parent_is_subcourse` — one level only: a version cannot have versions;
      - `parent_not_general` — versions hang under a GENERAL (`topic`) course; a stand-alone
        university course is already one university's, so "a version of it" means nothing;
      - `parent_is_class` — a school class (a course an active school `runs`, `is_school_course`
        above) is one school's group of pupils, not a general course about a subject, so "a
        university/faculty version" of it means nothing. Asked separately from `parent_not_general`
        because a class's `kind` is still the default `topic` (school mode is a link, not a kind),
        so the kind test alone lets it through — which is how a class came to read "A general
        course" and offer versions (WP11);
      - `has_subcourses` — a course that already has versions cannot itself become one;
      - `more_visible_than_parent` — e.g. a public version of an unlisted general course, which
        would publish the existence of something its owner chose not to list.
    (`parent_fixed` is answered by the serializer: the parent is chosen at creation and not moved
    afterwards — moving a version between general courses is left open.)
    """
    if instance is not None and parent.pk == instance.pk:
        return 'parent_is_self'
    if not course_visible_to(user, parent):
        return 'parent_not_found'
    if parent.parent_id is not None:
        return 'parent_is_subcourse'
    if parent.kind != 'topic':
        return 'parent_not_general'
    if is_school_course(parent) is not None:
        return 'parent_is_class'
    if instance is not None and instance.subcourses.exists():
        return 'has_subcourses'
    if VISIBILITY_RANK.get(visibility, 0) > VISIBILITY_RANK.get(parent.visibility, 0):
        return 'more_visible_than_parent'
    return None


# ---- what a "general course" is, and which courses a school may take on (WP12) ------------------
#
# Two edges WP11 left. School mode is a `runs` LINK, not a kind (top of this module), so a class is
# still `kind='topic'`, `parent=None` — which is exactly the shape of a general course. Every place
# that asks "is this a general course" therefore has to ask about the school as well, and every
# place that makes a course a class has to ask about versions. Both questions live here.


def general_courses(qs):
    """GENERAL courses only — `?general=true` on `/api/courses/`, and the meaning of the `/courses`
    hub's "General courses" chip.

    A general course is `kind='topic'`, has no parent, and is not a school class. Each half rules
    out one thing that has the other two: a version (it has a parent), a stand-alone university
    course (it is one university's, `kind='university'`), and a class (an active school `runs` it —
    one school's group of pupils, not a community around a subject). The third is the one that used
    to slip through, because without the `organizations` table a class's row is indistinguishable
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
SCHOOL_RUN_REFUSALS = ('course_is_version', 'course_has_versions')


def makes_a_class(organization_kind: str, link_kind: str) -> bool:
    """Whether a link of this kind from an organisation of this kind would make its course a class.
    The same two constants `_school_link_queryset` filters on, asked before the row exists."""
    return organization_kind == SCHOOL_ORGANIZATION_KIND and link_kind == SCHOOL_LINK_KIND


def school_run_block_reason(course) -> str | None:
    """Why a school may not start to RUN this course (a `runs` link, which makes it a class) — or
    None. The other half of `parent_is_class`: that word stops a version being made UNDER a class;
    this stops a course that is already in the general/version shape becoming a class afterwards.

      - `course_is_version` — it is one university's/faculty's version of a general course. A class
        is one school's group of pupils; a version is one faculty's companion to a subject. A row
        cannot be both without the general course's page listing a school class among its
        university versions, under a university and faculty that are not the school's.
      - `course_has_versions` — it is a general course with versions under it. Making it a class
        would turn every one of those faculty groups into "a version of a school class", the exact
        state `parent_is_class` exists to prevent, reached from the other side.

    Asked by `organizations.access.link_block_reason` for a new link and by
    `organizations.access.kind_change_block_reason` for a body that becomes a school while it
    already `runs` courses — two doors into one state, one rule. A course that is neither is
    untouched, including a stand-alone university course (no parent, no versions): odd for a
    school, but nothing on any page contradicts itself, and refusing it is a decision about what
    schools may run that nobody has taken.
    """
    if course.parent_id is not None:
        return 'course_is_version'
    if course.subcourses.exists():
        return 'course_has_versions'
    return None
