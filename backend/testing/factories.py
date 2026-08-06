"""Shared, plain-function fixture builders for this project's first real automated test suite
(CLAUDE.md Section 17I's own "Left open" note: no automated tests existed anywhere in this codebase
before this). Deliberately plain functions, not a factory_boy/model_bakery dependency — this project
has treated every runtime dependency as a real, flagged decision (frontend's own d3-force/fuse.js
notes), and these fixtures are simple enough (a handful of model fields, no complex relationships)
that a small shared module of plain functions covers it without adding a new package. Every app's own
`tests.py` imports from here rather than each re-deriving its own Discipline/Branch/Exercise boilerplate.
"""

from django.contrib.auth import get_user_model

from exercises.models import Exercise, ExerciseTranslation
from taxonomy.models import Branch, BranchTranslation, Discipline, DisciplineTranslation, Topic

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


def make_branch(slug='test-branch', discipline_slug='matematyka'):
    discipline, _ = Discipline.objects.get_or_create(slug=discipline_slug)
    DisciplineTranslation.objects.get_or_create(
        discipline=discipline, locale='pl', defaults={'name': discipline_slug}
    )
    branch, _ = Branch.objects.get_or_create(slug=slug, defaults={'discipline': discipline})
    BranchTranslation.objects.get_or_create(branch=branch, locale='pl', defaults={'name': slug})
    return branch


#: The old name, kept as an alias so the ~40 call sites across eight apps' tests keep working. A
#: branch is what they always actually wanted — none of them cared about the `university` this used
#: to set.
make_course = make_branch


def make_topic(branch, slug='test-topic'):
    topic, _ = Topic.objects.get_or_create(branch=branch, slug=slug)
    return topic


def make_exercise(branch, number, *, difficulty='medium', locale='pl', title=None, statement=None):
    """Builds a real Exercise + its one 'published' ExerciseTranslation for the original locale —
    the same structural/translation split every real exercise in this app already follows
    (CLAUDE.md Section 9), not a shortcut fixture shape that skips it."""
    exercise = Exercise.objects.create(
        branch=branch, number=number, difficulty=difficulty, original_locale=locale
    )
    ExerciseTranslation.objects.create(
        exercise=exercise,
        locale=locale,
        title=title or f'Exercise {number}',
        statement=statement or f'Statement for exercise {number}.',
        status='published',
    )
    return exercise


def make_material(branch, slug='test-material', *, type='script', locale='pl', title=None, description=''):
    """`Material.file` just needs SOME stored path for tests — `FileField.url` builds a URL from
    `MEDIA_URL` + the stored name without ever checking the file exists on disk, and nothing in
    this suite downloads the actual bytes, so a bare string name (no real upload) is honest and
    sufficient here."""
    from materials.models import Material, MaterialTranslation

    material = Material.objects.create(branch=branch, slug=slug, type=type, file=f'materials/{slug}.pdf')
    MaterialTranslation.objects.create(
        material=material, locale=locale, title=title or slug, description=description
    )
    return material
