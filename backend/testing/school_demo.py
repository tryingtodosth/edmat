"""One lived-in school, so school mode has something to show (learning step C).

`Organization.kind='school'` has existed since the management layer and nothing on this platform has
ever used it. `/dziennik` (`HISTORY.md` §17BO) shows a school *register* — a recorded snapshot of a
different product, with no server behind it and, **by owner decision, no data link to EdMat at all**.
So the only way to see what a school looks like *here* was to make one by hand, which is what this
module does: a school, two classes, the teacher who runs them, twelve pupils (eleven of them minors
with guardians on file), progress each pupil stated about themselves, and one completion certificate.

It is `testing/conference_demo.py`'s shape, deliberately, down to the two promises that module makes
about itself (`backend/events/CLAUDE.md`, `HISTORY.md` §17BL) — because this seed can run on the live
database too and the reasoning is identical:

- **Every seeded course and the school itself are titled `TEST=FAKE …`.** `FAKE_PREFIX` is imported
  from `testing/personas.py` rather than spelled again: two seeders writing the same marker
  differently is exactly the drift that makes "is this real?" unanswerable at a glance. A demo class
  and a real one share the `Course` table — there is deliberately no `is_sandbox` column — so the
  title is the only thing telling a reader which is which, and the marker is also the lookup key
  both halves of this module find their own rows by.
- **No seeded account holds authority outside the demo** — `assert_contained()`, run inside the
  build's own transaction, so a build that cannot keep the promise leaves nothing behind.

**What is synthesised.** All of it. The school is not a real school, the twelve pupils are not real
children, and the class names and lesson titles are plausible rather than observed. Polish names are
a first name and the matching surname form (adjectival surnames are gendered — `conference_demo.py`
learned that from a screenshot).

**Idempotent by rebuild.** Accounts, the school, the two classes and the enrolments are
`update_or_create`d on stable keys (username; `(instructor, title)`; slug; `(course, participant)`).
What hangs off a class and has no identity worth keeping — chapters, lessons, filed content, progress
statements, the certificate — is deleted and rebuilt on every run, which is what lets a second run
leave one of everything rather than two.

**Nothing here notifies.** `make_personas` explains why and it holds the same here: a demo re-run
must not put a fresh bell on anybody's account. Enrolments, progress and the certificate are written
directly; the only shared rule the build *calls* is `courses.rules`, and it calls it to **check**
the certificate it is about to write, exactly as `conference_demo` checks its rota against
`shifts.rules` before writing a shift. A plan this module could not legally issue therefore fails
the command rather than producing a certificate the API would have refused.
"""

from __future__ import annotations

from datetime import date

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db.models import Q

from accounts.models import Guardianship
from courses import rules
from courses.models import (
    Chapter,
    Course,
    CourseCompletion,
    CourseItem,
    Enrollment,
    Lesson,
    LessonProgress,
)
from organizations.models import Organization, OrganizationLink, OrganizationMember
from taxonomy.models import Branch
from testing.personas import DEFAULT_PASSWORD, FAKE_PREFIX

User = get_user_model()

#: Every account this module owns. Its own prefix, so neither this command's `--reset` nor
#: `seed_conference_demo`'s nor `seed_demo_users`' (`demo-`) can delete the others' people.
PREFIX = 'school.'

#: The school's name is its key, as `SANDBOX_TITLE` is for the personas' event. Marked, so a reader
#: looking at `/organizations` can tell at a glance that this body is not a real school — which
#: matters more here than for a conference, because a school is a thing parents search for by name.
SCHOOL_NAME = FAKE_PREFIX + 'Szkoła Podstawowa nr 148 (demonstracja)'
SCHOOL_SLUG = 'demo-szkola-148'

