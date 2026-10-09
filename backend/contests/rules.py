"""Every rule `contests` asks, in one module (root `CLAUDE.md`, boundary 2). The endpoints ask
this module and nothing re-implements a word of it; `access.py` answers "may this person see it",
`config/nodes.py` answers the node side, and `presets.py` is data this module reads.

**Every refusal is a word, never a boolean** (house rule 6) and the frontend has one sentence for
each in `CONTEST_BLOCK_LABELS`. "This contest is full" and "the organiser disqualified you" are the
same `False` and two completely different things to be told.

**A stranger never reaches a refusal.** `access.visible_contests` has already answered 404 for
anything they cannot see (house rule 4), and every single-object action asks `access` explicitly
before it asks this module, because a queryset filter never runs for a request that arrives with an
id in the URL.

## The four things this module is the only writer of

1. **`advance(stage)`** — who goes on. `ContestSubmission.advanced` is written here and nowhere
   else, which is what makes "you advanced" a decision taken once by a published rule rather than a
   recomputation that can change under somebody.
2. **`publish_results` / `unpublish_results`** — `ContestResult` rows exist only between them.
3. **`transition`** — `Contest.status` and the three timestamps that go with it.
4. **`set_scores`** — nothing else writes a `ContestScore`.

Everything else is read: `ranking` recounts, `titles_for` derives, and no total is ever stored
(house rule 5).

## The one rule that is structural rather than a refusal

A draw is impossible here. There is no `draw` advancement, no tie-break by lot — ties share a rank
and the organiser breaks them on merit in the regulamin — and `chance_element` refuses an announce
whose stage descriptions or merit criteria read like a *losowanie*. Chance deciding ANY stage makes
the whole thing a *gra losowa* needing a permit, and u.g.h. art. 89's administrative penalty stacks
with KKS art. 108's 240 *stawki dzienne* (CONTESTS-LAW.md §2).
"""

from __future__ import annotations

import re

from django.db import transaction
from django.utils import timezone

from accounts.minors import is_minor

from . import access, presets
from .models import (
    COMPETING_STATUSES,
    PLACE_HOLDING_STATUSES,
    REGISTRABLE_STATUSES,
    TRANSITION_STAMPS,
    TRANSITIONS,
    ContestResult,
    ContestScore,
    ContestSubmission,
)

# ---- the words -----------------------------------------------------------------------------------
# Constants rather than literals at the call sites: a rename is one edit, a typo is an ImportError
# rather than a refusal nobody has a sentence for, and `labels.ts` has a line for each
# (house rule 13 — said in both files).

# announce_block_reason
CLAIM_DEADLINE_MISSING = 'claim_deadline_missing'
JURY_MISSING = 'jury_missing'
CRITERIA_MISSING = 'criteria_missing'
CONTROLLER_MISSING = 'controller_missing'
EXTERNAL_REFERENCE_MISSING = 'external_reference_missing'
NO_STAGES = 'no_stages'
CHANCE_ELEMENT = 'chance_element'
RULES_MISSING = 'rules_missing'

# transition_block_reason
ILLEGAL_TRANSITION = 'illegal_transition'
CLOSED = 'closed'

# register_block_reason
ANONYMOUS = 'anonymous'
NOT_OPEN = 'not_open'
OWN_STAFF = 'own_staff'
MINOR = 'minor'
GUARDIAN_CONSENT_REQUIRED = 'guardian_consent_required'
ALREADY_REGISTERED = 'already_registered'
FULL = 'full'
TEAM_REQUIRED = 'team_required'

# submit_block_reason
STAGE_NOT_OPEN = 'stage_not_open'
NOT_ACCEPTED = 'not_accepted'
ALREADY_SUBMITTED = 'already_submitted'
NOT_ADVANCED = 'not_advanced'

# score_block_reason
NOT_JUROR = 'not_juror'
STAGE_OPEN = 'stage_open'
OWN_SUBMISSION = 'own_submission'

