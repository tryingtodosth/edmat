"""Tests for the analytics rollups and the staff API.

Three of these pin a PRIVACY property rather than a behaviour, and are the ones that must never be
"fixed" by loosening them: `NoPersonalColumnsTests` (no analytics table can hold an IP, a
User-Agent, a user id, a path or a request id), `RollupTests.test_opted_out_rows_reach_no_table`
(a `Sec-GPC`/`DNT` request feeds no statistic), and the k-suppression tests (a count of people
below 10 never leaves the API as a number).
"""

import datetime as dt

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from telemetry.models import RequestLog
from telemetry.routers import all_log_shards, shard_for_user
from testing.factories import make_user

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
from .privacy import k, k_rate
from .rollup import day_bounds, percentile, rollup_day, rollup_week

User = get_user_model()

CHROME_WIN = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/130.0.0.0 Safari/537.36'
)
SAFARI_IPHONE = (
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like '
    'Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
)
SAFARI_IPAD = (
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
    'Version/17.5 Mobile/15E148 Safari/604.1'
)
CHROME_ANDROID_PHONE = (
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/130.0.0.0 Mobile Safari/537.36'
)
CHROME_ANDROID_TABLET = (
    'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/130.0.0.0 Safari/537.36'
)
FIREFOX_LINUX = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'
EDGE_MAC = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
)
GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
HEADLESS = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
    'HeadlessChrome/130.0.0.0 Safari/537.36'
)

DAY = dt.date(2026, 10, 7)  # a Wednesday


def at(day: dt.date, hour: int = 12) -> dt.datetime:
    """`hour` o'clock on `day` in Polish time — the clock the rollup's days are cut on
    (`rollup.day_bounds`), so `at(DAY, 0)` is the first instant of DAY's bucket."""
    return dt.datetime.combine(day, dt.time(hour), tzinfo=timezone.get_default_timezone())


def log(*, user_id=None, path='/api/exercises/', method='GET', status=200, ms=10, ua=CHROME_WIN,
        referer='', query='', when=None, opt_out=False):
    """One RequestLog row in the shard its user belongs to, stamped at `when`."""
    shard = shard_for_user(user_id)
    row = RequestLog.objects.using(shard).create(
        user_id=user_id, method=method, path=path, query_string=query, status_code=status,
        duration_ms=ms, user_agent=ua, referer=referer, request_id='r', ip_address='203.0.113.9',
        was_throttled=status == 429, analytics_opt_out=opt_out,
    )
    RequestLog.objects.using(shard).filter(pk=row.pk).update(created_at=when or at(DAY))
    return row


class ClassifierTests(TestCase):
    def test_browsers_operating_systems_and_devices(self):
        cases = {
            CHROME_WIN: ('chrome', 'windows', 'desktop'),
            SAFARI_IPHONE: ('safari', 'ios', 'mobile'),
            SAFARI_IPAD: ('safari', 'ios', 'tablet'),
            CHROME_ANDROID_PHONE: ('chrome', 'android', 'mobile'),
            CHROME_ANDROID_TABLET: ('chrome', 'android', 'tablet'),
            FIREFOX_LINUX: ('firefox', 'linux', 'desktop'),
            EDGE_MAC: ('edge', 'macos', 'desktop'),
        }
        for ua, expected in cases.items():
            with self.subTest(ua=ua[:40]):
                self.assertEqual(classify.classify_user_agent(ua), expected)

    def test_bots_scripts_and_empty_agents_are_bots(self):
        for ua in (GOOGLEBOT, HEADLESS, 'curl/8.5.0', 'python-requests/2.32', 'node', 'undici', ''):
            with self.subTest(ua=ua):
                self.assertEqual(classify.classify_user_agent(ua), ('bot', 'other', 'bot'))

    def test_the_vocabulary_is_closed(self):
        """Whatever a browser sends, what comes back is one of a few fixed words — so the stored
        table is bounded by this module, not by what visitors' browsers happen to say."""
        browser, os_family, _ = classify.classify_user_agent('Mozilla/5.0 (Weird OS) NovelBrowser/1')
        self.assertIn(browser, classify.BROWSER_FAMILIES)
        self.assertIn(os_family, classify.OS_FAMILIES)