#: The two classes. A class is a `courses.Course` that the school has a `runs` link to — there is no
#: `SchoolClass` model and there is not going to be one (`00-DESIGN.md` §1 rule 1).
#:
#: `progress_visibility` differs between them **on purpose**, because it is what school mode is for:
#: 2a keeps its tracker `private` ("only you see your own"), and the only reason the teacher sees the
#: register at all is that a school runs the class. 3b uses the ordinary platform default, so the two
#: pages can be compared side by side.
CLASS_PLAN = [
    {
        'key': '2a',
        'title': FAKE_PREFIX + 'Fizyka — klasa 2a',
        'summary': 'Fizyka dla klasy 2a: kinematyka, dynamika i praca.',
        'progress_visibility': 'private',
        'chapters': [
            ('Kinematyka', ['Ruch jednostajny', 'Ruch przyspieszony', 'Wykresy ruchu']),
            ('Dynamika', ['Trzy zasady dynamiki', 'Tarcie', 'Praca i energia']),
        ],
    },
    {
        'key': '3b',
        'title': FAKE_PREFIX + 'Fizyka — klasa 3b',
        'summary': 'Fizyka dla klasy 3b: elektryczność i magnetyzm.',
        'progress_visibility': 'shared_anonymous',
        'chapters': [
            ('Elektryczność', ['Prawo Ohma', 'Obwody', 'Praca prądu', 'Powtórzenie']),
        ],
    },
]

#: (username suffix, display name, class key, guardian suffixes). Eleven minors and one pupil who
#: has turned sixteen — `school.pupil.12`, deliberately with no guardianship, because that is the
#: honest end of a school roster and it is the row that proves the roster's guardian column reports
#: an *absence* rather than drawing nothing (`EnrollmentSerializer.is_minor` exists for exactly
#: this distinction). `pupil.01`/`pupil.02` are siblings and share a guardian; `pupil.03` has two.
PUPILS = [
    ('01', 'Zofia Kowalska', '2a', ['01']),
    ('02', 'Jan Kowalski', '2a', ['01']),
    ('03', 'Maja Lewandowska', '2a', ['02', '03']),
    ('04', 'Antoni Wójcik', '2a', ['04']),
    ('05', 'Hanna Kamińska', '2a', ['05']),
    ('06', 'Aleksander Zieliński', '2a', ['06']),
    ('07', 'Zuzanna Szymańska', '3b', ['07']),
    ('08', 'Franciszek Dąbrowski', '3b', ['08']),
    ('09', 'Alicja Woźniak', '3b', ['09']),
    ('10', 'Mikołaj Kozłowski', '3b', ['10']),
    ('11', 'Laura Jankowska', '3b', ['11']),
    ('12', 'Kacper Mazur', '3b', []),
]

#: suffix -> display name. One guardian per family, two for `pupil.03`.
GUARDIANS = {
    '01': 'Agnieszka Kowalska',
    '02': 'Piotr Lewandowski',
    '03': 'Marta Lewandowska',
    '04': 'Tomasz Wójcik',
    '05': 'Katarzyna Kamińska',
    '06': 'Grzegorz Zieliński',
    '07': 'Monika Szymańska',
    '08': 'Rafał Dąbrowski',
    '09': 'Joanna Woźniak',
    '10': 'Michał Kozłowski',
    '11': 'Ewa Jankowska',
}

#: A Polish school year, so the certificate's "Termin / Dates" row has something to print and the
#: course page reads like a term rather than an undated list. Fixed dates rather than "now ± n
#: months": a demo whose term silently slides is one nobody can screenshot twice and get the same
#: picture from, and `conference_demo`'s moving clock is there because a conference IN PROGRESS is
#: the interesting state — a class in progress is not.
TERM_STARTS_ON = date(2026, 9, 1)
TERM_ENDS_ON = date(2027, 6, 25)

TEACHER_USERNAME = PREFIX + 'teacher'
TEACHER_NAME = 'Barbara Nowakowska'
#: The head teacher owns the school on the platform, and the teacher is an administrator of it. Two
#: people rather than one because an organisation with a single owner is a single point of failure
#: that `organizations/work.py` reports as a real one — a demo that produces that warning row is
#: demonstrating the warning rather than the school.
HEAD_USERNAME = PREFIX + 'head'
HEAD_NAME = 'Krzysztof Wiśniewski'

#: How far each pupil says they have got, by username suffix: `done` lessons counted from the start
#: of the class, then one optional status for the next lesson. `pupil.01` is the one who has finished
#: everything, and so the only one a certificate may be issued to — `completion_block_reason` refuses
#: all eleven others, which is what the e2e script shows on screen.
PROGRESS_PLAN = {
    '01': (6, None),
    '02': (4, 'in_progress'),
    '03': (5, 'stuck'),
    '04': (2, 'in_progress'),
    '05': (6, None),  # 2a has 6 lessons, so this pupil is ALSO complete — see `_issue_certificate`
    '06': (0, 'stuck'),
    '07': (4, None),
    '08': (2, 'in_progress'),
    '09': (3, 'stuck'),
    '10': (1, 'in_progress'),
    '11': (0, None),
    '12': (4, None),
}

