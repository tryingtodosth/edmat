"""Metrics read straight from the main database, at request time — not rolled up.

These are counts of rows EdMat keeps anyway (accounts, submissions, comments, courses…), so there is
nothing to roll up and nothing new is stored. Each function takes the period `(start, end)` and
returns plain dicts; `views.py` applies the small-number suppression (`privacy.py`) to the ones
that count PEOPLE.

Two registries keep this cheap to extend, both "one line per thing":

- `FEATURE_REGISTRY` — rows created per week for each feature surface.
- `QUEUE_REGISTRY` — each moderation queue: what "waiting" means, what "decided" means, and the
  timestamps a decision time can honestly be measured between. Where a queue never recorded WHEN
  it was decided (exercise submissions, edit suggestions, translations, solution entries and
  reports have a status but no decision timestamp), the median is `None` and the payload says
  `timing_recorded: false` — house rule 10, flag it rather than fake it.
"""

from __future__ import annotations

import datetime as dt
import statistics
from collections import Counter, defaultdict

from django.apps import apps
from django.contrib.auth import get_user_model
from django.db.models import Count, Exists, F, OuterRef, Q
from django.db.models.functions import TruncWeek

from .rollup import monday, without_staff

# MIRRORED BY HAND in frontend/src/lib/components/analytics/labels.ts (house rule 13): a new key
# here needs a label there (en + pl), or the dashboard shows the raw key.
# key → (app_label, model, datetime field, extra filter or None). The key is what the dashboard
# labels; a model that does not exist (an app removed, a migration not yet applied) is skipped
# rather than failing the whole page.
FEATURE_REGISTRY: dict[str, tuple[str, str, str, dict | None]] = {
    'exercises': ('exercises', 'Exercise', 'created_at', None),
    'materials': ('materials', 'Material', 'created_at', None),
    'material_versions': ('coauthoring', 'MaterialVersion', 'created_at', None),
    'concepts': ('concepts', 'Concept', 'created_at', None),
    'courses': ('courses', 'Course', 'created_at', None),
    'enrollments': ('courses', 'Enrollment', 'requested_at', None),
    'events': ('events', 'Event', 'created_at', None),
    'event_registrations': ('events', 'EventAttendance', 'created_at', None),
    'decks': ('flashcards', 'Deck', 'created_at', None),
    'flashcard_reviews': ('flashcards', 'ReviewLog', 'reviewed_at', None),
    'contests': ('contests', 'Contest', 'created_at', None),
    'tutoring_listings': ('services', 'Service', 'created_at', None),
    'bookings': ('booking', 'Booking', 'created_at', None),
    'study_sets': ('study', 'ExerciseSet', 'created_at', None),
    'posts': ('activity', 'Post', 'created_at', None),
    'needs': ('needs', 'Need', 'created_at', None),
    'tasks': ('tasks', 'Task', 'created_at', None),
    'plans': ('plans', 'Plan', 'created_at', None),
    'goals': ('goals', 'Goal', 'created_at', None),
    'polls': ('decisions', 'Poll', 'created_at', None),
    'organizations': ('organizations', 'Organization', 'created_at', None),
    'attachments': ('attachments', 'Attachment', 'created_at', None),
}

# Community activity per week — what readers write back.
COMMUNITY_REGISTRY: dict[str, tuple[str, str, str, dict | None]] = {
    'comments': ('community', 'Comment', 'created_at', None),
    'reviews': ('community', 'Review', 'created_at', None),
    'solution_entries': ('exercises', 'SolutionEntry', 'created_at', {'author__isnull': False}),
    # A translation is a row in a language other than the exercise's own — the original's row is
    # created with the exercise and is not somebody translating anything.
    'translations': ('exercises', 'ExerciseTranslation', 'created_at', {'_not_original': True}),
    'exercise_claims': ('exercises', 'ExerciseClaim', 'created_at', None),
    'material_claims': ('materials', 'MaterialCoverage', 'created_at', None),
    'course_claims': ('courses', 'CourseClaim', 'created_at', None),
    'material_reviews': ('materials', 'MaterialReview', 'created_at', None),
}

