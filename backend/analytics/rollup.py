"""One day of request-log rows → the aggregate tables in `models.py`. Idempotent by construction.

**Recount, never increment** (house rule 5): `rollup_day` deletes every aggregate row for the day
and writes the counts again from the raw rows, so running it twice, or after a late row arrives, or
after a fix to the classifier, gives the same answer as running it once on the final data. The
delete and the re-insert sit in one short `atomic()` per table (backend/CLAUDE.md SQLite rule 2:
fine around a delete + bulk_create on one table).

**Ordering against retention.** `enforce_log_retention` deletes request rows after 90 days by
default. A day can only be (re)computed while its rows exist, so the daily cron runs this command
FIRST and the retention command after it (`deploy/cron/edmat-analytics`). The rollup re-does the
last few days on every run (`--days 3` in the cron line), which absorbs a missed night; anything
older than the retention window is simply final.

Days are Polish calendar days (`settings.TIME_ZONE`, `Europe/Warsaw` since 2026-10-15): a day runs
from local midnight to local midnight, so it is 23 hours long in March and 25 in October, and a
request at 00:30 Polish time counts on the day a Polish reader would say it happened. The log's
timestamps are UTC instants; `day_bounds` is the one place a date becomes a pair of them. Until
that day the buckets were UTC days, one or two hours off at each end.

**Who is never counted as an active account**: minors (`adult_accounts`), staff
(`without_staff`, owner's decision 2026-10-14 — their REQUESTS still count as traffic), the
demonstration accounts the seeders make (`without_demo`, 2026-10-15), and — like every other
figure here — anybody whose request carried `Sec-GPC: 1` / `DNT: 1`.

**Retention of the aggregates themselves**: 25 months (`purge_aggregates`, run by the command after
every rollup) — the CNIL benchmark ANALYTICS-LAW.md §3 adopts. They hold no identifier, but a limit
nobody enforces is not a limit.

**What leaves this module**: counts keyed by a date, a URL pattern, a browser family, an external
host. The user ids read to count distinct active accounts live in a local `set` and die with it.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from telemetry.models import RequestLog
from telemetry.routers import all_log_shards

from . import classify
from .models import (
    DailyActiveUsers,
    DailyClient,
    DailyContentView,
    DailyReferrer,
    DailyRouteStat,
    RollupRun,
    WeeklyCohort,
)

# The methods a page-view or a route stat is about. OPTIONS is a CORS preflight — plumbing the
# browser does by itself, twice per cross-origin write in development — and HEAD is a monitor.
SKIPPED_METHODS = {'OPTIONS', 'HEAD'}


def day_bounds(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """Local midnight of `day` and of the day after, as UTC instants (module docstring)."""
    tz = timezone.get_default_timezone()

    def midnight(d: dt.date) -> dt.datetime:
        return dt.datetime.combine(d, dt.time.min, tzinfo=tz).astimezone(dt.timezone.utc)

    return midnight(day), midnight(day + dt.timedelta(days=1))


def monday(day: dt.date) -> dt.date:
    return day - dt.timedelta(days=day.weekday())


def percentile(sorted_values: list[int], fraction: float) -> int:
    """Nearest-rank percentile of an already sorted list (0 for an empty one)."""
    if not sorted_values:
        return 0
    rank = max(1, int(round(fraction * len(sorted_values) + 0.4999)))
    return sorted_values[min(rank, len(sorted_values)) - 1]


def _rows_for_day(day: dt.date):
    """Every analytics-eligible row of the day, across every shard, as plain tuples.

    `analytics_opt_out=True` rows are counted (for the run record) and otherwise never looked at.
    Only the columns a rollup needs are read; the IP address is not among them."""
    start, end = day_bounds(day)
    skipped = 0
    rows = []
    for shard in all_log_shards():
        base = RequestLog.objects.using(shard).filter(created_at__gte=start, created_at__lt=end)
        skipped += base.filter(analytics_opt_out=True).count()
        rows.extend(
            base.filter(analytics_opt_out=False).values_list(
                'user_id',
                'method',
                'path',
                'query_string',
                'status_code',
                'duration_ms',
                'user_agent',
                'referer',
                'was_throttled',
            ).iterator(chunk_size=2000)
        )
    return rows, skipped


def _replace(model, day_field: str, day: dt.date, objects: list) -> None:
    with transaction.atomic():
        model.objects.filter(**{day_field: day}).delete()
        model.objects.bulk_create(objects, batch_size=500)


def adult_accounts(qs):
    """`qs` (a User queryset) without minors: a `Profile.is_minor` account or one a guardian
    created. ANALYTICS-LAW.md §3 row 5 — the balancing for children is heavier and counting them
    gains little, so they are left out of active-account counts and cohorts entirely."""
    return qs.exclude(profile__is_minor=True).exclude(guardians__isnull=False)


def without_staff(qs):
    """`qs` (a User queryset) without staff (`is_staff` or `is_superuser`, as of the moment this
    runs). Owner's decision 2026-10-14: the people who run the site are not its audience, and on a
    site this size they would be most of the active accounts. Applies to PEOPLE counts only —
    their requests still count as requests (a request is a request)."""
    return qs.exclude(is_staff=True).exclude(is_superuser=True)


#: The address every demonstration seeder gives its accounts (`testing/personas.py`,
#: `testing/conference_demo.py`, `testing/school_demo.py`, `seed_demo_content`, `seed_demo_users`):
#: `.example` is a reserved domain, so no person who registered can hold one.
DEMO_EMAIL_DOMAIN = '@edmat.example'


def without_demo(qs):
    """`qs` (a User queryset) without the accounts the demonstration seeders made: an
    `@edmat.example` address, or — a seeded pupil a guardian manages has no address of its own —
    a guardian who has one. The 2026-09-25 demo conference put ~165 of them into one week on the
    live site, which read as 176 registrations, a cohort of 165 at 0 % and a funnel of 176 with
    nobody contributing (§17CQ). Like staff, their REQUESTS still count as traffic."""
    return qs.exclude(email__iendswith=DEMO_EMAIL_DOMAIN).exclude(
        guardians__guardian__email__iendswith=DEMO_EMAIL_DOMAIN
    )


def counted_people(qs):
    """The accounts a people-count may include: adults who are not staff and not demonstration
    accounts."""
    return without_demo(without_staff(adult_accounts(qs)))


def _drop_minors(ids: set[int]) -> set[int]:
    """The ids that may be counted as an active account: no minors, no staff, no demo accounts."""
    if not ids:
        return ids
    User = get_user_model()
    return set(counted_people(User.objects.filter(pk__in=ids)).values_list('pk', flat=True))


def rollup_day(day: dt.date) -> dict:
    """Recompute every daily table for `day`. Returns a small summary for the command to print."""
    rows, skipped = _rows_for_day(day)
    own_hosts = classify._own_hosts()

    route_counts: dict[tuple, dict] = defaultdict(
        lambda: {'requests': 0, '4xx': 0, '5xx': 0, 'throttled': 0, 'searches': 0, 'ms': []}
    )
    views: Counter = Counter()
    referrers: Counter = Counter()
    clients: Counter = Counter()
    active: set[int] = set()

    for user_id, method, path, query, status, duration, user_agent, referer, throttled in rows:
        if method in SKIPPED_METHODS:
            continue
        browser, os_family, device = classify.classify_user_agent(user_agent)
        is_bot = device == 'bot'
        audience = 'bot' if is_bot else ('auth' if user_id else 'anon')
        route, _ = classify.route_template(path)

        bucket = route_counts[(route, method, audience)]
        bucket['requests'] += 1
        if 400 <= status < 500:
            bucket['4xx'] += 1
        elif status >= 500:
            bucket['5xx'] += 1
        if throttled:
            bucket['throttled'] += 1
        if classify.is_search(query):
            bucket['searches'] += 1
        bucket['ms'].append(duration)

        clients[(browser, os_family, device)] += 1
        if is_bot:
            continue
        if user_id:
            active.add(user_id)
        if method == 'GET' and status == 200:
            seen = classify.content_view(path)
            if seen:
                views[seen] += 1
        host = classify.external_referrer_host(referer, own_hosts)
        if host:
            referrers[host] += 1

    route_objects = []
    for (route, method, audience), bucket in route_counts.items():
        durations = sorted(bucket['ms'])
        route_objects.append(
            DailyRouteStat(
                date=day,
                route=route[:200],
                method=method[:10],
                audience=audience,
                requests=bucket['requests'],
                status_4xx=bucket['4xx'],
                status_5xx=bucket['5xx'],
                throttled=bucket['throttled'],
                searches=bucket['searches'],
                p50_ms=percentile(durations, 0.50),
                p95_ms=percentile(durations, 0.95),
            )
        )
    _replace(DailyRouteStat, 'date', day, route_objects)
    _replace(
        DailyContentView,
        'date',
        day,
        [DailyContentView(date=day, kind=k, object_id=o, views=n) for (k, o), n in views.items()],
    )
    _replace(
        DailyReferrer,
        'date',
        day,
        [DailyReferrer(date=day, host=h, count=n) for h, n in referrers.items()],
    )
    _replace(
        DailyClient,
        'date',
        day,
        [
            DailyClient(date=day, browser=b, os=o, device=d, count=n)
            for (b, o, d), n in clients.items()
        ],
    )
    active = _drop_minors(active)
    _replace(DailyActiveUsers, 'date', day, [DailyActiveUsers(date=day, users=len(active))])
    RollupRun.objects.update_or_create(
        date=day, defaults={'rows_read': len(rows), 'rows_skipped_opt_out': skipped}
    )
    summary = {
        'date': day.isoformat(),
        'rows': len(rows),
        'skipped_opt_out': skipped,
        'routes': len(route_objects),
        'views': sum(views.values()),
        'active_users': len(active),
    }
    active.clear()
    return summary


def _active_user_ids(start: dt.datetime, end: dt.datetime) -> set[int]:
    ids: set[int] = set()
    for shard in all_log_shards():
        ids.update(
            RequestLog.objects.using(shard)
            .filter(
                created_at__gte=start,
                created_at__lt=end,
                analytics_opt_out=False,
                user_id__isnull=False,
            )
            .exclude(method__in=SKIPPED_METHODS)
            .values_list('user_id', flat=True)
            .distinct()
        )
    return ids


def rollup_week(any_day: dt.date) -> int:
    """Recompute the retention rows for the ISO week containing `any_day`.

    Reads the whole week's distinct active accounts, looks up the Monday of the week each one
    signed up in, and keeps only "N accounts from cohort C were active in week W". Bot-looking
    traffic from a signed-in account still counts as that account being active — a person
    scripting their own account is a person. Returns how many cohort rows were written."""
    week = monday(any_day)
    start, _ = day_bounds(week)
    end, _ = day_bounds(week + dt.timedelta(days=7))
    ids = _active_user_ids(start, end)
    cohorts: Counter = Counter()
    if ids:
        User = get_user_model()
        joined = counted_people(User.objects.filter(pk__in=ids)).values_list(
            'date_joined', flat=True
        )
        for when in joined:
            cohort = monday(timezone.localtime(when).date())
            if cohort <= week:
                cohorts[cohort] += 1
    ids.clear()
    _replace(
        WeeklyCohort,
        'week',
        week,
        [WeeklyCohort(week=week, cohort_week=c, users=n) for c, n in cohorts.items()],
    )
    return len(cohorts)


def rollup_range(last_day: dt.date, days: int) -> list[dict]:
    """`days` days ending at `last_day` inclusive, oldest first, then every ISO week they touch."""
    summaries = []
    weeks = set()
    for offset in range(days - 1, -1, -1):
        day = last_day - dt.timedelta(days=offset)
        summaries.append(rollup_day(day))
        weeks.add(monday(day))
    for week in sorted(weeks):
        rollup_week(week)
    return summaries


AGGREGATE_RETENTION_MONTHS = 25


def months_before(day: dt.date, months: int) -> dt.date:
    """The same day-of-month `months` calendar months earlier (clamped to the month's last day)."""
    import calendar

    total = day.year * 12 + (day.month - 1) - months
    year, month = divmod(total, 12)
    month += 1
    return dt.date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def purge_aggregates(today: dt.date, months: int = AGGREGATE_RETENTION_MONTHS) -> int:
    """Delete every aggregate row older than `months` months. Returns how many rows went."""
    cutoff = months_before(today, months)
    deleted = 0
    for model in (DailyRouteStat, DailyContentView, DailyReferrer, DailyClient, DailyActiveUsers,
                  RollupRun):
        deleted += model.objects.filter(date__lt=cutoff).delete()[0]
    deleted += WeeklyCohort.objects.filter(week__lt=cutoff).delete()[0]
    return deleted