#: The pupil the certificate is issued to. Named rather than "whoever happens to be complete",
#: because `pupil.05` is complete too and a demo with two certificates and no reason for either is
#: less useful than one with a certificate and an obvious next candidate for the teacher to issue.
CERTIFIED_PUPIL = '01'
CERTIFICATE_NOTE = 'Wszystkie lekcje odhaczone; obecność potwierdzona w dzienniku klasowym.'

#: The flags a reader needs on to see all of this. Reported by the command, never flipped — a switch
#: somebody turned off is a decision, and a seed command is not the place to overrule it.
FLAGS_NEEDED = ('courses', 'organizations', 'flashcards')


# ---------------------------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------------------------


def _adult(username: str, display_name: str, password: str):
    """A teacher or a guardian — an ordinary account with an email and a public-by-default profile."""
    user, created = User.objects.get_or_create(
        username=username, defaults={'email': f'{username}@edmat.example'}
    )
    if not created and user.email != f'{username}@edmat.example':
        user.email = f'{username}@edmat.example'
    user.set_password(password)
    user.save()
    profile = user.profile  # accounts/signals.py makes one on first save
    if profile.display_name != display_name:
        profile.display_name = display_name
        profile.save(update_fields=['display_name'])
    return user


def _pupil(username: str, display_name: str, guardians, password: str):
    """A real minor, made the way `accounts.views.ChildrenView.post` makes one.

    A faithful copy of that view's five lines rather than a call into it (it is a DRF view, not a
    service function), and the same copy `testing/personas._child` already keeps — which says, and
    this says again, that the guardian flow is the ONE path in this project that marks an account a
    minor's (`accounts/CLAUDE.md`). If `ChildrenView` grows a rule, there are now **two** other
    places that need it; said here because that is where the drift would otherwise be found.

    A pupil with no guardian in the plan is sixteen and is therefore **not** made a minor: an
    account marked `is_minor` with nobody consenting for it is a state the guardian flow cannot
    produce, and seeding one would be demonstrating a bug.
    """
    user, _ = User.objects.get_or_create(username=username, defaults={'email': ''})
    user.email = '' if guardians else f'{username}@edmat.example'
    user.set_password(password)
    user.save()
    profile = user.profile
    profile.display_name = display_name
    if guardians:
        profile.is_minor = True
        # A minor's profile is locked private by `accounts/minors.py` as a rule; set here too so a
        # demo row looks like what the rule produces rather than relying on the rule being asked.
        profile.show_profile_publicly = False
    profile.save()
    for guardian in guardians:
        # `update_or_create`, so a run after somebody demonstrated "revoke the guardianship" puts
        # the consent back rather than leaving a pupil nobody can answer for.
        Guardianship.objects.update_or_create(
            guardian=guardian, child=user, defaults={'revoked_at': None}
        )
    return user


# ---------------------------------------------------------------------------------------------
# The school and its classes
# ---------------------------------------------------------------------------------------------


def _school(head, teacher) -> Organization:
    school, _ = Organization.objects.update_or_create(
        slug=SCHOOL_SLUG,
        defaults={
            'name': SCHOOL_NAME,
            'kind': 'school',
            'city': 'Warszawa',
            'description': (
                'Przykładowa szkoła na potrzeby demonstracji trybu szkolnego. '
                'Nie jest to prawdziwa placówka — wszystkie dane są wymyślone.'
            ),
            'created_by': head,
            'is_active': True,
        },
    )
    OrganizationMember.objects.update_or_create(
        organization=school, user=head, defaults={'role': 'owner'}
    )
    OrganizationMember.objects.update_or_create(
        organization=school, user=teacher, defaults={'role': 'admin', 'added_by': head}
    )
    return school


