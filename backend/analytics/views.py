"""`/api/analytics/…` — the staff dashboard's data. Read-only, apart from `recompute`.

**Staff only** (`is_staff`), refused the way the Mail tab's API refuses: 401 without credentials,
403 for a signed-in account that is not staff. A node governor is not staff and is refused too —
the numbers are platform-wide.

Every endpoint takes `?days=` (7, 30, 90 or 365; default 30) and answers for the Polish calendar
days ending today (`rollup.day_bounds`). Counts that describe PEOPLE go through `privacy.k` /
`privacy.k_rate` on the way out: a `null` there means "between 1 and 9" (k = 10) and is drawn as
"<10". Counts about content are not suppressed.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from django.db.models import Max, Sum
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from telemetry.models import RequestLog
from telemetry.routers import all_log_shards

from . import classify, client_errors, live
from .models import (
    ClientErrorGroup,
    ClientErrorReport,
    DailyActiveUsers,
    DailyClientError,
    DailyClient,
    DailyContentView,
    DailyReferrer,
    DailyRouteStat,
    RollupRun,
    WeeklyCohort,
)
from .privacy import K_ANONYMITY, k, k_rate
from .rollup import counted_people, day_bounds, monday, percentile, rollup_range

ALLOWED_DAYS = (7, 30, 90, 365)
DEFAULT_DAYS = 30
HEALTH_WINDOW_DAYS = 7


class IsStaff(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


class Period:
    """`days` calendar days ending today (inclusive), and the same length immediately before it —
    Polish days, the same ones the rollup buckets by (`rollup.day_bounds`)."""

    def __init__(self, days: int):
        self.days = days
        today = timezone.localdate()
        self.last = today
        self.first = today - dt.timedelta(days=days - 1)
        self.start, _ = day_bounds(self.first)
        _, self.end = day_bounds(today)
        self.prev_first = self.first - dt.timedelta(days=days)
        self.prev_last = self.first - dt.timedelta(days=1)
        self.prev_start, _ = day_bounds(self.prev_first)

    def dates(self) -> list[dt.date]:
        return [self.first + dt.timedelta(days=i) for i in range(self.days)]

    def payload(self) -> dict:
        return {'days': self.days, 'first': self.first.isoformat(), 'last': self.last.isoformat()}


class AnalyticsView(APIView):
    permission_classes = [IsStaff]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        raw = request.query_params.get('days', str(DEFAULT_DAYS))
        try:
            days = int(raw)
        except ValueError:
            days = -1
        self.bad_days = days not in ALLOWED_DAYS
        self.period = Period(days if not self.bad_days else DEFAULT_DAYS)

    def dispatch_ok(self):
        if self.bad_days:
            return Response(
                {'detail': 'days_not_allowed', 'allowed': list(ALLOWED_DAYS)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return None

    def get(self, request):
        refusal = self.dispatch_ok()
        if refusal is not None:
            return refusal
        return Response({'period': self.period.payload(), **self.build(request)})

    def build(self, request) -> dict:  # pragma: no cover — every subclass overrides it
        raise NotImplementedError


# ---- shared readers ----------------------------------------------------------------------------


def _in(qs, first: dt.date, last: dt.date, field: str = 'date'):
    return qs.filter(**{f'{field}__gte': first, f'{field}__lte': last})


def _requests_by_audience(first, last) -> dict[str, int]:
    rows = _in(DailyRouteStat.objects, first, last).values('audience').annotate(n=Sum('requests'))
    return {row['audience']: row['n'] or 0 for row in rows}


def _sum(qs, field: str) -> int:
    return qs.aggregate(n=Sum(field))['n'] or 0


def _freshness(period: Period) -> dict:
    runs = _in(RollupRun.objects, period.first, period.last)
    rolled = set(runs.values_list('date', flat=True))
    missing = [d.isoformat() for d in period.dates() if d not in rolled]
    last_run = RollupRun.objects.aggregate(at=Max('finished_at'))['at']
    return {
        'last_rollup_at': last_run.isoformat() if last_run else None,
        'days_rolled_up': len(rolled),
        'days_missing': missing,
        'excluded_by_objection': _sum(runs, 'rows_skipped_opt_out'),
    }


def _delta(current, previous, compared: bool | None = None) -> dict:
    """A KPI and its previous-period value. `compared` says whether there IS a previous value: on a
    people count `previous: null` means "suppressed", so "there was nothing to compare with" needs
    its own word rather than sharing that null."""
    return {
        'value': current,
        'previous': previous,
        'compared': (previous is not None) if compared is None else compared,
    }


# ---- endpoints ---------------------------------------------------------------------------------


class OverviewView(AnalyticsView):
    """KPI tiles (each with the previous period beside it) and one row per day."""

    def build(self, request):
        p = self.period
        now = _requests_by_audience(p.first, p.last)
        before = _requests_by_audience(p.prev_first, p.prev_last)
        human_now = now.get('anon', 0) + now.get('auth', 0)
        human_before = before.get('anon', 0) + before.get('auth', 0)

        views_now = _sum(_in(DailyContentView.objects, p.first, p.last), 'views')
        views_before = _sum(_in(DailyContentView.objects, p.prev_first, p.prev_last), 'views')

        def dau(first, last):
            values = list(_in(DailyActiveUsers.objects, first, last).values_list('users', flat=True))
            if not values:
                return None, None, False
            return round(sum(values) / len(values)), max(values), True

        avg_now, peak_now, _ = dau(p.first, p.last)
        avg_before, peak_before, had_before = dau(p.prev_first, p.prev_last)

        def searches(first, last):
            return _sum(_in(DailyRouteStat.objects, first, last), 'searches')

        def error_rate(first, last):
            qs = _in(DailyRouteStat.objects, first, last).exclude(audience='bot')
            total = _sum(qs, 'requests')
            return round(_sum(qs, 'status_5xx') / total, 5) if total else None

        accounts_now = live.accounts(p.start, p.end)
        accounts_before = live.accounts(p.prev_start, p.start)
        queues_now = live.moderation_queues(p.start, p.end)
        queues_before = live.moderation_queues(p.prev_start, p.start)
        community_now = live.community_activity(p.start, p.end)
        community_before = live.community_activity(p.prev_start, p.start)

        def total(rows, key):
            return sum(r[key] for r in rows)

        def comments(c):
            return c.get('comments', {}).get('period_total', 0)

        daily_routes = defaultdict(Counter)
        for row in (
            _in(DailyRouteStat.objects, p.first, p.last)
            .values('date', 'audience')
            .annotate(n=Sum('requests'), e=Sum('status_5xx'))
        ):
            daily_routes[row['date']][row['audience']] += row['n'] or 0
            if row['audience'] != 'bot':
                daily_routes[row['date']]['errors'] += row['e'] or 0
        daily_views = dict(
            _in(DailyContentView.objects, p.first, p.last)
            .values('date')
            .annotate(n=Sum('views'))
            .values_list('date', 'n')
        )
        daily_dau = dict(
            _in(DailyActiveUsers.objects, p.first, p.last).values_list('date', 'users')
        )
        rolled = set(_in(RollupRun.objects, p.first, p.last).values_list('date', flat=True))

        return {
            'freshness': _freshness(p),
            'kpis': {
                'human_requests': _delta(human_now, human_before),
                'content_views': _delta(views_now, views_before),
                'avg_daily_active_users': _delta(k(avg_now), k(avg_before), had_before),
                # Computed, not None: on a people count `null` means "suppressed", so a missing
                # comparison here drew as "<10" (seen in the first screenshot).
                'peak_daily_active_users': _delta(k(peak_now), k(peak_before), had_before),
                'registrations': _delta(
                    k(accounts_now['registered']), k(accounts_before['registered']), True
                ),
                'submissions': _delta(total(queues_now, 'submitted'), total(queues_before, 'submitted')),
                'comments': _delta(comments(community_now), comments(community_before)),
                'searches': _delta(searches(p.first, p.last), searches(p.prev_first, p.prev_last)),
                'error_rate': _delta(
                    error_rate(p.first, p.last), error_rate(p.prev_first, p.prev_last)
                ),
                'pending_in_queues': _delta(total(queues_now, 'pending'), None),
            },
            'daily': [
                {
                    'date': d.isoformat(),
                    'rolled_up': d in rolled,
                    'anon': daily_routes[d].get('anon', 0),
                    'auth': daily_routes[d].get('auth', 0),
                    'bot': daily_routes[d].get('bot', 0),
                    'errors_5xx': daily_routes[d].get('errors', 0),
                    'views': daily_views.get(d, 0),
                    'active_users': k(daily_dau.get(d)) if d in daily_dau else None,
                }
                for d in p.dates()
            ],
        }


class TrafficView(AnalyticsView):
    """Requests per day by audience, and the busiest route templates."""

    ROUTE_LIMIT = 25

    def build(self, request):
        p = self.period
        qs = _in(DailyRouteStat.objects, p.first, p.last)
        per_day: dict[dt.date, Counter] = defaultdict(Counter)
        for row in qs.values(
            'date', 'audience', 'requests', 'searches', 'status_4xx', 'status_5xx', 'throttled'
        ):
            bucket = per_day[row['date']]
            bucket[row['audience']] += row['requests']
            for key in ('searches', 'status_4xx', 'status_5xx', 'throttled'):
                bucket[key] += row[key]

        routes: dict[tuple, dict] = {}
        for row in qs.values(
            'route', 'method', 'audience', 'requests', 'status_4xx', 'status_5xx', 'throttled',
            'searches', 'p50_ms', 'p95_ms',
        ):
            key = (row['route'], row['method'])
            entry = routes.setdefault(
                key,
                {
                    'route': row['route'],
                    'method': row['method'],
                    'requests': 0,
                    'anon': 0,
                    'auth': 0,
                    'bot': 0,
                    'status_4xx': 0,
                    'status_5xx': 0,
                    'throttled': 0,
                    'searches': 0,
                    '_weighted_p50': 0,
                    'p95_ms_worst_day': 0,
                },
            )
            entry['requests'] += row['requests']
            entry[row['audience']] += row['requests']
            for key2 in ('status_4xx', 'status_5xx', 'throttled', 'searches'):
                entry[key2] += row[key2]
            entry['_weighted_p50'] += row['p50_ms'] * row['requests']
            entry['p95_ms_worst_day'] = max(entry['p95_ms_worst_day'], row['p95_ms'])
        top = sorted(routes.values(), key=lambda r: -r['requests'])[: self.ROUTE_LIMIT]
        for entry in top:
            weighted = entry.pop('_weighted_p50')
            entry['p50_ms'] = round(weighted / entry['requests']) if entry['requests'] else 0
        return {
            'daily': [
                {
                    'date': d.isoformat(),
                    'anon': per_day[d].get('anon', 0),
                    'auth': per_day[d].get('auth', 0),
                    'bot': per_day[d].get('bot', 0),
                    'searches': per_day[d].get('searches', 0),
                    'status_4xx': per_day[d].get('status_4xx', 0),
                    'status_5xx': per_day[d].get('status_5xx', 0),
                    'throttled': per_day[d].get('throttled', 0),
                }
                for d in p.dates()
            ],
            'routes': top,
            'route_count': len(routes),
        }


class ContentView(AnalyticsView):
    """Views by kind, the most-opened exercises and materials, and the thinnest branches."""

    TOP = 10

    def build(self, request):
        from exercises.models import Exercise
        from materials.models import Material

        p = self.period
        locale = request.query_params.get('lang') or 'pl'
        qs = _in(DailyContentView.objects, p.first, p.last)
        by_kind = list(
            qs.values('kind').annotate(views=Sum('views')).order_by('-views').values('kind', 'views')
        )
        daily = dict(qs.values('date').annotate(n=Sum('views')).values_list('date', 'n'))

        def top_ids(kind: str, limit: int) -> list[tuple[str, int]]:
            return list(
                qs.filter(kind=kind)
                .values('object_id')
                .annotate(n=Sum('views'))
                .order_by('-n', 'object_id')
                .values_list('object_id', 'n')[: limit * 3]
            )

        def title_for(translations, original):
            rows = {t.locale: t.title for t in translations}
            return rows.get(locale) or rows.get(original) or next(iter(rows.values()), '')

        exercise_rows = top_ids('exercise', self.TOP)
        ids = [int(i) for i, _ in exercise_rows if i.isdigit()]
        # Only what anybody may read: a view of something since unpublished or hidden is real but
        # is not ours to put a title to on a dashboard.
        exercises = {
            e.pk: e
            for e in Exercise.objects.filter(pk__in=ids, published=True, auto_hidden_at__isnull=True)
            .select_related('branch')
            .prefetch_related('translations')
        }
        top_exercises = []
        for object_id, n in exercise_rows:
            exercise = exercises.get(int(object_id)) if object_id.isdigit() else None
            if exercise is None:
                continue
            published = [t for t in exercise.translations.all() if t.status == 'published']
            top_exercises.append(
                {
                    'id': str(exercise.pk),
                    'title': title_for(published, exercise.original_locale),
                    'branch': exercise.branch.slug,
                    'number': exercise.number,
                    'views': n,
                }
            )
            if len(top_exercises) == self.TOP:
                break

        material_rows = top_ids('material', self.TOP)
        ids = [int(i) for i, _ in material_rows if i.isdigit()]
        materials = {
            m.pk: m
            for m in Material.objects.filter(pk__in=ids).prefetch_related('translations')
        }
        top_materials = []
        for object_id, n in material_rows:
            material = materials.get(int(object_id)) if object_id.isdigit() else None
            if material is None:
                continue
            top_materials.append(
                {
                    'id': str(material.pk),
                    'title': title_for(material.translations.all(), 'pl'),
                    'views': n,
                }
            )
            if len(top_materials) == self.TOP:
                break

        coverage = live.coverage(locale)
        branches = []
        for discipline in coverage['disciplines']:
            for branch in discipline['branches']:
                if branch['exercises'] == 0:
                    continue
                branches.append(
                    {
                        'slug': branch['slug'],
                        'name': branch['name'],
                        'discipline': discipline['name'],
                        'exercises': branch['exercises'],
                        'with_solution': branch['with_solution'],
                        'solution_share': round(branch['with_solution'] / branch['exercises'], 4),
                    }
                )
        branches.sort(key=lambda b: (b['solution_share'], -b['exercises']))
        return {
            'by_kind': by_kind,
            'daily': [{'date': d.isoformat(), 'views': daily.get(d, 0)} for d in p.dates()],
            'top_exercises': top_exercises,
            'top_materials': top_materials,
            'least_covered': branches[:8],
        }


class CommunityView(AnalyticsView):
    """What readers write back, who joins, and what gets made — per ISO week."""

    def build(self, request):
        p = self.period
        accounts = live.accounts(p.start, p.end)
        funnel = live.contribution_funnel(p.start, p.end)
        return {
            'weeks': [w.isoformat() for w in live.week_starts(p.start, p.end)],
            'activity': live.community_activity(p.start, p.end),
            'features': live.feature_usage(p.start, p.end),
            'accounts': {
                'weekly': [
                    {'week': row['week'], 'count': k(row['count'])} for row in accounts['weekly']
                ],
                'registered': k(accounts['registered']),
                'confirmation_rate': k_rate(accounts['confirmed'], accounts['with_email']),
                'guardian_created': k(accounts['guardian_created']),
                'total_accounts': k(accounts['total_accounts']),
            },
            'funnel': {
                'registered': k(funnel['registered']),
                'submitted': k(funnel['submitted']),
                'accepted': k(funnel['accepted']),
            },
        }


class ModerationView(AnalyticsView):
    def build(self, request):
        return {'queues': live.moderation_queues(self.period.start, self.period.end)}


class CoverageView(AnalyticsView):
    def build(self, request):
        return live.coverage(request.query_params.get('lang') or 'pl')


class CohortsView(AnalyticsView):
    """Retention: each signup week in the period, its size, and how many of it were active in each
    following week. All people counts, all suppressed; minors' and staff accounts are in none of them."""

    MAX_OFFSET = 12

    def build(self, request):
        from django.contrib.auth import get_user_model

        p = self.period
        weeks = live.week_starts(p.start, p.end)
        # Minors and staff are left out of the sizes exactly as they are left out of the active counts, or the
        # rate would divide adults by everybody.
        sizes = live._weekly(
            counted_people(get_user_model().objects.all()), 'date_joined', p.start, p.end
        )
        active: dict[tuple[dt.date, dt.date], int] = {
            (row.cohort_week, row.week): row.users
            for row in WeeklyCohort.objects.filter(cohort_week__gte=weeks[0])
        }
        this_week = monday(p.last)
        rows = []
        for cohort in weeks:
            size = sizes.get(cohort, 0)
            cells = []
            for offset in range(self.MAX_OFFSET + 1):
                week = cohort + dt.timedelta(days=7 * offset)
                if week > this_week:
                    break
                users = active.get((cohort, week), 0)
                cells.append(
                    {'offset': offset, 'users': k(users), 'rate': k_rate(users, size)}
                )
            rows.append({'cohort_week': cohort.isoformat(), 'size': k(size), 'cells': cells})
        return {'max_offset': self.MAX_OFFSET, 'cohorts': rows, 'k': K_ANONYMITY}