# queue → model, the pending filter, the decided filter, and (submitted_field, decided_field) when
# the decision time is recorded, else None.
QUEUE_REGISTRY: dict[str, dict] = {
    'exercise_submissions': {
        'model': ('moderation', 'ExerciseSubmission'),
        'pending': {'status': 'pending'},
        'decided': {'status__in': ['approved', 'rejected']},
        'accepted': {'status': 'approved'},
        'timing': None,
    },
    'edit_suggestions': {
        'model': ('moderation', 'EditSuggestion'),
        'pending': {'status': 'pending'},
        'decided': {'status__in': ['approved', 'rejected']},
        'accepted': {'status': 'approved'},
        'timing': None,
    },
    'translations': {
        'model': ('exercises', 'ExerciseTranslation'),
        'pending': {'status': 'pending'},
        'decided': {'status__in': ['published', 'rejected'], 'reviewed_by__isnull': False},
        'accepted': {'status': 'published', 'reviewed_by__isnull': False},
        'timing': None,
    },
    'solution_entries': {
        'model': ('exercises', 'SolutionEntry'),
        'pending': {'status': 'pending', 'is_removed': False},
        'decided': {'status__in': ['published', 'rejected'], 'reviewed_by__isnull': False},
        'accepted': {'status': 'published', 'reviewed_by__isnull': False},
        'timing': None,
    },
    'reports': {
        'model': ('moderation', 'Report'),
        'pending': {'status': 'pending'},
        'decided': {'status': 'resolved'},
        'accepted': None,
        'timing': None,
    },
    'material_versions': {
        'model': ('coauthoring', 'MaterialVersion'),
        'pending': {'status': 'proposed'},
        'decided': {'status__in': ['published', 'superseded', 'rejected'], 'decided_at__isnull': False},
        'accepted': {'status__in': ['published', 'superseded'], 'decided_at__isnull': False},
        # From the version's creation: there is no separate "proposed at", so a draft that sat with
        # its authors first counts that time too. Said on the dashboard.
        'timing': ('created_at', 'decided_at'),
    },
    'concept_revisions': {
        'model': ('concepts', 'ConceptRevision'),
        'pending': {'status': 'pending'},
        'decided': {
            'status__in': ['published', 'superseded', 'rejected'],
            'reviewed_at__isnull': False,
        },
        'accepted': {'status__in': ['published', 'superseded'], 'reviewed_at__isnull': False},
        'timing': ('submitted_at', 'reviewed_at'),
    },
    'governor_applications': {
        'model': ('moderation', 'GovernorApplication'),
        'pending': {'status': 'pending'},
        'decided': {'status__in': ['approved', 'declined']},
        'accepted': {'status': 'approved'},
        'timing': ('created_at', 'decided_at'),
    },
}


def _model(app_label: str, name: str):
    try:
        return apps.get_model(app_label, name)
    except LookupError:
        return None


def _weekly(qs, field: str, start: dt.datetime, end: dt.datetime) -> dict[dt.date, int]:
    rows = (
        qs.filter(**{f'{field}__gte': start, f'{field}__lt': end})
        .annotate(_week=TruncWeek(field))
        .values('_week')
        .annotate(n=Count('pk'))
    )
    out: dict[dt.date, int] = {}
    for row in rows:
        week = row['_week']
        if isinstance(week, dt.datetime):
            week = week.date()
        out[week] = out.get(week, 0) + row['n']
    return out


def week_starts(start: dt.datetime, end: dt.datetime) -> list[dt.date]:
    first = monday(start.date())
    last = monday((end - dt.timedelta(seconds=1)).date())
    weeks = []
    week = first
    while week <= last:
        weeks.append(week)
        week += dt.timedelta(days=7)
    return weeks


def _registry_series(registry, start, end) -> dict[str, dict]:
    weeks = week_starts(start, end)
    out: dict[str, dict] = {}
    for key, (app_label, name, field, extra) in registry.items():
        model = _model(app_label, name)
        if model is None:
            continue
        qs = model.objects.all()
        extra = dict(extra or {})
        if extra.pop('_not_original', False):
            qs = qs.exclude(locale=F('exercise__original_locale'))
        if extra:
            qs = qs.filter(**extra)
        try:
            by_week = _weekly(qs, field, start, end)
            total_all_time = qs.count()
        except Exception:  # noqa: BLE001 — an unmigrated table must not take the page down
            continue
        out[key] = {
            'weekly': [{'week': w.isoformat(), 'count': by_week.get(w, 0)} for w in weeks],
            'period_total': sum(by_week.values()),
            'all_time': total_all_time,
        }
    return out