def _demo_branch():
    """A `taxonomy.Branch` to hang the classes off, or None.

    Taken from whatever the corpus already holds rather than created: this module must not add rows
    to the taxonomy, which is shared, curated content and not demo data (`prompts/README.md` §5
    rule 1 in spirit — a demo hangs off what exists). Prefers a branch whose slug mentions physics,
    since the classes are physics classes, and falls back to any branch at all so the seed still
    works on a database with a different corpus. None on an empty taxonomy, in which case the
    classes carry no subject and `courses/record.py` honestly reports nothing for them.
    """
    for pattern in ('fizyk', 'mechanik'):
        branch = Branch.objects.filter(slug__icontains=pattern).order_by('slug').first()
        if branch:
            return branch
    return Branch.objects.order_by('slug').first()


def _exercises_for(branch, wanted: int):
    """A few published exercises to file into the lessons, so the lesson→deck button has an input.

    Referenced, never copied (the standing rule), and tolerant of a database with none: an empty
    list leaves the lessons with their titles and notes, which is still a class — it just has no
    "Make a deck from this week" worth pressing, and the command's own output says how many it
    found so that is not a mystery.
    """
    from exercises.models import Exercise

    qs = Exercise.objects.filter(published=True)
    if branch is not None:
        by_branch = list(qs.filter(branch=branch).order_by('number')[:wanted])
        if by_branch:
            return by_branch
    return list(qs.order_by('id')[:wanted])


def _build_class(plan, teacher, school, branch, exercises) -> dict:
    """One class: the course, its link to the school, its weeks and its sessions.

    `visibility='private'` — a school class is not a public listing, and `private` is this app's word
    for "openable by the people in it and by whoever is handed a link" rather than "findable by
    anyone browsing" (`courses/models.py: VISIBILITY_CHOICES`). That is also what makes the e2e's
    stranger check honest: a stranger does not get a 403 on a class, they get a 404, because for
    them it does not exist.
    """
    course, _ = Course.objects.update_or_create(
        instructor=teacher,
        title=plan['title'],
        defaults={
            'summary': plan['summary'],
            'description': (
                'Zajęcia prowadzone w ramach ' + SCHOOL_NAME + '. '
                'Dane demonstracyjne — żaden z uczniów nie jest prawdziwą osobą.'
            ),
            'visibility': 'private',
            'status': 'running',
            'enrollment_policy': 'approval',
            'progress_visibility': plan['progress_visibility'],
            'language': 'pl',
            'starts_on': TERM_STARTS_ON,
            'ends_on': TERM_ENDS_ON,
            # `secondary` (12–19), which is the band `config/audience.py` has for a school class —
            # there is no `school` value and a demo must not invent one.
            'audience': 'secondary',
            'discussion_mode': 'participants',
        },
    )
    if branch is not None:
        course.subjects.set([branch])
    if course.field_id is None and branch is not None:
        course.field = branch.discipline
        course.save(update_fields=['field'])

    # The claim that makes it a class. `runs`, not `supports`: the school is answerable for the
    # children on this roster, which is the whole of what school mode turns on.
    OrganizationLink.objects.update_or_create(
        organization=school,
        content_type=ContentType.objects.get_for_model(Course),
        object_id=course.pk,
        defaults={'kind': 'runs', 'added_by': teacher},
    )

    # Rebuilt every run — see the module docstring. Items first: `CourseItem.lesson` is SET_NULL, so
    # deleting the chapters alone would leave every filed exercise behind as an unfiled row, and a
    # third run would show a loose pile of them under the weeks they used to be in.
    course.items.all().delete()
    course.chapters.all().delete()
    course.completions.all().delete()

    lessons = []
    pool = list(exercises)
    for chapter_order, (chapter_title, lesson_titles) in enumerate(plan['chapters']):
        chapter = Chapter.objects.create(
            course=course,
            title=chapter_title,
            description=f'Dział: {chapter_title.lower()}.',
            order=chapter_order,
        )
        for lesson_order, lesson_title in enumerate(lesson_titles):
            lesson = Lesson.objects.create(
                chapter=chapter,
                title=lesson_title,
                description=f'Lekcja: {lesson_title.lower()}.',
                participant_notes='Zadania do samodzielnego rozwiązania są pod lekcją.',
                order=lesson_order,
            )
            lessons.append(lesson)
            # Two exercises per lesson where the corpus has them. `pool` is consumed rather than
            # reused, because `CourseItem` is unique per (course, exercise) — the same exercise filed
            # into two lessons of one class is refused by the database, which is correct and is why
            # this takes from the front of a list instead of sampling.
            for _ in range(2):
                if not pool:
                    break
                exercise = pool.pop(0)
                CourseItem.objects.create(
                    course=course,
                    lesson=lesson,
                    exercise=exercise,
                    status='approved',
                    submitted_by=teacher,
                    order=lesson_order,
                )
    return {'course': course, 'lessons': lessons}