class ClientsView(AnalyticsView):
    """Browser, OS and device families, the bot share, and external referrer hosts."""

    REFERRER_LIMIT = 20

    def build(self, request):
        p = self.period
        qs = _in(DailyClient.objects, p.first, p.last)
        human = qs.exclude(device='bot')

        def families(field):
            rows = human.values(field).annotate(n=Sum('count')).order_by('-n')
            return [{'name': row[field], 'count': k(row['n'])} for row in rows]

        human_total = _sum(human, 'count')
        bot_total = _sum(qs.filter(device='bot'), 'count')
        referrer_rows = list(
            _in(DailyReferrer.objects, p.first, p.last)
            .values('host')
            .annotate(n=Sum('count'))
            .order_by('-n', 'host')
        )
        # A host seen fewer than K times is not named at all — a rare referrer can be one person's
        # intranet or a private document host. Its traffic is folded into one anonymous line.
        shown = [r for r in referrer_rows if r['n'] >= K_ANONYMITY][: self.REFERRER_LIMIT]
        rest = sum(r['n'] for r in referrer_rows) - sum(r['n'] for r in shown)
        return {
            'browsers': families('browser'),
            'os': families('os'),
            'devices': families('device'),
            'human_requests': human_total,
            'bot_requests': bot_total,
            'bot_share': round(bot_total / (bot_total + human_total), 4)
            if (bot_total + human_total)
            else None,
            'referrers': [{'host': r['host'], 'count': r['n']} for r in shown],
            'referrers_other': rest,
        }


