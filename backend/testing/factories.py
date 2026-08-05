"""Shared, plain-function fixture builders for this project's first real automated test suite
(CLAUDE.md Section 17I's own "Left open" note: no automated tests existed anywhere in this codebase
before this). Deliberately plain functions, not a factory_boy/model_bakery dependency — this project
has treated every runtime dependency as a real, flagged decision (frontend's own d3-force/fuse.js
notes), and these fixtures are simple enough (a handful of model fields, no complex relationships)
that a small shared module of plain functions covers it without adding a new package. Every app's own
`tests.py` imports from here rather than each re-deriving its own Field/Course/Exercise boilerplate.
"""

from django.contrib.auth import get_user_model

from exercises.models import Exercise, ExerciseTranslation
from taxonomy.models import Course, CourseTranslation, Field, FieldTranslation, Topic

User = get_user_model()


def make_user(username, *, is_staff=False, is_verified_contributor=False, password='testpass123'):
    """Every User gets a real Profile for free via accounts/signals.py's post_save receiver — no
    separate Profile creation needed here."""
    user = User.objects.create_user(username=username, password=password, is_staff=is_staff)
    if is_verified_contributor:
        user.profile.is_verified_contributor = True
        user.profile.save(update_fields=['is_verified_contributor'])
    return user


def make_viewer(username):
    """A bare User with no usable password — for fixtures that only ever need to EXIST as an FK
    target (e.g. simulating dozens of distinct viewers for moderation/models.py's ContentView) and
    are never authenticated as. `create_user`'s PBKDF2 password hashing is deliberately slow (it's
    meant to resist brute force); paying that cost for a user nothing ever logs in as measurably
    slows the suite down for no real benefit — a real, measured difference, not a guessed one."""
    return User.objects.create(username=username)


def make_course(slug='uw-test-course', field_slug='matematyka'):
    field, _ = Field.objects.get_or_create(slug=field_slug)
    FieldTranslation.objects.get_or_create(field=field, locale='pl', defaults={'name': field_slug})
    course, _ = Course.objects.get_or_create(
        slug=slug, defaults={'field': field, 'university': 'Test University'}
    )
    CourseTranslation.objects.get_or_create(course=course, locale='pl', defaults={'name': slug})
    return course


def make_topic(course, slug='test-topic'):
    topic, _ = Topic.objects.get_or_create(course=course, slug=slug)
    return topic


def make_exercise(course, number, *, difficulty='medium', locale='pl', title=None, statement=None):
    """Builds a real Exercise + its one 'published' ExerciseTranslation for the original locale —
    the same structural/translation split every real exercise in this app already follows
    (CLAUDE.md Section 9), not a shortcut fixture shape that skips it."""
    exercise = Exercise.objects.create(
        course=course, number=number, difficulty=difficulty, original_locale=locale
    )
    ExerciseTranslation.objects.create(
        exercise=exercise,
        locale=locale,
        title=title or f'Exercise {number}',
        statement=statement or f'Statement for exercise {number}.',
        status='published',
    )
    return exercise


def pdf_bytes(size: int) -> bytes:
    """A real, sniffable PDF of an EXACT byte length — for anything testing a byte quota, where the
    size has to be a number the test itself chose rather than whatever a fixture happened to weigh.

    The header is genuine and load-bearing: `materials/validators.py` sniffs the first few KB with
    libmagic and rejects anything whose real content doesn't match its extension, so padding alone
    (or a placeholder string) would be refused before any quota arithmetic was ever reached.
    Verified against the real validator rather than assumed — a `%PDF-1.4` header followed by
    filler still sniffs as `application/pdf` at every size these tests use.
    """
    header = b'%PDF-1.4\n'
    if size <= len(header):
        raise ValueError(f'a sniffable PDF needs at least {len(header) + 1} bytes')
    return header + b'0' * (size - len(header))


def make_material(course, slug='test-material', *, type='script', locale='pl', title=None, description=''):
    """`Material.file` just needs SOME stored path for tests — `FileField.url` builds a URL from
    `MEDIA_URL` + the stored name without ever checking the file exists on disk, and nothing in
    this suite downloads the actual bytes, so a bare string name (no real upload) is honest and
    sufficient here."""
    from materials.models import Material, MaterialTranslation

    material = Material.objects.create(course=course, slug=slug, type=type, file=f'materials/{slug}.pdf')
    MaterialTranslation.objects.create(
        material=material, locale=locale, title=title or slug, description=description
    )
    return material