def _enrol(course, pupils) -> None:
    for pupil in pupils:
        Enrollment.objects.update_or_create(
            course=course, participant=pupil, defaults={'status': 'active', 'notify': False}
        )


def _state_progress(course, lessons, pupil, done_count, trailing) -> int:
    """Write what one pupil says about themselves. Returns how many rows were written.

    Written directly rather than through the endpoint for the same reason `conference_demo` writes
    attendances directly: the endpoint notifies nobody here, but it *is* a request, and a seeder that
    needs a logged-in client to build its own fixture is a seeder that cannot run on a live box.
    What the endpoint would have refused is **checked** instead, against the course's own rule — a
    hand-edited `CLASS_PLAN` that set a class's tracking to `off` would otherwise seed rows the UI
    can never show and the API would never have accepted, which is the shape of demo data that
    teaches somebody the wrong thing.
    """
    if not course.progress_writable_by(pupil):
        raise RuntimeError(
            f'The school demo would have written progress the course refuses — {pupil.username} on '
            f'{course.title!r} (progress_visibility={course.progress_visibility!r}). Fix CLASS_PLAN.'
        )
    written = 0
    for lesson in lessons[:done_count]:
        LessonProgress.objects.update_or_create(
            lesson=lesson, participant=pupil, defaults={'status': 'done'}
        )
        written += 1
    if trailing and done_count < len(lessons):
        LessonProgress.objects.update_or_create(
            lesson=lessons[done_count], participant=pupil, defaults={'status': trailing}
        )
        written += 1
    return written


def _issue_certificate(course, teacher, pupil) -> CourseCompletion:
    """The one certificate, issued the way a member of staff issues one — checked first.

    `completion_block_reason` is asked before the row is written, so a hand-edited `PROGRESS_PLAN`
    that no longer makes this pupil complete fails the command instead of seeding a certificate the
    API itself would have refused. That is `conference_demo`'s rule about its rota plan, kept: a
    demo whose data the real rules would reject is worse than no demo, because it teaches the wrong
    thing to whoever screenshots it.

    `note` is composed by `rules.completion_note` exactly as the endpoint composes it, so the sheet
    carries its own basis in the same words a real one would.
    """
    reason = rules.completion_block_reason(teacher, course, pupil)
    if reason is not None:
        raise RuntimeError(
            f'The school demo would have issued a certificate the rules refuse ({reason!r}) — '
            f'{pupil.username} on {course.title!r}. Fix PROGRESS_PLAN or CERTIFIED_PUPIL.'
        )
    note = f'{rules.completion_note(course, pupil)}. {CERTIFICATE_NOTE}'
    return CourseCompletion.objects.create(
        course=course, participant=pupil, issued_by=teacher, note=note[:500]
    )


# ---------------------------------------------------------------------------------------------
# Containment
# ---------------------------------------------------------------------------------------------

#: Every model in this project through which one account gains authority over something, as
#: (label, model path, the field naming what the authority is *over*, the key into `allowed`). A
#: seeded account may hold a row here only when the thing it points at is this demo's own school or
#: one of its own classes; anything else is authority that leaked out of the sandbox.
#:
#: Hand-maintained, like `conference_demo.CONTAINMENT_MODELS`, and for the same reason: a new way
#: for an account to gain authority should have to be thought about here once. The two tuples are
#: deliberately separate — they scope different things — and the test asserts every entry here still
#: imports, so a rename cannot turn the check into a silent no-op.
CONTAINMENT_MODELS = (
    ('CourseStaff', 'courses.models.CourseStaff', 'course'),
    ('OrganizationMember', 'organizations.models.OrganizationMember', 'organization'),
    ('EventStaff', 'events.models.EventStaff', None),
    ('VenueStaff', 'venues.models.VenueStaff', None),
    ('ProjectMember', 'coauthoring.models.ProjectMember', None),
    ('NodeGovernor', 'moderation.models.NodeGovernor', None),
)