# publish_results_block_reason / unpublish
STAGE_UNSCORED = 'stage_unscored'
ALREADY_PUBLISHED = 'already_published'
NOT_PUBLISHED = 'not_published'
WINDOW_CLOSED = 'window_closed'

# complain_block_reason
NOT_PARTICIPANT = 'not_participant'
ALREADY_OPEN = 'already_open'

# authority, never reached by a participant
NOT_MANAGER = 'not_manager'
NOT_STAFF = 'not_staff'
LAST_ORGANISER = 'last_organiser'

#: Words in an organiser's own text that mean a draw. Matched on the stem, case-folded, after
#: Polish diacritics are stripped, because *losowanie / losowany / wylosowano / loteria* are all the
#: same refusal and an organiser typing "losowanie" without the diacritic meant exactly the same
#: thing. Deliberately a small, explicit list rather than a clever regex: a false positive here
#: blocks a real announce, so every stem is one somebody can read and argue with.
CHANCE_STEMS = ('losowan', 'losuj', 'wylosow', 'rozlosow', 'loteri', 'przypadkow', 'random', 'lottery')

_DIACRITICS = str.maketrans('ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ')


def _looks_like_a_draw(text: str) -> bool:
    if not text:
        return False
    flat = re.sub(r'<[^>]+>', ' ', text).translate(_DIACRITICS).lower()
    return any(stem in flat for stem in CHANCE_STEMS)


# ---- announcing ----------------------------------------------------------------------------------


def announce_block_reason(contest) -> str | None:
    """Why this contest may not be announced — or `None`.

    The order is the order an organiser can act on (house rule 6): the thing that makes the whole
    promise ineffective first, then the people, then the words, then the paperwork.

    A `challenge` — no prize — reaches none of the prize words at all. That is the design decision
    §1 of `CONTESTS-BRIEF.md` records: adding a prize is what UNLOCKS the obligations, so a
    prize-free contest announces with no prize block, no claim deadline and no tax copy.
    """
    if contest.status != 'draft':
        # Announcing something already announced is not a missing field, it is the world having
        # moved (409) — `transition_block_reason` is the one that says so.
        return ILLEGAL_TRANSITION

    preset = presets.get(contest.preset_key)

    if contest.has_prize and contest.prize_claim_deadline is None:
        # KC art. 921 §1: without it the promise is *bezskuteczne*. The single hardest field here.
        return CLAIM_DEADLINE_MISSING

    jury_min = preset.jury_min if preset else 1
    if _jury_size(contest) < jury_min:
        return JURY_MISSING

    if not _has_text(contest.merit_criteria):
        # Published criteria are what keeps this out of the lottery regime (u.g.h. art. 2).
        return CRITERIA_MISSING

    if not contest.stages.exists():
        return NO_STAGES

    if _looks_like_a_draw(contest.merit_criteria) or any(
        _looks_like_a_draw(stage.description) for stage in contest.stages.all()
    ):
        return CHANCE_ELEMENT

    if not (_has_text(contest.data_controller_name) and _has_text(contest.data_controller_contact)):
        # GDPR art. 13: the controller is named before anybody enters. EdMat is the processor and
        # never the controller, so this cannot be defaulted to the site (LEGAL.md).
        return CONTROLLER_MISSING

    if preset and preset.external_reference_required and not contest.external_reference_url:
        return EXTERNAL_REFERENCE_MISSING

    if contest.rules_version < 1:
        # KC art. 384: available before entry, storable. A regulamin nobody can read is not one.
        return RULES_MISSING

    return None


def _jury_size(contest) -> int:
    """The organiser counts: KC art. 921 §2 makes the organiser the judge by default, and a jury
    exists only because the regulamin creates one — so a one-person `challenge` is lawful and this
    must not refuse it. Everybody with the `jury` role counts too."""
    jurors = {contest.organiser_id}
    jurors.update(contest.staff.filter(role='jury').values_list('user_id', flat=True))
    return len(jurors)


def _has_text(value: str | None) -> bool:
    return bool(value and re.sub(r'<[^>]+>', '', value).strip())