def feature_usage(start, end) -> dict[str, dict]:
    return _registry_series(FEATURE_REGISTRY, start, end)


def community_activity(start, end) -> dict[str, dict]:
    return _registry_series(COMMUNITY_REGISTRY, start, end)


# ---- accounts ----------------------------------------------------------------------------------


def accounts(start, end) -> dict:
    """Registrations per week, the share of new accounts with a confirmed address, and accounts a
    guardian created. RAW counts — every one of them is about people, and `views.py` suppresses."""
    User = get_user_model()
    weeks = week_starts(start, end)
    # Staff are not counted as people anywhere in analytics (owner's decision 2026-10-14).
    people = without_staff(User.objects.all())
    new_users = people.filter(date_joined__gte=start, date_joined__lt=end)
    by_week = _weekly(people, 'date_joined', start, end)

    with_email = new_users.exclude(email='')
    confirmed = 0
    ConfirmedEmail = _model('mail', 'ConfirmedEmail')
    if ConfirmedEmail is not None:
        confirmed = ConfirmedEmail.objects.filter(
            user__in=with_email, email__iexact=F('user__email')
        ).count()

    guardian_created = 0
    Guardianship = _model('accounts', 'Guardianship')
    if Guardianship is not None:
        guardian_created = (
            Guardianship.objects.filter(child__in=new_users).values('child').distinct().count()
        )

    return {
        'weekly': [{'week': w.isoformat(), 'count': by_week.get(w, 0)} for w in weeks],
        'registered': new_users.count(),
        'with_email': with_email.count(),
        'confirmed': confirmed,
        'guardian_created': guardian_created,
        'total_accounts': people.filter(is_active=True).count(),
    }


def contribution_funnel(start, end) -> dict:
    """Of the accounts registered in the period: how many submitted anything for review, and how
    many had something accepted. "Submitted" is an exercise submission, a hint or solution, a
    translation, a material version put up for decision, or a concept revision sent for review."""
    User = get_user_model()
    new_ids = set(
        without_staff(User.objects.filter(date_joined__gte=start, date_joined__lt=end)).values_list(
            'pk', flat=True
        )
    )
    submitted: set[int] = set()
    accepted: set[int] = set()
    sources = [
        ('moderation', 'ExerciseSubmission', 'submitted_by_id', Q(), Q(status='approved')),
        ('exercises', 'SolutionEntry', 'author_id', Q(), Q(status='published')),
        (
            'exercises',
            'ExerciseTranslation',
            'translated_by_id',
            ~Q(locale=F('exercise__original_locale')),
            Q(status='published'),
        ),
        (
            'coauthoring',
            'MaterialVersion',
            'created_by_id',
            ~Q(status='draft'),
            Q(status__in=['published', 'superseded']),
        ),
        (
            'concepts',
            'ConceptRevision',
            'created_by_id',
            Q(submitted_at__isnull=False),
            Q(status__in=['published', 'superseded']),
        ),
    ]
    for app_label, name, field, base, ok in sources:
        model = _model(app_label, name)
        if model is None or not new_ids:
            continue
        try:
            qs = model.objects.filter(base, **{f'{field}__in': new_ids})
            submitted.update(qs.values_list(field, flat=True))
            accepted.update(qs.filter(ok).values_list(field, flat=True))
        except Exception:  # noqa: BLE001 — a field renamed elsewhere must not take the page down
            continue
    result = {
        'registered': len(new_ids),
        'submitted': len(submitted & new_ids),
        'accepted': len(accepted & new_ids),
    }
    new_ids.clear()
    submitted.clear()
    accepted.clear()
    return result


# ---- moderation --------------------------------------------------------------------------------