def seeded_accounts():
    """Every account this seeder owns."""
    return User.objects.filter(username__startswith=PREFIX)


def assert_contained(school, courses) -> dict:
    """Refuse to hand back a demo whose accounts can reach anything outside it.

    The same check `conference_demo.assert_contained` makes, scoped to a school instead of a
    conference, and run here rather than only in a test for the same reason: the test runs on a
    machine where nothing is at stake, and this runs wherever somebody seeds a demonstration beside
    real courses and real children.

    The membership test is the **marker** itself: a `CourseStaff` row is allowed only on a course
    whose title says it is fake, and an `OrganizationMember` row only on a school whose name says
    the same. That ties the two guarantees together — widening containment means marking another
    course as demonstration data, in public, which is a thing somebody has to mean.
    """
    from importlib import import_module

    accounts = list(seeded_accounts())
    if not accounts:  # nothing seeded yet is not "nothing leaked"
        raise RuntimeError('Containment check found no seeded accounts at all — the seeder did not run.')

    leaks = []
    for user in accounts:
        if user.is_staff or user.is_superuser:
            flags = ', '.join(
                name for name, value in (('is_staff', user.is_staff), ('is_superuser', user.is_superuser)) if value
            )
            leaks.append(f'{user.username}: {flags}')
        if user.groups.exists():
            leaks.append(f'{user.username}: in group(s) {", ".join(user.groups.values_list("name", flat=True))}')
        if user.user_permissions.exists():
            leaks.append(f'{user.username}: {user.user_permissions.count()} direct permission(s)')

    allowed = {
        'course': set(
            Course.objects.filter(title__startswith=FAKE_PREFIX).values_list('pk', flat=True)
        ),
        'organization': set(
            Organization.objects.filter(name__startswith=FAKE_PREFIX).values_list('pk', flat=True)
        ),
    }
    for course in courses:
        if course.pk not in allowed['course']:  # belt and braces: the marker is what is being trusted
            raise RuntimeError(f'The demo class {course.title!r} does not carry the {FAKE_PREFIX!r} marker.')
    if school.pk not in allowed['organization']:
        raise RuntimeError(f'The demo school {school.name!r} does not carry the {FAKE_PREFIX!r} marker.')

    for label, path, scope_field in CONTAINMENT_MODELS:
        module_path, _, class_name = path.rpartition('.')
        model = getattr(import_module(module_path), class_name)
        rows = model.objects.filter(user__in=accounts)
        if scope_field is not None:
            rows = rows.exclude(**{f'{scope_field}_id__in': allowed[scope_field]})
        for row in rows.select_related('user')[:20]:
            leaks.append(f'{row.user.username}: {label} row #{row.pk} outside this school')

    if leaks:
        raise RuntimeError(
            'The school demo would have given its accounts authority outside itself, so it was not '
            'created. Offending rows:\n  - ' + '\n  - '.join(leaks) + '\n'
            'This almost always means a seeded username collided with a real account. Rename the '
            'demo prefix, or remove the real account’s row, and seed again.'
        )
    return {'accounts_checked': len(accounts), 'surfaces_checked': len(CONTAINMENT_MODELS) + 2}


# ---------------------------------------------------------------------------------------------
# The build
# ---------------------------------------------------------------------------------------------