class HealthView(AnalyticsView):
    """The last seven days, read from the raw log shards — the operational purpose the request log
    was written for, so this one view reads every row, objections included (an objection is to
    analytics, not to the site being kept working). It returns routes, counts, durations and
    request ids — never an IP address, a User-Agent or a user id. `?days=` does not apply."""

    LIMIT = 15

    def build(self, request):
        now = timezone.now()
        since = now - dt.timedelta(days=HEALTH_WINDOW_DAYS)
        durations: dict[tuple, list[int]] = defaultdict(list)
        errors: dict[tuple, dict] = {}
        statuses: Counter = Counter()
        for shard in all_log_shards():
            rows = (
                RequestLog.objects.using(shard)
                .filter(created_at__gte=since)
                .exclude(method__in=['OPTIONS', 'HEAD'])
                .values_list('method', 'path', 'status_code', 'duration_ms', 'request_id', 'created_at')
                .iterator(chunk_size=2000)
            )
            for method, path, code, ms, request_id, created in rows:
                route, _ = classify.route_template(path)
                key = (route, method)
                durations[key].append(ms)
                statuses[f'{code // 100}xx'] += 1
                if code == 429:
                    statuses['throttled'] += 1
                if code >= 500:
                    entry = errors.setdefault(
                        key, {'route': route, 'method': method, 'count': 0, 'last_seen': None, '_ids': []}
                    )
                    entry['count'] += 1
                    entry['_ids'].append((created, request_id))
        error_rows = []
        for entry in errors.values():
            recent = sorted(entry.pop('_ids'), reverse=True)
            entry['last_seen'] = recent[0][0].isoformat()
            entry['request_ids'] = [rid for _, rid in recent[:5]]
            error_rows.append(entry)
        error_rows.sort(key=lambda e: (-e['count'], e['route']))

        slow = []
        for (route, method), values in durations.items():
            # A route seen a handful of times has no meaningful 95th percentile.
            if len(values) < 5:
                continue
            values.sort()
            slow.append(
                {
                    'route': route,
                    'method': method,
                    'requests': len(values),
                    'p50_ms': percentile(values, 0.5),
                    'p95_ms': percentile(values, 0.95),
                    'max_ms': values[-1],
                }
            )
        slow.sort(key=lambda r: -r['p95_ms'])
        return {
            'window_days': HEALTH_WINDOW_DAYS,
            'statuses': dict(statuses),
            'errors': error_rows[: self.LIMIT],
            'slowest': slow[: self.LIMIT],
        }


