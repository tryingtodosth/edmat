"""The learning record — what one account has SHARED about its results, and what it has DONE here.

`prompts/00-DESIGN.md` §1 rule 3 is the whole of this module, and it is one sentence: *an EdMat
activity count is never presented next to an institutional grade as if it were one.* So the record
is two blocks, computed separately, gated separately, and handed to the frontend as two lists that
cannot be concatenated by accident:

* **grades** — `identity.CourseGrade` rows the registry attested, grouped by the
  `taxonomy.Branch` each one matched. Behind `share_grades` (and `share_school`, because a mark
  without the institution that gave it is not a claim about anything).
* **activity** — counts of what this person did on EdMat, grouped by the same `Branch`. Behind
  `share_activity`, which is its own consent and defaults to off.

`taxonomy.Branch` is the hub that makes one table honest (§1 rule 1): "3.5 in Analiza
Matematyczna" and "5 sets built in Analiza Matematyczna" are two different kinds of fact about the
same corner of the curriculum, and putting them in two blocks of one per-branch table says exactly
that — where a single column headed "score" would have lied.

**Why this is not inside `standing.public_view`.** That function answers "how much of this person's
institutional record may a stranger see", and it is the three education consents, itemised. A count
of flashcard reviews is not an institutional record and must not inherit that function's shape, its
caller or its gate. The two sit side by side and the profile page draws them as two sections.

**Counts are recounted on every read** (house rule 5). Two `COUNT`s over an indexed FK are cheap
and a recount cannot drift; a stored counter that misses one write path is wrong forever. The
honest limit: a provider is free to be as slow as its own data, and nothing here caches, so a
profile with thousands of rows pays for them on every view. Named rather than pre-optimised.

**Providers.** `sets_by_branch` and `lessons_done_by_branch` live here because `study` and
`courses` had nothing to hand and this step owns neither app's schema. Anything that measures its
own app registers itself instead:

    # flashcards/record.py, registered by the integrator at app-ready time
    from identity.record import register_activity_provider
    register_activity_provider(activity_by_branch)

A provider is `Callable[[User], dict[int, dict[str, int]]]` — branch id to metric name to count —
and may answer with any metric key it likes; the union of what every provider returned is filled
with zeros so one table has one set of columns. `METRIC_KEYS` is this cycle's three, declared so
the shape is stable before `flashcards` exists (`cards_reviewed` reads 0 everywhere until step A
is merged and registered) and so `frontend/src/lib/utils/labels.ts` has something to mirror —
which it does, under a comment naming this module (house rule 13).
"""

from __future__ import annotations

from typing import Callable

from accounts.minors import is_minor
from config.i18n_utils import DEFAULT_FALLBACK_LOCALE, resolve_translation

from .models import EducationProfile, weighted_average

#: The metrics this cycle's record draws, in the order the table shows them. A mirror of this list
#: lives in `frontend/src/lib/utils/labels.ts` as `LEARNING_RECORD_METRICS` (house rule 13: said in
#: both files). A provider may answer with a key not in here; it is added to the table rather than
#: dropped, because silently discarding somebody's measurement is worse than an unlabelled column.
METRIC_KEYS: tuple[str, ...] = ('sets', 'lessons_done', 'cards_reviewed')

#: Every registered source of per-branch activity counts. `sets_by_branch` and
#: `lessons_done_by_branch` are registered below, at the bottom of this module; `flashcards` and
#: anything later registers its own at app-ready time, so this module imports no app that might not
#: be installed.
ACTIVITY_PROVIDERS: list[Callable[[object], dict[int, dict[str, int]]]] = []


def register_activity_provider(fn: Callable[[object], dict[int, dict[str, int]]]) -> None:
    """Add a per-branch activity source, idempotently.

    Idempotent because `AppConfig.ready()` can run more than once in one process (the autoreloader,
    and a test that reloads an app registry), and a provider counted twice would double every number
    it contributes — a wrong count that looks exactly like real data.
    """
    if fn not in ACTIVITY_PROVIDERS:
        ACTIVITY_PROVIDERS.append(fn)


# -- the two providers this step owns --------------------------------------------------------------