def moderation_queues(start, end) -> list[dict]:
    out = []
    for key, spec in QUEUE_REGISTRY.items():
        model = _model(*spec['model'])
        if model is None:
            continue
        try:
            pending = model.objects.filter(**spec['pending']).count()
            timing = spec['timing']
            submitted_field = timing[0] if timing else 'created_at'
            submitted = model.objects.filter(
                **{f'{submitted_field}__gte': start, f'{submitted_field}__lt': end}
            ).count()
            if timing:
                decided_qs = model.objects.filter(**spec['decided']).filter(
                    **{f'{timing[1]}__gte': start, f'{timing[1]}__lt': end}
                )
                basis = 'decided_in_period'
            else:
                # No decision timestamp: count decisions among what was SUBMITTED in the period.
                decided_qs = model.objects.filter(**spec['decided']).filter(
                    created_at__gte=start, created_at__lt=end
                )
                basis = 'submitted_in_period'
            decided = decided_qs.count()
            accepted = (
                decided_qs.filter(**spec['accepted']).count() if spec['accepted'] else None
            )
            median_hours = None
            if timing:
                pairs = decided_qs.exclude(**{f'{timing[0]}__isnull': True}).values_list(
                    timing[0], timing[1]
                )
                hours = [
                    (b - a).total_seconds() / 3600 for a, b in pairs if a is not None and b >= a
                ]
                if hours:
                    median_hours = round(statistics.median(hours), 1)
        except Exception:  # noqa: BLE001 — an unmigrated table must not take the page down
            continue
        out.append(
            {
                'queue': key,
                'pending': pending,
                'submitted': submitted,
                'decided': decided,
                'accepted': accepted,
                'decided_basis': basis,
                'timing_recorded': bool(timing),
                'median_hours_to_decision': median_hours,
            }
        )
    return out


# ---- coverage ----------------------------------------------------------------------------------


def coverage(locale: str = 'pl') -> dict:
    """Per discipline and branch: published exercises, how many have a visible hint, a visible
    solution, are verified, and have a published text in each language. Not period-bound — it is
    the state of the corpus now."""
    Exercise = _model('exercises', 'Exercise')
    SolutionEntry = _model('exercises', 'SolutionEntry')
    ExerciseTranslation = _model('exercises', 'ExerciseTranslation')
    Branch = _model('taxonomy', 'Branch')

    visible = dict(status='published', is_removed=False, auto_hidden_at__isnull=True)
    exercises = (
        Exercise.objects.filter(published=True)
        .annotate(
            has_hint=Exists(
                SolutionEntry.objects.filter(exercise=OuterRef('pk'), kind='hint', **visible)
            ),
            has_solution=Exists(
                SolutionEntry.objects.filter(exercise=OuterRef('pk'), kind='solution', **visible)
            ),
        )
        .values_list('pk', 'branch_id', 'has_hint', 'has_solution', 'verified')
    )
    per_branch: dict[int, Counter] = defaultdict(Counter)
    branch_of: dict[int, int] = {}
    for pk, branch_id, has_hint, has_solution, verified in exercises:
        branch_of[pk] = branch_id
        row = per_branch[branch_id]
        row['exercises'] += 1
        row['with_hint'] += int(bool(has_hint))
        row['with_solution'] += int(bool(has_solution))
        row['verified'] += int(bool(verified))

    locales: set[str] = set()
    translated: dict[int, Counter] = defaultdict(Counter)
    for exercise_id, row_locale in (
        ExerciseTranslation.objects.filter(status='published', exercise_id__in=branch_of.keys())
        .values_list('exercise_id', 'locale')
        .distinct()
    ):
        locales.add(row_locale)
        translated[branch_of[exercise_id]][row_locale] += 1

    branches = (
        Branch.objects.filter(status='approved')
        .select_related('discipline')
        .prefetch_related('translations', 'discipline__translations')
    )

    def name_of(obj) -> str:
        names = {t.locale: t.name for t in obj.translations.all()}
        return names.get(locale) or names.get('pl') or next(iter(names.values()), obj.slug)

    disciplines: dict[str, dict] = {}
    for branch in branches:
        counts = per_branch.get(branch.pk, Counter())
        discipline = branch.discipline
        entry = disciplines.setdefault(
            discipline.slug,
            {'slug': discipline.slug, 'name': name_of(discipline), 'branches': []},
        )
        entry['branches'].append(
            {
                'slug': branch.slug,
                'name': name_of(branch),
                'exercises': counts['exercises'],
                'with_hint': counts['with_hint'],
                'with_solution': counts['with_solution'],
                'verified': counts['verified'],
                'translated': {
                    loc: translated.get(branch.pk, Counter())[loc] for loc in sorted(locales)
                },
            }
        )
    return {'locales': sorted(locales), 'disciplines': list(disciplines.values())}