class RouteTemplateTests(TestCase):
    def test_ids_collapse_to_the_pattern(self):
        self.assertEqual(classify.route_template('/api/exercises/12/')[0], '/api/exercises/:pk/')
        self.assertEqual(classify.route_template('/api/exercises/99999/')[0], '/api/exercises/:pk/')
        self.assertEqual(
            classify.route_template('/api/nodes/course/3/goals/')[0], '/api/nodes/:kind/:pk/goals/'
        )
        self.assertEqual(classify.route_template('/api/branches/am2/')[0], '/api/branches/:slug/')

    def test_named_actions_stay_distinct_from_detail(self):
        self.assertEqual(classify.route_template('/api/exercises/random/')[0], '/api/exercises/random/')

    def test_unresolvable_paths_share_one_bucket(self):
        """A scanner probing a thousand paths must not grow the table by a thousand rows."""
        for path in ('/wp-login.php', '/.env', '/api/nonexistent/thing/'):
            self.assertEqual(classify.route_template(path)[0], classify.UNMATCHED_ROUTE)

    def test_content_views_are_detail_endpoints_only(self):
        self.assertEqual(classify.content_view('/api/exercises/12/'), ('exercise', '12'))
        self.assertEqual(classify.content_view('/api/materials/4/'), ('material', '4'))
        self.assertEqual(classify.content_view('/api/concepts/calka/'), ('concept', 'calka'))
        self.assertEqual(classify.content_view('/api/branches/am2/'), ('branch', 'am2'))
        for path in ('/api/exercises/', '/api/exercises/random/', '/api/exercises/bulk/',
                     '/api/exercises/12/comments/', '/wp-login.php'):
            with self.subTest(path=path):
                self.assertIsNone(classify.content_view(path))

    def test_search_is_detected_from_the_redacted_marker_only(self):
        self.assertTrue(classify.is_search('q=[redacted]&lang=pl'))
        self.assertTrue(classify.is_search('lang=pl&search=[redacted]'))
        self.assertFalse(classify.is_search('lang=pl&sequence=2'))
        self.assertFalse(classify.is_search(''))

    def test_referrer_keeps_the_external_host_only(self):
        own = frozenset({'edmat.net', 'localhost'})
        self.assertEqual(
            classify.external_referrer_host('https://www.google.com/search?q=calka+oznaczona', own),
            'google.com',
        )
        self.assertEqual(
            classify.external_referrer_host('https://forum.example.org/t/123?token=x', own),
            'forum.example.org',
        )
        self.assertIsNone(classify.external_referrer_host('https://edmat.net/exercises/3', own))
        self.assertIsNone(classify.external_referrer_host('https://pl.edmat.net/x', own))
        self.assertIsNone(classify.external_referrer_host('http://localhost:5173/', own))
        self.assertIsNone(classify.external_referrer_host('', own))
        self.assertIsNone(classify.external_referrer_host('not a url', own))


class PrivacyTests(TestCase):
    def test_small_counts_of_people_are_suppressed(self):
        """k = 10 (ANALYTICS-LAW.md §3): a signup week or a niche branch is often one class."""
        self.assertEqual(k(0), 0)
        for n in range(1, 10):
            self.assertIsNone(k(n))
        self.assertEqual(k(10), 10)
        self.assertEqual(k(120), 120)

    def test_a_rate_is_offered_only_over_unsuppressed_counts(self):
        self.assertIsNone(k_rate(3, 40))
        self.assertIsNone(k_rate(12, 9))
        self.assertIsNone(k_rate(0, 0))
        self.assertEqual(k_rate(10, 40), 0.25)
        self.assertEqual(k_rate(0, 40), 0.0)

    def test_percentile_is_nearest_rank(self):
        values = list(range(1, 101))
        self.assertEqual(percentile(values, 0.5), 50)
        self.assertEqual(percentile(values, 0.95), 95)
        self.assertEqual(percentile([7], 0.95), 7)
        self.assertEqual(percentile([], 0.5), 0)


class NoPersonalColumnsTests(TestCase):
    """The analytics tables are aggregates. If one of them ever gains a column that can hold an IP,
    a User-Agent, a user id, a path, a referrer URL or a request id, it has stopped being one —
    and this fails before the privacy policy quietly becomes untrue."""

    BANNED = {
        'ip', 'ip_address', 'user_agent', 'ua', 'user', 'user_id', 'actor_id', 'path',
        'query_string', 'referer', 'referrer', 'request_id', 'visitor_id', 'fingerprint',
        'device_id', 'session', 'session_hash', 'email',
    }

    def test_no_analytics_model_holds_a_personal_column(self):
        from django.apps import apps

        models = list(apps.get_app_config('analytics').get_models())
        self.assertGreaterEqual(len(models), 7)
        for model in models:
            names = {f.name for f in model._meta.get_fields()}
            self.assertFalse(
                names & self.BANNED, f'{model.__name__} has {names & self.BANNED}'
            )
            for field in model._meta.get_fields():
                related = getattr(field, 'related_model', None)
                self.assertNotEqual(
                    related, User, f'{model.__name__}.{field.name} points at an account'
                )