class RecomputeView(APIView):
    """POST — recount yesterday and today now, rather than waiting for the night's cron. The same
    delete-and-recount the command does, so pressing it twice is the same as pressing it once."""

    permission_classes = [IsStaff]

    def post(self, request):
        summaries = rollup_range(timezone.localdate(), 2)
        return Response({'days': summaries})


class ClientErrorsView(AnalyticsView):
    """Browser error reports (`client_errors.py`): the top error groups for the period, each with
    its count, a day-by-day series, the route templates, builds and browser families it came from,
    and up to three sample reports. Counts of ERRORS, not of people, so nothing is k-suppressed —
    a report carries no person to count. Counts are kept 90 days and samples 30, so a 365-day
    period simply finds nothing older; the payload says so (`counts_kept_days`)."""

    LIMIT = 50
    SAMPLES = 3

    def build(self, request):
        p = self.period
        days = _in(DailyClientError.objects, p.first, p.last)
        totals = list(
            days.values('group').annotate(n=Sum('count')).order_by('-n', 'group')[: self.LIMIT]
        )
        ids = [row['group'] for row in totals]
        groups = ClientErrorGroup.objects.in_bulk(ids)
        series: dict[int, Counter] = defaultdict(Counter)
        facets: dict[int, dict[str, Counter]] = defaultdict(lambda: defaultdict(Counter))
        for row in days.filter(group__in=ids).values('group', 'date', 'route', 'build', 'browser', 'count'):
            series[row['group']][row['date']] += row['count']
            for facet in ('route', 'build', 'browser'):
                facets[row['group']][facet][row[facet]] += row['count']
        samples: dict[int, list] = defaultdict(list)
        for report in ClientErrorReport.objects.filter(
            group__in=ids, received_at__gte=p.start
        ).order_by('-received_at'):
            if len(samples[report.group_id]) < self.SAMPLES:
                samples[report.group_id].append(
                    {
                        'received_at': report.received_at.isoformat(),
                        'kind': report.kind,
                        'message': report.message,
                        'stack': report.stack,
                        'route': report.route,
                        'build': report.build,
                        'locale': report.locale,
                        'browser': report.browser,
                        'os': report.os,
                        'device': report.device,
                    }
                )

        def ranked(counter: Counter) -> list[dict]:
            return [{'name': name, 'count': n} for name, n in counter.most_common(10)]

        rows = []
        for row in totals:
            group = groups.get(row['group'])
            if group is None:
                continue
            rows.append(
                {
                    'id': str(group.pk),
                    'kind': group.kind,
                    'message': group.message,
                    'top_frame': group.top_frame,
                    'count': row['n'],
                    'first_seen': group.first_seen.isoformat(),
                    'last_seen': group.last_seen.isoformat(),
                    'daily': [series[group.pk].get(d, 0) for d in p.dates()],
                    'routes': ranked(facets[group.pk]['route']),
                    'builds': ranked(facets[group.pk]['build']),
                    'browsers': ranked(facets[group.pk]['browser']),
                    'samples': samples[group.pk],
                }
            )
        return {
            'total': _sum(days, 'count'),
            'groups': rows,
            'reports_kept_days': client_errors.REPORT_RETENTION_DAYS,
            'counts_kept_days': client_errors.COUNT_RETENTION_DAYS,
        }
