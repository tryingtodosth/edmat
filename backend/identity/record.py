"""The learning record — what one account has SHARED about its results, and what it has DONE here.

`prompts/00-DESIGN.md` §1 rule 3 is the whole of this module, and it is one sentence: *an EdMat
activity count is never presented next to an institutional grade as if it were one.* So the record
is three blocks, computed separately, gated separately, and handed to the frontend as lists that
cannot be concatenated by accident:

* **grades** — `identity.CourseGrade` rows the registry attested, grouped by the
  `taxonomy.Branch` each one matched. Behind `share_grades` (and `share_school`, because a mark
  without the institution that gave it is not a claim about anything).
* **activity** — counts of what this person did on EdMat, grouped by the same `Branch`. Behind
  `share_activity`, which is its own consent and defaults to off.
* **placements** — what this person ACHIEVED in a contest somebody else ran: laureate, finalist,
  distinction, participant (`contests/record.py: placements_for`, CONTESTS-BRIEF.md §3.B, 2026-10-09).
  Behind the same `share_activity` consent, and that is the only one it could sit behind: it is not
  an institutional grade, so it must not borrow the grades' gate and read as one.

  **Why it is a third block and not a third column.** A placement is not per-branch and not a count.
  "Laureate of the Mazovian mathematics konkurs, 14 March" is a named, dated result about one
  contest — rows the grades block cannot hold (nobody awarded a mark) and the activity block cannot
  hold either (its cells are integers per subject, and a title is not a number). Folding it into
  either is exactly the mistake rule 3 is about, one step further out: a laureate title drawn in the
  grades table would read as a mark an institution gave, and drawn in the activity table it would
  read as something this site measured. Neither is true — the ORGANISER awarded it and EdMat was
  the medium (`LEGAL.md`, "Contests").

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

**Providers.** `sets_by_branch` lives here because `study` had nothing to hand and this module
owns neither that app's schema nor anybody else's. Everything that measures its own app keeps the
provider in the app that owns the rows (`prompts/README.md` §5 rule 13) and `identity/apps.py:
ready()` registers it:

    # courses/record.py, flashcards/record.py — registered in identity/apps.py: ready()
    from identity.record import register_activity_provider
    register_activity_provider(activity_by_branch)

That is the shape, and `lessons_done` is why it is the shape. This module used to carry a second
implementation of that metric — a read-across into `courses.models`, written on a branch that
could not see `courses.record.activity_by_branch` — and `_activity_block` SUMS across providers,
so the two of them together doubled every number on every profile. It was deleted on 2026-10-06
(owner decision, `prompts/11-closing-design.md` §2); the survivor is the one in the app that owns
`LessonProgress`, and this module no longer imports `courses` at all.

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

#: Every registered source of per-branch activity counts. `sets_by_branch` is registered below, at
#: the bottom of this module; `courses`, `flashcards` and anything later keep their provider in
#: their own app and are registered by `identity/apps.py: ready()`, so this module imports no app
#: that might not be installed.
ACTIVITY_PROVIDERS: list[Callable[[object], dict[int, dict[str, int]]]] = []

#: Every registered source of PLACEMENT rows — a result somebody was awarded in something they took
#: part in. One list rather than a second kind of entry in `ACTIVITY_PROVIDERS`, because the shape is
#: different: a placement provider answers with a LIST of named, dated results, not a dict of counts
#: per branch, and a registry whose members answer two shapes is a registry every reader has to
#: type-check at the call site.
#:
#: A provider is `Callable[[User], list[dict]]` and each dict carries `contest_id`, `title`,
#: `result_title` and `published_at` (`contests/record.py: placements_for`, the shape fixed in
#: advance by CONTESTS-BRIEF.md §3.B). `_placements_block` passes them through unchanged apart from
#: sorting: this module does not know what a laureate is and should not learn.
PLACEMENT_PROVIDERS: list[Callable[[object], list[dict]]] = []


def register_placement_provider(fn: Callable[[object], list[dict]]) -> None:
    """Add a source of placement rows, idempotently — `register_activity_provider`'s reasoning
    exactly, and for the same reason: `AppConfig.ready()` can run more than once in one process, and
    a provider registered twice would list every result twice."""
    if fn not in PLACEMENT_PROVIDERS:
        PLACEMENT_PROVIDERS.append(fn)


def register_activity_provider(fn: Callable[[object], dict[int, dict[str, int]]]) -> None:
    """Add a per-branch activity source, idempotently.

    Idempotent because `AppConfig.ready()` can run more than once in one process (the autoreloader,
    and a test that reloads an app registry), and a provider counted twice would double every number
    it contributes — a wrong count that looks exactly like real data.
    """
    if fn not in ACTIVITY_PROVIDERS:
        ACTIVITY_PROVIDERS.append(fn)


# -- the one provider this module owns -------------------------------------------------------------


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


def _placements_block(user) -> list[dict]:
    """What this person was awarded in contests, newest first.

    Every registered provider is asked and their rows concatenated. A provider that raises is **not**
    caught here: unlike the work dashboard, which has a documented `unavailable` list for exactly
    that, this function's caller is a profile page with nowhere to say "one source is down", and a
    silently short list of somebody's results is a worse answer than an error somebody notices.

    `published_at` sorts descending with the undated last — a result with no date is one step A has
    not published yet, and it belongs at the bottom rather than at the top where a missing value
    would otherwise put it.
    """
    rows: list[dict] = []
    for provider in PLACEMENT_PROVIDERS:
        rows.extend(provider(user) or [])
    # One sort, descending on an ISO string: dated rows come newest first and an undated one sorts
    # to the end, because `''` is smaller than every timestamp. The dates arrive as ISO strings from
    # the provider, which is why this compares them as strings rather than parsing them.
    rows.sort(key=lambda row: row.get('published_at') or '', reverse=True)
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
    placements = None
    if not minor and profile is not None:
        if profile.share_school and profile.share_grades:
            grades = _grades_block(profile, locale)
        if profile.share_activity:
            activity = _activity_block(profile_user, locale)
            # The same consent, deliberately: both blocks answer "what has this person done here",
            # and asking somebody to tick a second box for the half of that answer that happens to
            # have titles in it would be a setting nobody could explain.
            placements = _placements_block(profile_user)

    if grades is None and activity is None and placements is None and not is_owner:
        return None

    return {
        'is_owner': is_owner,
        # House rule 6: a refusal carries its reason. 'minor' and "they simply have not consented"
        # are the same empty section to a boolean and two completely different things to the person
        # reading their own profile.
        'withheld_reason': 'minor' if minor else None,
        'grades': grades,
        'activity': activity,
        'placements': placements,
    }


register_activity_provider(sets_by_branch)