class RollupTests(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        # Two accounts in two DIFFERENT shards (logs_0 and logs_1), so the rollup has to read
        # across files to count them both.
        self.ann = User.objects.create(pk=7, username='ann')
        self.bob = User.objects.create(pk=1500, username='bob')
        User.objects.filter(pk__in=[7, 1500]).update(date_joined=at(DAY - dt.timedelta(days=9)))
        self.assertNotEqual(shard_for_user(7), shard_for_user(1500))

    def _fixture(self):
        log(path='/api/exercises/12/', ms=10)                         # anon view
        log(path='/api/exercises/12/', ms=30, ua=SAFARI_IPHONE,
            referer='https://www.google.com/search?q=secret')           # anon view, from Google
        log(user_id=7, path='/api/exercises/12/', ms=50)              # auth view, logs_0
        log(user_id=7, path='/api/exercises/', ms=20, query='q=[redacted]')
        log(user_id=1500, path='/api/materials/4/', ms=40)            # auth view, logs_1
        log(user_id=1500, path='/api/exercises/99/', status=404)      # not a view
        log(path='/api/exercises/12/', ua=GOOGLEBOT)                  # bot: no view
        log(path='/api/exercises/12/', status=500, ms=900)            # 5xx: no view
        log(path='/api/exercises/12/', method='OPTIONS')              # preflight: skipped
        log(path='/api/exercises/12/', when=at(DAY + dt.timedelta(days=1)))  # another day

    def test_counts_across_shards(self):
        self._fixture()
        summary = rollup_day(DAY)
        self.assertEqual(summary['rows'], 9)  # the other day's row is not read

        detail = {
            r.audience: r
            for r in DailyRouteStat.objects.filter(date=DAY, route='/api/exercises/:pk/', method='GET')
        }
        self.assertEqual(detail['anon'].requests, 3)
        self.assertEqual(detail['anon'].status_5xx, 1)
        self.assertEqual(detail['auth'].requests, 2)
        self.assertEqual(detail['auth'].status_4xx, 1)
        self.assertEqual(detail['bot'].requests, 1)
        self.assertFalse(DailyRouteStat.objects.filter(method='OPTIONS').exists())
        listing = DailyRouteStat.objects.get(date=DAY, route='/api/exercises/', audience='auth')
        self.assertEqual(listing.searches, 1)

        views = {(v.kind, v.object_id): v.views for v in DailyContentView.objects.filter(date=DAY)}
        self.assertEqual(views, {('exercise', '12'): 3, ('material', '4'): 1})

        self.assertEqual(DailyActiveUsers.objects.get(date=DAY).users, 2)
        self.assertEqual(
            list(DailyReferrer.objects.filter(date=DAY).values_list('host', 'count')),
            [('google.com', 1)],
        )
        clients = {(c.browser, c.os, c.device): c.count for c in DailyClient.objects.filter(date=DAY)}
        self.assertEqual(clients[('safari', 'ios', 'mobile')], 1)
        self.assertEqual(clients[('bot', 'other', 'bot')], 1)

    def test_percentiles_per_bucket(self):
        for ms in range(1, 21):
            log(path='/api/exercises/', ms=ms)
        rollup_day(DAY)
        row = DailyRouteStat.objects.get(date=DAY, route='/api/exercises/', audience='anon')
        self.assertEqual((row.p50_ms, row.p95_ms), (10, 19))

    def test_opted_out_rows_reach_no_table(self):
        """`Sec-GPC: 1` / `DNT: 1` — an Art. 21 objection. The rows exist (security log) and are
        counted as skipped, and not one of them shows up in any statistic."""
        log(user_id=7, path='/api/exercises/12/', opt_out=True,
            referer='https://news.example.com/a')
        log(path='/api/materials/4/', opt_out=True, ua=SAFARI_IPHONE)
        rollup_day(DAY)
        self.assertFalse(DailyRouteStat.objects.filter(date=DAY).exists())
        self.assertFalse(DailyContentView.objects.filter(date=DAY).exists())
        self.assertFalse(DailyReferrer.objects.filter(date=DAY).exists())
        self.assertFalse(DailyClient.objects.filter(date=DAY).exists())
        self.assertEqual(DailyActiveUsers.objects.get(date=DAY).users, 0)
        run = RollupRun.objects.get(date=DAY)
        self.assertEqual((run.rows_read, run.rows_skipped_opt_out), (0, 2))
        rollup_week(DAY)
        self.assertFalse(WeeklyCohort.objects.exists())

    def test_rerun_is_idempotent_and_recounts(self):
        """Delete-and-recount: the same day twice gives the same rows, and a changed source gives
        the changed answer rather than an accumulation (house rule 5)."""
        self._fixture()
        rollup_day(DAY)
        first = sorted(DailyRouteStat.objects.filter(date=DAY).values_list('route', 'audience', 'requests'))
        rollup_day(DAY)
        self.assertEqual(
            sorted(DailyRouteStat.objects.filter(date=DAY).values_list('route', 'audience', 'requests')),
            first,
        )
        self.assertEqual(DailyActiveUsers.objects.filter(date=DAY).count(), 1)
        self.assertEqual(RollupRun.objects.filter(date=DAY).count(), 1)

        RequestLog.objects.using(shard_for_user(1500)).filter(user_id=1500).delete()
        rollup_day(DAY)
        self.assertEqual(DailyActiveUsers.objects.get(date=DAY).users, 1)
        self.assertFalse(DailyContentView.objects.filter(kind='material').exists())

    def test_weekly_cohorts_store_counts_by_signup_week(self):
        carol = User.objects.create(pk=8, username='carol')
        User.objects.filter(pk=8).update(date_joined=at(DAY))
        log(user_id=7)
        log(user_id=1500)
        log(user_id=1500, when=at(DAY + dt.timedelta(days=1)))
        log(user_id=carol.pk)
        rollup_week(DAY)
        week = DAY - dt.timedelta(days=DAY.weekday())
        rows = dict(WeeklyCohort.objects.filter(week=week).values_list('cohort_week', 'users'))
        self.assertEqual(rows, {week - dt.timedelta(days=7): 2, week: 1})

    def test_minors_are_never_counted_as_active_or_in_a_cohort(self):
        """ANALYTICS-LAW.md §3 row 5: a minor's account (flagged, or created by a guardian) is in
        no active-account count and no cohort. Their requests still count as requests."""
        from accounts.models import Guardianship

        flagged = User.objects.create(pk=21, username='kid1')
        flagged.profile.is_minor = True
        flagged.profile.save(update_fields=['is_minor'])
        guarded = User.objects.create(pk=22, username='kid2')
        Guardianship.objects.create(guardian=self.ann, child=guarded)
        for pk in (7, 21, 22):
            log(user_id=pk, path='/api/exercises/12/')
        rollup_day(DAY)
        rollup_week(DAY)
        self.assertEqual(DailyActiveUsers.objects.get(date=DAY).users, 1)
        self.assertEqual(sum(WeeklyCohort.objects.values_list('users', flat=True)), 1)
        self.assertEqual(DailyContentView.objects.get(date=DAY).views, 3)

    def test_staff_are_not_counted_as_people_but_their_requests_count(self):
        """Owner's decision 2026-10-14: staff (is_staff or is_superuser) are in no people-count —
        active accounts, cohorts — while their requests stay in the traffic figures."""
        User.objects.filter(pk=7).update(is_staff=True)
        User.objects.filter(pk=1500).update(is_superuser=True)
        carol = User.objects.create(pk=9, username='carol')
        User.objects.filter(pk=9).update(date_joined=at(DAY))  # a cohort no later than DAY's week
        for pk in (7, 1500, carol.pk):
            log(user_id=pk, path='/api/exercises/12/')
        rollup_day(DAY)
        rollup_week(DAY)
        self.assertEqual(DailyActiveUsers.objects.get(date=DAY).users, 1)
        self.assertEqual(sum(WeeklyCohort.objects.values_list('users', flat=True)), 1)
        auth = DailyRouteStat.objects.get(date=DAY, route='/api/exercises/:pk/', audience='auth')
        self.assertEqual(auth.requests, 3)
        self.assertEqual(DailyContentView.objects.get(date=DAY).views, 3)

    def test_registrations_and_funnel_leave_staff_out(self):
        from .live import accounts, contribution_funnel

        start, end = at(DAY, 0), at(DAY + dt.timedelta(days=1), 0)
        for pk, staff in ((31, False), (32, True)):
            User.objects.create(pk=pk, username=f'r{pk}', is_staff=staff)
        User.objects.filter(pk__in=[31, 32]).update(date_joined=at(DAY))
        self.assertEqual(accounts(start, end)['registered'], 1)
        self.assertEqual(contribution_funnel(start, end)['registered'], 1)

    def test_demo_accounts_are_not_people_but_their_requests_count(self):
        """2026-10-15: the demo conference's ~165 seeded attendees read on the live dashboard as a
        week of 176 registrations, a cohort of 165 at 0 % and a funnel nobody moved through. An
        `@edmat.example` account — or a pupil whose guardian holds one — is in no people-count."""
        from accounts.models import Guardianship

        from .live import accounts, contribution_funnel

        start, end = at(DAY, 0), at(DAY + dt.timedelta(days=1), 0)
        real = User.objects.create(pk=41, username='dana', email='dana@example.org')
        demo = User.objects.create(pk=42, username='conf.attendee.001', email='conf.attendee.001@edmat.example')
        guardian = User.objects.create(pk=43, username='school.parent', email='school.parent@EDMAT.example')
        pupil = User.objects.create(pk=44, username='school.pupil', email='')
        Guardianship.objects.create(guardian=guardian, child=pupil)
        User.objects.filter(pk__in=[41, 42, 43, 44]).update(date_joined=at(DAY))
        for pk in (real.pk, demo.pk):
            log(user_id=pk, path='/api/exercises/12/')
        rollup_day(DAY)
        rollup_week(DAY)
        self.assertEqual(DailyActiveUsers.objects.get(date=DAY).users, 1)
        self.assertEqual(sum(WeeklyCohort.objects.values_list('users', flat=True)), 1)
        auth = DailyRouteStat.objects.get(date=DAY, route='/api/exercises/:pk/', audience='auth')
        self.assertEqual(auth.requests, 2, 'a demo account\'s requests are still traffic')
        counted = accounts(start, end)
        self.assertEqual(counted['registered'], 1)
        self.assertEqual(counted['guardian_created'], 0)
        self.assertEqual(contribution_funnel(start, end)['registered'], 1)

    def test_aggregates_older_than_25_months_are_purged(self):
        from .rollup import months_before, purge_aggregates

        self.assertEqual(months_before(dt.date(2026, 10, 14), 25), dt.date(2024, 9, 14))
        self.assertEqual(months_before(dt.date(2026, 3, 31), 1), dt.date(2026, 2, 28))
        old, kept = dt.date(2024, 9, 13), dt.date(2024, 9, 14)
        for day in (old, kept):
            DailyActiveUsers.objects.create(date=day, users=3)
            DailyContentView.objects.create(date=day, kind='exercise', object_id='1', views=2)
            WeeklyCohort.objects.create(week=day, cohort_week=day, users=1)
        self.assertEqual(purge_aggregates(dt.date(2026, 10, 14)), 3)
        self.assertEqual(list(DailyActiveUsers.objects.values_list('date', flat=True)), [kept])

    def test_the_command_rolls_up_a_range(self):
        log(path='/api/exercises/12/')
        log(path='/api/exercises/12/', when=at(DAY - dt.timedelta(days=1)))
        call_command('rollup_analytics', '--date', DAY.isoformat(), '--days', '2', verbosity=0)
        self.assertEqual(RollupRun.objects.count(), 2)
        self.assertEqual(
            sum(DailyContentView.objects.values_list('views', flat=True)), 2
        )


class PolishDayTests(TestCase):
    """A day is a Polish calendar day (`settings.TIME_ZONE`, since 2026-10-15): it starts at Polish
    midnight, and is 23 or 25 hours long on the nights the clocks change."""

    databases = set(all_log_shards()) | {'default'}

    def test_a_day_runs_from_polish_midnight_to_polish_midnight(self):
        start, end = day_bounds(DAY)
        utc = dt.timezone.utc
        self.assertEqual(start, dt.datetime(2026, 10, 6, 22, tzinfo=utc))
        self.assertEqual(end, dt.datetime(2026, 10, 7, 22, tzinfo=utc))

    def test_the_days_the_clocks_change_are_23_and_25_hours(self):
        def hours(day):
            start, end = day_bounds(day)
            return (end - start).total_seconds() / 3600

        self.assertEqual(hours(dt.date(2027, 3, 28)), 23)
        self.assertEqual(hours(dt.date(2026, 10, 25)), 25)
        self.assertEqual(hours(DAY), 24)

    def test_one_polish_week_is_one_week(self):
        """Monday's bounds start at 22:00 UTC on the Sunday before; the week list must still be
        that one Monday, not the Sunday's week as well."""
        from .live import week_starts

        monday = DAY - dt.timedelta(days=DAY.weekday())
        start, _ = day_bounds(monday)
        _, end = day_bounds(monday + dt.timedelta(days=6))
        self.assertEqual(week_starts(start, end), [monday])

    def test_a_request_after_polish_midnight_counts_on_the_polish_day(self):
        """23:30 UTC on 6 October is 01:30 on 7 October in Warsaw: a reader in Poland did that on
        the 7th, and so does the dashboard. A UTC bucket put it on the 6th."""
        log(path='/api/exercises/12/', when=dt.datetime(2026, 10, 6, 23, 30, tzinfo=dt.timezone.utc))
        log(path='/api/exercises/12/', when=dt.datetime(2026, 10, 7, 21, 30, tzinfo=dt.timezone.utc))
        log(path='/api/exercises/12/', when=dt.datetime(2026, 10, 7, 22, 30, tzinfo=dt.timezone.utc))
        rollup_day(DAY)
        self.assertEqual(DailyContentView.objects.get(date=DAY).views, 2)


class ApiTestCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}