def sets_by_branch(user) -> dict[int, dict[str, int]]:
    """How many of this person's study sets touch each branch.

    A set is counted once per branch it contains an exercise from, so a set spanning two branches
    counts in both and never as two sets in one. Summing the column would therefore over-count, and
    nothing does: each cell answers "how many of their sets involve this branch", which is the
    question somebody reading a profile is actually asking.

    `Exercise.branch` is a direct FK (`exercises/models.py`) — there is no topic model in between —
    so this is one join and one distinct pair, not a walk.
    """
    from study.models import ExerciseSetItem

    # `.order_by()` with no arguments is load-bearing, not tidying. `ExerciseSetItem.Meta.ordering`
    # is `['order']`, and Django adds every ordering column to the SELECT list of a `distinct()`
    # query — so the DISTINCT was over (set, branch, order) and counted one set once per item in it.
    # It read 21 sets for an account with five, which is the kind of wrong number that looks like
    # real data until somebody counts by hand.
    pairs = (
        ExerciseSetItem.objects.filter(exercise_set__owner=user)
        .order_by()
        .values_list('exercise_set_id', 'exercise__branch_id')
        .distinct()
    )
    counts: dict[int, dict[str, int]] = {}
    for _set_id, branch_id in pairs:
        if branch_id is None:
            continue
        bucket = counts.setdefault(branch_id, {})
        bucket['sets'] = bucket.get('sets', 0) + 1
    return counts


def lessons_done_by_branch(user) -> dict[int, dict[str, int]]:
    """Lessons this person SAID they finished, per branch of the course that holds them.

    `courses.LessonProgress` is a statement, never a measurement (its own docstring says so at
    length), and this count inherits that: it is "lessons they marked done", which is why the label
    beside it in both catalogues says *said they finished* rather than *completed*.

    READ-ONLY over `courses` — learning step C owns that app this cycle, so nothing here writes to
    it, imports at module level, or assumes a field it does not already have. The branch comes from
    `Course.subjects`, the course's own taxonomy links; a course with no subject contributes to no
    branch at all, and is simply not counted rather than being filed under a guess.

    Course-level visibility (`Course.progress_visibility`) is deliberately NOT consulted. That
    setting decides who may see one course's roster progress; this is the person's own statement
    about themselves, published by their own `share_activity` consent, and aggregated to a branch so
    that no individual lesson of anybody's course is identifiable from it.
    """
    from courses.models import LessonProgress

    # `.order_by()` for the same reason as `sets_by_branch`: `LessonProgress.Meta.ordering` is
    # `['-updated_at']`, which a `distinct()` would pull into the SELECT and so defeat.
    pairs = (
        LessonProgress.objects.filter(participant=user, status='done')
        .order_by()
        .values_list('pk', 'lesson__chapter__course__subjects')
        .distinct()
    )
    counts: dict[int, dict[str, int]] = {}
    for _progress_id, branch_id in pairs:
        if branch_id is None:
            continue
        bucket = counts.setdefault(branch_id, {})
        bucket['lessons_done'] = bucket.get('lessons_done', 0) + 1
    return counts


# -- the record ------------------------------------------------------------------------------------


def _branch_ref(branch, locale: str) -> dict:
    """A branch as the record names it: the slug the URL uses, and the title in the reader's own
    interface language, resolved the way every taxonomy serializer resolves one."""
    translation = resolve_translation(branch.translations, locale)
    return {'slug': branch.slug, 'title': translation.name if translation else branch.slug}


def _grades_block(profile: EducationProfile, locale: str) -> list[dict]:
    """Shared institutional results, one row per branch.

    Only grades that actually matched a `taxonomy.Branch` are placed — the same conservative rule
    `standing.skill_seeds_for` follows, and for the same reason: an unmatched result is still a real
    result, just not one this site can put anywhere, and inventing a placement for it would be worse
    than leaving it out. The count says how many results back each row, so a branch resting on one
    mark does not read like a branch resting on five.

    The average is `weighted_average` over that branch's own subset — ECTS-weighted, and `None`
    outright for a branch mixing grading scales, because there is no honest way to fold an ECTS
    letter into the Polish 2–5 scale. Reusing that function rather than re-deriving it is what keeps
    this figure and the transcript's own from disagreeing on one screen.
    """
    by_branch: dict[int, list] = {}
    branches: dict[int, object] = {}
    for grade in profile.grades.select_related('matched_course').all():
        branch = grade.matched_course
        if branch is None:
            continue
        branches[branch.pk] = branch
        by_branch.setdefault(branch.pk, []).append(grade)

    rows = [
        {
            'branch': _branch_ref(branches[branch_id], locale),
            'average': weighted_average(grades),
            'count': len(grades),
        }
        for branch_id, grades in by_branch.items()
    ]
    rows.sort(key=lambda row: row['branch']['title'].lower())
    return rows