# ---- the lifecycle -------------------------------------------------------------------------------


def transition_block_reason(contest, to: str) -> str | None:
    """Why this contest may not move to `to` — or `None`. `models.TRANSITIONS` is the table and
    this is its only reader."""
    if to == contest.status:
        return ILLEGAL_TRANSITION
    if contest.status == 'closed':
        return CLOSED
    allowed = TRANSITIONS.get(contest.status, ())
    if to not in allowed:
        return ILLEGAL_TRANSITION
    if to == 'announced':
        return announce_block_reason(contest)
    if to == 'results_published':
        return publish_results_block_reason(contest)
    return None


def transition(contest, to: str, *, actor=None):
    """Move it, stamping the timestamp the move earns. The ONLY writer of `Contest.status`.

    `results_published` goes through `publish_results` rather than here, because it has rows to
    write as well as a status; this function refuses to be the second way of doing that.
    """
    assert to != 'results_published', 'use publish_results'
    now = timezone.now()
    contest.status = to
    fields = ['status', 'updated_at']
    stamp = TRANSITION_STAMPS.get(to)
    if stamp and getattr(contest, stamp) is None:
        setattr(contest, stamp, now)
        fields.append(stamp)
    if to == 'announced' and contest.visibility == 'private':
        # Announcing is the act of telling strangers. A contest that is announced and still private
        # is a real state (the prep's own test pins it) but it is never what an organiser pressing
        # "Announce" meant, so the two axes are set together here and separately editable after.
        contest.visibility = 'public'
        fields.append('visibility')
    contest.save(update_fields=fields)
    return contest


# ---- registering ---------------------------------------------------------------------------------


def register_block_reason(user, contest, payload: dict | None = None) -> str | None:
    """Why this person may not register — or `None`.

    `payload` is the registration request, because two of the words depend on it: a minor whose
    request carries no guardian consent gets `guardian_consent_required` (a different sentence from
    `minor`, which means "this contest does not take anybody your age at all"), and a team contest
    with no team name gets `team_required`. Called with no payload — from a page deciding whether to
    draw the button — those two are not consulted.
    """
    payload = payload or {}
    if not (user and getattr(user, 'is_authenticated', False)):
        return ANONYMOUS
    if contest.status not in REGISTRABLE_STATUSES:
        return NOT_OPEN
    if access.is_staff(user, contest):
        # Running it and competing in it are the same person deciding who wins.
        return OWN_STAFF
    existing = contest.registrations.filter(user=user).first()
    if existing is not None and existing.holds_a_place:
        return ALREADY_REGISTERED
    if is_minor(user):
        if not contest.allows_minors:
            return MINOR
        if not (payload.get('guardian_consent') and str(payload.get('guardian_name', '')).strip()):
            # KC art. 15/17 and GDPR art. 8: the consent is the guardian's, and it is recorded with
            # a name so it can be shown to somebody later. A bare boolean cannot be.
            return GUARDIAN_CONSENT_REQUIRED
    if contest.capacity:
        taken = contest.registrations.filter(status__in=PLACE_HOLDING_STATUSES).count()
        if taken >= contest.capacity:
            return FULL
    if contest.team and not str(payload.get('team_name', '')).strip():
        return TEAM_REQUIRED
    return None


# ---- answering -----------------------------------------------------------------------------------


def submit_block_reason(user, stage) -> str | None:
    """Why this person may not work on this stage — or `None`.

    `not_advanced` is the fourth word and is the other half of `advance`: from the second stage on,
    a place is held by having advanced from the one before, and a participant who did not is told
    that rather than "not accepted", which would be false.
    """
    contest = stage.contest
    if not (user and getattr(user, 'is_authenticated', False)):
        return ANONYMOUS
    if stage.status != 'open':
        return STAGE_NOT_OPEN
    registration = contest.registrations.filter(user=user).first()
    if registration is None or not registration.is_competing:
        return NOT_ACCEPTED
    previous = contest.stages.filter(order__lt=stage.order).order_by('-order').first()
    if previous is not None:
        if not ContestSubmission.objects.filter(
            stage=previous, registration=registration, advanced=True
        ).exists():
            return NOT_ADVANCED
    submission = ContestSubmission.objects.filter(stage=stage, registration=registration).first()
    if submission is not None and submission.status != 'draft':
        return ALREADY_SUBMITTED
    return None