class AccessTests(ApiTestCase):
    ENDPOINTS = ('overview', 'traffic', 'content', 'community', 'moderation', 'coverage',
                 'cohorts', 'clients', 'health')

    def test_staff_only_like_the_mail_tab(self):
        """401 without credentials, 403 for an account that is not staff (a node governor is not
        staff either), 200 for staff — the shape the Mail tab's API answers with."""
        plain = make_user('plain')
        staff = make_user('staffer', is_staff=True)
        for endpoint in self.ENDPOINTS:
            url = f'/api/analytics/{endpoint}/'
            with self.subTest(endpoint=endpoint):
                self.client.force_authenticate(None)
                self.assertEqual(self.client.get(url).status_code, 401)
                self.client.force_authenticate(plain)
                self.assertEqual(self.client.get(url).status_code, 403)
                self.client.force_authenticate(staff)
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_recompute_is_staff_only(self):
        self.client.force_authenticate(make_user('plain2'))
        self.assertEqual(self.client.post('/api/analytics/recompute/').status_code, 403)
        self.client.force_authenticate(make_user('staff2', is_staff=True))
        response = self.client.post('/api/analytics/recompute/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['days']), 2)

    def test_days_must_be_an_offered_period(self):
        self.client.force_authenticate(make_user('staff3', is_staff=True))
        self.assertEqual(self.client.get('/api/analytics/overview/?days=7').status_code, 200)
        response = self.client.get('/api/analytics/overview/?days=12')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['detail'], 'days_not_allowed')