def _activity_block(user, locale: str) -> list[dict]:
    """EdMat's own record of this person, one row per branch, counts only.

    Every provider is asked, their answers merged, and the union of metric keys filled with zeros so
    the table has one set of columns rather than a ragged one. A branch with nothing but zeros is
    dropped: a row of noughts tells a reader nothing and makes the two-block table longer than the
    thing it is describing.
    """
    from taxonomy.models import Branch

    merged: dict[int, dict[str, int]] = {}
    for provider in ACTIVITY_PROVIDERS:
        for branch_id, metrics in provider(user).items():
            bucket = merged.setdefault(branch_id, {})
            for key, count in metrics.items():
                bucket[key] = bucket.get(key, 0) + int(count)

    keys = list(METRIC_KEYS) + [
        key for metrics in merged.values() for key in metrics if key not in METRIC_KEYS
    ]
    # dict.fromkeys rather than a set: the column order has to be the same on every read, and a set
    # does not promise one.
    keys = list(dict.fromkeys(keys))

    branches = {b.pk: b for b in Branch.objects.filter(pk__in=merged).prefetch_related('translations')}
    rows = []
    for branch_id, metrics in merged.items():
        branch = branches.get(branch_id)
        if branch is None:
            # A branch deleted between the count and this lookup. Dropped rather than rendered as a
            # blank row, which is the one thing a reader would read as a bug.
            continue
        row = {'branch': _branch_ref(branch, locale)}
        row.update({key: int(metrics.get(key, 0)) for key in keys})
        if all(row[key] == 0 for key in keys):
            continue
        rows.append(row)
    rows.sort(key=lambda row: row['branch']['title'].lower())
    return rows


def learning_record(profile_user, viewer=None, *, locale: str = DEFAULT_FALLBACK_LOCALE) -> dict | None:
    """The whole record for one account, as much of it as consent allows this viewer to see.

    Returns `None` when there is nothing to show a stranger — not an empty object, so the profile
    renders no section at all rather than a heading that implies something is being withheld. The
    endpoint hands that `None` through as a `null` body and NOT a 404: the profile exists and is
    perfectly reachable; it is the record that is withheld, and those are different answers.

    `viewer` never widens anything. Every gate below reads the profile owner's own consent and
    nothing about who is asking; the argument exists so that the account holder looking at their own
    profile gets the record back even when both blocks are withheld, with `is_owner` set, and can
    therefore be told *this is what other people see* — which for an unshared record is "nothing".
    Without that, the one person who needs to know their consents are off would be the one person
    shown no section.

    **A minor's record is never public, whatever the consents say.** `accounts/minors.py` is the one
    module that decides what a minor's account may do, and "no public profile" is in its docstring;
    a learning record is a public profile section, so it is withheld and `withheld_reason` says why.
    The flags are not silently rewritten — a guardian may have set them, the account may stop being a
    minor's, and un-ticking somebody's consent behind their back would be its own small dishonesty.
    """
    is_owner = bool(
        viewer is not None
        and getattr(viewer, 'is_authenticated', False)
        and viewer.pk == profile_user.pk
    )
    minor = is_minor(profile_user)
    profile = EducationProfile.objects.filter(user=profile_user).first()

    grades = None
    activity = None
    if not minor and profile is not None:
        if profile.share_school and profile.share_grades:
            grades = _grades_block(profile, locale)
        if profile.share_activity:
            activity = _activity_block(profile_user, locale)

    if grades is None and activity is None and not is_owner:
        return None

    return {
        'is_owner': is_owner,
        # House rule 6: a refusal carries its reason. 'minor' and "they simply have not consented"
        # are the same empty section to a boolean and two completely different things to the person
        # reading their own profile.
        'withheld_reason': 'minor' if minor else None,
        'grades': grades,
        'activity': activity,
    }


register_activity_provider(sets_by_branch)
register_activity_provider(lessons_done_by_branch)