# ---- scoring -------------------------------------------------------------------------------------


def score_block_reason(user, submission) -> str | None:
    """Why this person may not score this submission — or `None`.

    Scoring starts when the stage CLOSES. That is not fussiness: a juror who can see answers while
    the stage is open can also tell a participant how they are doing, and a contest whose jury
    scores a moving target cannot say its ranking came from the published criteria.
    """
    stage = submission.stage
    contest = stage.contest
    if not access.can_score(user, contest):
        return NOT_JUROR
    if stage.status == 'open' or stage.status == 'scheduled':
        return STAGE_OPEN
    if submission.registration.user_id == getattr(user, 'pk', None):
        return OWN_SUBMISSION
    return None


def set_scores(user, submission, rows: list[dict]):
    """Write one juror's cells for one submission. The only writer of `ContestScore`.

    `rows` is `[{problem: id, points: float, note: str}]`. A cell is updated in place rather than
    appended to, because the unique constraint is (submission, problem, juror): a juror has one
    opinion per problem and changing it is an edit, not a second score.
    """
    written = []
    problems = {p.pk: p for p in submission.stage.problems.all()}
    for row in rows:
        problem = problems.get(int(row['problem']))
        if problem is None:
            continue
        points = max(0.0, min(float(row.get('points') or 0), float(problem.points)))
        score, _ = ContestScore.objects.update_or_create(
            submission=submission,
            problem=problem,
            juror=user,
            defaults={'points': points, 'note': row.get('note') or ''},
        )
        written.append(score)
    return written


def submission_points(submission) -> float:
    """The MEAN over the jurors who scored each problem, summed over problems. Recounted, never
    stored (house rule 5).

    The honest limit, stated rather than hidden: a problem no juror has scored contributes zero, so
    a half-scored submission reads low rather than unknown. `scored_problem_count` beside it is how
    the matrix and the ranking preview say which is which.
    """
    by_problem: dict[int, list[float]] = {}
    for score in submission.scores.all():
        by_problem.setdefault(score.problem_id, []).append(score.points)
    return float(sum(sum(v) / len(v) for v in by_problem.values() if v))


def scored_problem_count(submission) -> int:
    return len({score.problem_id for score in submission.scores.all()})


def stage_is_fully_scored(stage) -> bool:
    """Every handed-in submission has at least one score on every problem. What
    `publish_results_block_reason` means by `stage_unscored`, and what `advance` requires."""
    problem_ids = set(stage.problems.values_list('pk', flat=True))
    if not problem_ids:
        # A stage with no problems has nothing to score, and refusing to publish because of it
        # would strand a contest whose on-site final was marked on paper.
        return True
    for submission in stage.submissions.filter(status__in=('submitted', 'scored')).prefetch_related(
        'scores'
    ):
        if {s.problem_id for s in submission.scores.all()} != problem_ids:
            return False
    return True


# ---- advancing -----------------------------------------------------------------------------------


def advance_block_reason(stage) -> str | None:
    if stage.status in ('scheduled', 'open'):
        return STAGE_OPEN
    if not stage_is_fully_scored(stage):
        return STAGE_UNSCORED
    return None