def build_school_demo(password: str = DEFAULT_PASSWORD) -> dict:
    """Build or rebuild the whole thing. The caller wraps this in one `transaction.atomic()`."""
    head = _adult(HEAD_USERNAME, HEAD_NAME, password)
    teacher = _adult(TEACHER_USERNAME, TEACHER_NAME, password)
    guardians = {
        suffix: _adult(f'{PREFIX}guardian.{suffix}', name, password)
        for suffix, name in GUARDIANS.items()
    }
    pupils = {
        suffix: _pupil(
            f'{PREFIX}pupil.{suffix}',
            name,
            [guardians[g] for g in guardian_suffixes],
            password,
        )
        for suffix, name, _class_key, guardian_suffixes in PUPILS
    }

    school = _school(head, teacher)
    branch = _demo_branch()
    # Enough for two per lesson across both classes; `_exercises_for` returns fewer if the corpus
    # has fewer, and the classes are still classes.
    total_lessons = sum(len(titles) for plan in CLASS_PLAN for _, titles in plan['chapters'])
    exercise_pool = _exercises_for(branch, total_lessons * 2)

    classes: dict = {}
    cursor = 0
    for plan in CLASS_PLAN:
        lessons_here = sum(len(titles) for _, titles in plan['chapters'])
        slice_size = lessons_here * 2
        built = _build_class(
            plan, teacher, school, branch, exercise_pool[cursor : cursor + slice_size]
        )
        cursor += slice_size
        classes[plan['key']] = built
        _enrol(
            built['course'],
            [pupils[suffix] for suffix, _n, class_key, _g in PUPILS if class_key == plan['key']],
        )

    progress_rows = 0
    for suffix, _name, class_key, _g in PUPILS:
        done, trailing = PROGRESS_PLAN[suffix]
        progress_rows += _state_progress(
            classes[class_key]['course'], classes[class_key]['lessons'], pupils[suffix], done, trailing
        )

    certified_class = next(
        class_key for suffix, _n, class_key, _g in PUPILS if suffix == CERTIFIED_PUPIL
    )
    certificate = _issue_certificate(
        classes[certified_class]['course'], teacher, pupils[CERTIFIED_PUPIL]
    )

    report = {
        'school': school.name,
        'classes': len(classes),
        'pupils': len(pupils),
        'minors': sum(1 for p in pupils.values() if p.profile.is_minor),
        'guardians': len(guardians),
        'lessons': sum(len(built['lessons']) for built in classes.values()),
        'exercises_filed': CourseItem.objects.filter(
            course__in=[built['course'] for built in classes.values()]
        ).count(),
        'progress_rows': progress_rows,
        'certificates': 1,
        'branch': branch.slug if branch else None,
    }
    # Last, so it sees the finished thing — every role this function handed out is in place by now,
    # and the caller's transaction means a refusal here leaves no school at all.
    report['containment'] = assert_contained(
        school, [built['course'] for built in classes.values()]
    )
    return {
        'head': head,
        'teacher': teacher,
        'guardians': guardians,
        'pupils': pupils,
        'school': school,
        'classes': classes,
        'certificate': certificate,
        'password': password,
        'report': report,
    }


def remove_school_demo() -> dict:
    """Undo: the two classes (everything hangs off them), the school, and every `school.*` account.

    The organisation links go with the courses they point at — `OrganizationLink` is a generic FK and
    so has no cascade of its own, which is why they are deleted by hand here. Getting that wrong
    leaves a link row pointing at a course id that no longer exists, and `_readable_links` would then
    drop it silently on every page: a tidy-looking leak rather than a visible one.
    """
    counts = {}
    courses = list(Course.objects.filter(instructor__username=TEACHER_USERNAME))
    course_ids = [course.pk for course in courses]
    counts['links'] = OrganizationLink.objects.filter(
        Q(content_type=ContentType.objects.get_for_model(Course), object_id__in=course_ids)
        | Q(organization__slug=SCHOOL_SLUG)
    ).delete()[0]
    counts['courses'] = Course.objects.filter(pk__in=course_ids).delete()[0]
    counts['organizations'] = Organization.objects.filter(slug=SCHOOL_SLUG).delete()[0]
    counts['accounts'] = User.objects.filter(username__startswith=PREFIX).delete()[0]
    return counts


#: Imported by the command's own output and by the test, so "who to sign in as" is written once.
WORTH_SIGNING_IN_AS = (
    (TEACHER_USERNAME, 'runs both classes — sees every pupil’s register and the guardian column'),
    (HEAD_USERNAME, 'owns the school on the platform; runs no class, so sees no register'),
    (PREFIX + 'pupil.01', 'the pupil who finished 2a — holds the one certificate'),
    (PREFIX + 'pupil.05', 'also finished 2a, no certificate yet — the teacher’s next click'),
    (PREFIX + 'pupil.06', 'stuck on the first lesson of 2a — refused a certificate, with the word'),
    (PREFIX + 'pupil.12', 'sixteen, so NOT a minor and has no guardian on the roster'),
    (PREFIX + 'guardian.01', 'answers for pupil.01 and pupil.02 (siblings)'),
)

