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