def advance(stage):
    """Compute who goes on, and write it. **The only writer of `ContestSubmission.advanced`.**

    `all` — everybody who handed in; `top_n` — the best `advance_count` by points, ties included
    (a tie at the cut-off takes everybody tied, because the alternative is breaking it by lot and
    that is the one thing this module makes impossible); `threshold` — at or above
    `advance_threshold`; `final` — nobody.

    Returns the list of advancing submissions. Idempotent: running it again on an unchanged stage
    writes the same answer, which is what makes "re-score and advance again" a safe thing to do
    before results are published.
    """
    handed_in = list(
        stage.submissions.filter(status__in=('submitted', 'scored'))
        .select_related('registration__user')
        .prefetch_related('scores')
    )
    scored = sorted(
        ((s, submission_points(s)) for s in handed_in), key=lambda pair: -pair[1]
    )
    if stage.advancement == 'final':
        chosen: list = []
    elif stage.advancement == 'all':
        chosen = [s for s, _ in scored]
    elif stage.advancement == 'threshold':
        floor = stage.advance_threshold or 0
        chosen = [s for s, points in scored if points >= floor]
    elif stage.advancement == 'top_n':
        count = stage.advance_count or 0
        if count <= 0 or not scored:
            chosen = []
        else:
            cutoff = scored[min(count, len(scored)) - 1][1]
            chosen = [s for s, points in scored if points >= cutoff]
    else:  # pragma: no cover - `ADVANCEMENT_CHOICES` is closed and validated at the serializer
        chosen = []

    chosen_ids = {s.pk for s in chosen}
    with transaction.atomic():
        # Two WHERE-anchored updates on one table rather than a row-by-row save: SQLite's single
        # writer makes the loop the slow and lock-prone shape (`backend/CLAUDE.md` rule 2).
        stage.submissions.filter(pk__in=chosen_ids).update(advanced=True, status='scored')
        stage.submissions.exclude(pk__in=chosen_ids).update(advanced=False)
        stage.submissions.filter(status='submitted').update(status='scored')
        stage.status = 'scored'
        stage.advanced_at = timezone.now()
        stage.save(update_fields=['status', 'advanced_at'])
    return chosen


# ---- the ranking, and the titles -----------------------------------------------------------------


def ranking(contest) -> list[dict]:
    """The live ranking: every competing registration, its points summed over every stage, ordered.

    An ordered RECOUNT, every time (house rule 5). Ties share a rank — the next rank then skips, so
    two firsts are followed by a third — because a tie broken by anything other than merit is the
    draw this module refuses, and merit tie-breaking is the organiser's job in the regulamin.
    """
    rows: list[dict] = []
    registrations = list(
        contest.registrations.filter(status__in=COMPETING_STATUSES).select_related('user__profile')
    )
    submissions = list(
        ContestSubmission.objects.filter(stage__contest=contest)
        .select_related('stage')
        .prefetch_related('scores')
    )
    by_registration: dict[int, list] = {}
    for submission in submissions:
        by_registration.setdefault(submission.registration_id, []).append(submission)
    max_points = float(sum(stage.max_points for stage in contest.stages.prefetch_related('problems')))
    for registration in registrations:
        mine = by_registration.get(registration.pk, [])
        total = float(sum(submission_points(s) for s in mine))
        rows.append({
            'registration': registration,
            'total_points': round(total, 3),
            'max_points': round(max_points, 3),
            'stages_entered': len([s for s in mine if s.status != 'draft']),
        })
    rows.sort(key=lambda row: (-row['total_points'], row['registration'].created_at, row['registration'].pk))
    rank = 0
    previous = None
    for index, row in enumerate(rows, start=1):
        if row['total_points'] != previous:
            rank = index
            previous = row['total_points']
        row['rank'] = rank
    return rows


def titles_for(rows: list[dict], contest) -> list[dict]:
    """Assign laureate / finalist / distinction by the organiser's own thresholds.

    The thresholds are percentages of the maximum, on the `Contest` row, because "laureate" means
    whatever this contest's regulamin says it means — there is no site-wide definition and inventing
    one would make EdMat the judge, which it never is (CONTESTS-BRIEF.md §1, last row).

    A maximum of zero (an on-site final marked on paper, no problems entered here) gives everybody
    `participant`: a percentage of nothing is not a title, and awarding one would be the module
    making up a result.
    """
    maximum = rows[0]['max_points'] if rows else 0
    distinctions_left = contest.distinction_count
    for row in rows:
        pct = (row['total_points'] / maximum * 100) if maximum else 0
        if maximum and pct >= contest.laureate_min_pct:
            row['title'] = 'laureate'
        elif maximum and pct >= contest.finalist_min_pct:
            row['title'] = 'finalist'
        elif distinctions_left > 0 and row['total_points'] > 0:
            row['title'] = 'distinction'
            distinctions_left -= 1
        else:
            row['title'] = 'participant'
    return rows