class PayloadTests(ApiTestCase):
    def setUp(self):
        self.staff = make_user('analyst', is_staff=True)
        self.client.force_authenticate(self.staff)
        self.today = timezone.localdate()

    def test_people_counts_below_five_are_null_content_counts_are_not(self):
        for pk in (11, 12, 13):
            User.objects.create(pk=pk, username=f'u{pk}')
            log(user_id=pk, path='/api/exercises/3/', when=at(self.today, 0))
        rollup_day(self.today)
        body = self.client.get('/api/analytics/overview/?days=7').json()
        today = next(d for d in body['daily'] if d['date'] == self.today.isoformat())
        self.assertIsNone(today['active_users'], 'three people is below k and must not be shown')
        self.assertEqual(today['views'], 3, 'views of public content are not people')
        self.assertIsNone(body['kpis']['peak_daily_active_users']['value'])

    def test_referrer_hosts_seen_rarely_are_not_named(self):
        for _ in range(10):
            log(referer='https://often.example.com/x', when=at(self.today, 0))
        log(referer='https://intranet.private-school.example/doc/42', when=at(self.today, 0))
        rollup_day(self.today)
        body = self.client.get('/api/analytics/clients/?days=7').json()
        self.assertEqual(body['referrers'], [{'host': 'often.example.com', 'count': 10}])
        self.assertEqual(body['referrers_other'], 1)
        self.assertNotIn('private-school', str(body))

    def test_health_names_request_ids_never_people(self):
        row = log(user_id=None, path='/api/exercises/3/', status=500, when=timezone.now())
        RequestLog.objects.using('logs_anon').filter(pk=row.pk).update(request_id='req-500-abc')
        text = self.client.get('/api/analytics/health/').content.decode()
        self.assertIn('req-500-abc', text)
        self.assertIn('/api/exercises/:pk/', text)
        self.assertNotIn('203.0.113.9', text)
        self.assertNotIn('Windows NT', text)

    def test_every_registered_queue_and_feature_answers(self):
        """The registries are the extension point; an entry whose model or field is wrong is
        skipped silently at runtime — so it is caught here instead."""
        from .live import COMMUNITY_REGISTRY, FEATURE_REGISTRY, QUEUE_REGISTRY

        community = self.client.get('/api/analytics/community/').json()
        self.assertEqual(set(community['features']), set(FEATURE_REGISTRY))
        self.assertEqual(set(community['activity']), set(COMMUNITY_REGISTRY))
        queues = self.client.get('/api/analytics/moderation/').json()['queues']
        self.assertEqual({q['queue'] for q in queues}, set(QUEUE_REGISTRY))

    def test_content_lists_only_published_exercises(self):
        from testing.factories import make_branch, make_exercise

        branch = make_branch()
        shown = make_exercise(branch, 1)
        hidden = make_exercise(branch, 2)
        hidden.published = False
        hidden.save(update_fields=['published'])
        for exercise in (shown, hidden):
            log(path=f'/api/exercises/{exercise.pk}/', when=at(self.today, 0))
        rollup_day(self.today)
        body = self.client.get('/api/analytics/content/?days=7').json()
        self.assertEqual([e['id'] for e in body['top_exercises']], [str(shown.pk)])
        self.assertEqual(body['by_kind'], [{'kind': 'exercise', 'views': 2}])