# ---- publishing ----------------------------------------------------------------------------------


def publish_results_block_reason(contest) -> str | None:
    if contest.results_published_at is not None or contest.status == 'results_published':
        return ALREADY_PUBLISHED
    if contest.status not in ('judging', 'running'):
        return ILLEGAL_TRANSITION
    for stage in contest.stages.prefetch_related('problems', 'submissions__scores'):
        if not stage_is_fully_scored(stage):
            return STAGE_UNSCORED
    if contest.rules_version < 1:
        return RULES_MISSING
    return None


def publish_results(contest, *, actor=None):
    """Freeze the ranking into `ContestResult` rows and move the contest. Their only writer."""
    rows = titles_for(ranking(contest), contest)
    now = timezone.now()
    with transaction.atomic():
        ContestResult.objects.filter(contest=contest).delete()
        ContestResult.objects.bulk_create([
            ContestResult(
                contest=contest,
                registration=row['registration'],
                rank=row['rank'],
                total_points=row['total_points'],
                title=row['title'],
                published_at=now,
            )
            for row in rows
        ])
        contest.status = 'results_published'
        contest.results_published_at = now
        contest.save(update_fields=['status', 'results_published_at', 'updated_at'])
    return rows


def unpublish_block_reason(contest) -> str | None:
    """Taking a published ranking down is allowed only while the complaints window is open — which
    is exactly when a complaint might show it was wrong. After the window it is the record, and
    house rule 12 applies: the answer is a new version, not a deletion."""
    if contest.results_published_at is None:
        return NOT_PUBLISHED
    closes_at = contest.complaints_close_at
    if closes_at is not None and closes_at < timezone.now():
        return WINDOW_CLOSED
    if contest.status == 'closed':
        return CLOSED
    return None


def unpublish_results(contest, *, actor=None):
    with transaction.atomic():
        ContestResult.objects.filter(contest=contest).delete()
        contest.status = 'judging'
        contest.results_published_at = None
        contest.save(update_fields=['status', 'results_published_at', 'updated_at'])
    return contest


# ---- complaints ----------------------------------------------------------------------------------


def complain_block_reason(user, contest) -> str | None:
    """Why this person may not lodge a complaint — or `None`.

    A minor does not lodge one themself, by the owner's standing default (CONTESTS-BRIEF.md §6
    item 1): it is free text addressed to a stranger, which `accounts/minors.py` closes everywhere
    else on this site too. The guardian asks the organiser, who records it — and the UI says that
    sentence rather than greying a button with no explanation.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return ANONYMOUS
    if contest.results_published_at is None:
        return NOT_PUBLISHED
    closes_at = contest.complaints_close_at
    if closes_at is not None and closes_at < timezone.now():
        return WINDOW_CLOSED
    registration = contest.registrations.filter(user=user).first()
    if registration is None or not registration.is_competing:
        return NOT_PARTICIPANT
    if is_minor(user):
        return MINOR
    if contest.complaints.filter(registration=registration, status='open').exists():
        return ALREADY_OPEN
    return None


# ---- the regulamin -------------------------------------------------------------------------------


def publish_rules(contest, *, actor=None):
    """Freeze the sections into the next numbered version. KC art. 384 wants them storable; a
    registration stores the number it accepted, so a later edit can never retroactively become the
    rules somebody agreed to."""
    sections = list(contest.rules_sections.order_by('order', 'id'))
    number = contest.rules_version + 1
    from .models import ContestRulesVersion

    return ContestRulesVersion.objects.create(
        contest=contest,
        number=number,
        published_by=actor,
        snapshot=[
            {'key': s.key, 'order': s.order, 'body': s.body} for s in sections
        ],
    )