class ArrivedWithTheExerciseTests(ApiTestCase):
    """A batch import is not community activity (2026-10-15: paczka2's 214 exercises showed on the
    live dashboard as 214 submitted translations and 428 submitted hints and solutions). What came
    with an exercise is the exercise; only what was ADDED to it counts as a submission."""

    def setUp(self):
        from exercises.models import ExerciseTranslation, SolutionEntry
        from testing.factories import make_branch, make_exercise

        self.client.force_authenticate(make_user('analyst', is_staff=True))
        author, reader = make_user('importer'), make_user('reader')
        branch = make_branch()
        # Two hours old, so nothing written now is "with" it by the clock.
        older = make_exercise(branch, 1)
        type(older).objects.filter(pk=older.pk).update(
            created_at=timezone.now() - dt.timedelta(hours=2)
        )
        fresh = make_exercise(branch, 2)
        # `import_exercises`' shape: pinned, published, nobody reviewed it.
        for kind in ('hint', 'solution'):
            SolutionEntry.objects.create(
                exercise=older, kind=kind, locale='pl', body='x', author=author,
                status='published', pinned=True,
            )
        # An approved submission's fast path: unpinned, but written with the exercise.
        SolutionEntry.objects.create(
            exercise=fresh, kind='solution', locale='pl', body='x', author=author,
            status='published',
        )
        # The two real contributions: a hint added to the older exercise, and a translation.
        SolutionEntry.objects.create(
            exercise=older, kind='hint', locale='pl', body='a later idea', author=reader,
        )
        ExerciseTranslation.objects.create(
            exercise=older, locale='en', title='T', statement='S', translated_by=reader,
        )

    def test_queues_count_only_what_was_added(self):
        queues = {
            q['queue']: q
            for q in self.client.get('/api/analytics/moderation/?days=7').json()['queues']
        }
        self.assertEqual(queues['solution_entries']['submitted'], 1)
        self.assertEqual(queues['translations']['submitted'], 1)

    def test_community_activity_and_the_kpi_agree(self):
        activity = self.client.get('/api/analytics/community/?days=7').json()['activity']
        self.assertEqual(activity['solution_entries']['period_total'], 1)
        self.assertEqual(activity['translations']['period_total'], 1)
        kpis = self.client.get('/api/analytics/overview/?days=7').json()['kpis']
        self.assertEqual(kpis['submissions']['value'], 2)
