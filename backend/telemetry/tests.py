"""Tests for the activity log.

Two of these are unusual and worth flagging: `test_no_visitor_fingerprint` pins a LEGAL boundary
rather than a behaviour (see models.py — deriving a persistent visitor id from request data would
put this back inside the cookie-consent rules it currently sits outside), and the redaction tests
pin what must NEVER be written, which is the kind of property that only fails silently.
"""

import ipaddress

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from telemetry.management.commands.enforce_log_retention import (
    pseudonymise_actor,
    truncate_ip,
)
from telemetry.middleware import client_ip, redact_query_string
from telemetry.models import AuditEvent, RequestLog
from telemetry.routers import all_log_shards, shard_for_user

User = get_user_model()


class ShardAssignmentTests(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def test_anonymous_traffic_goes_to_its_own_shard(self):
        self.assertEqual(shard_for_user(None), 'logs_anon')
        self.assertEqual(shard_for_user(0), 'logs_anon')

    @override_settings(LOG_SHARD_SIZE=1000, LOG_SHARD_COUNT=8)
    def test_shard_is_integer_division_not_modulo(self):
        """The property the whole design rests on: adding shards must never move an existing user.

        With `user_id // SIZE`, user 1 is in shard 0 and user 1500 in shard 1 regardless of how many
        shards exist. With `% count` both would move the moment the count changed — which for an
        audit log means rewriting the history you keep precisely so it cannot be rewritten.
        """
        self.assertEqual(shard_for_user(1), 'logs_0')
        self.assertEqual(shard_for_user(999), 'logs_0')
        self.assertEqual(shard_for_user(1000), 'logs_1')
        self.assertEqual(shard_for_user(1500), 'logs_1')
        with override_settings(LOG_SHARD_COUNT=64):
            self.assertEqual(shard_for_user(1), 'logs_0')
            self.assertEqual(shard_for_user(1500), 'logs_1')

    @override_settings(LOG_SHARD_SIZE=1000, LOG_SHARD_COUNT=2)
    def test_past_capacity_raises_rather_than_wrapping(self):
        """Silently folding user 9000 back into shard 0 would mix two users' records together."""
        with self.assertRaises(ValueError):
            shard_for_user(9000)

    def test_rows_land_in_the_shard_their_user_belongs_to(self):
        RequestLog.objects.using(shard_for_user(5)).create(
            user_id=5, method='GET', path='/api/exercises/', status_code=200, duration_ms=12,
            request_id='r1',
        )
        RequestLog.objects.using(shard_for_user(None)).create(
            user_id=None, method='GET', path='/api/fields/', status_code=200, duration_ms=8,
            request_id='r2',
        )
        self.assertEqual(RequestLog.objects.using('logs_0').count(), 1)
        self.assertEqual(RequestLog.objects.using('logs_anon').count(), 1)
        # The point of the split: neither shard can see the other's rows.
        self.assertEqual(RequestLog.objects.using('logs_0').filter(user_id=None).count(), 0)


class RedactionTests(TestCase):
    def test_search_terms_are_never_written(self):
        """What somebody searched for is their content, and more revealing than their IP."""
        redacted = redact_query_string('/api/exercises/', 'q=cauchy+schwarz&difficulty=hard')
        self.assertIn('q=[redacted]', redacted)
        self.assertNotIn('cauchy', redacted)
        # Non-content parameters survive, because they are what makes a log useful for debugging.
        self.assertIn('difficulty=hard', redacted)

    def test_auth_paths_drop_the_query_string_entirely(self):
        """A credential mistakenly sent as a GET parameter must not be written down in clear text."""
        self.assertEqual(redact_query_string('/api/auth/login/', 'password=hunter2'), '')

    def test_ordinary_query_strings_are_kept(self):
        self.assertEqual(
            redact_query_string('/api/exercises/', 'branch=am2&lang=pl'), 'branch=am2&lang=pl'
        )


class ClientIpTests(TestCase):
    class _Request:
        def __init__(self, **meta):
            self.META = meta

    def test_forwarded_header_is_ignored_at_the_default_zero_hops(self):
        """The default is 0 hops, and X-Forwarded-For must then be ignored COMPLETELY.

        This is the real deployment's configuration: Apache runs Django under embedded mod_wsgi,
        not behind a `ProxyPass`, so nothing appends a trustworthy entry to this header and every
        value in it — including the rightmost — is whatever the caller chose to send. Honouring any
        part of it would let a caller forge the address recorded in the audit log, and (through
        DRF's matching `NUM_PROXIES`) mint an unlimited number of throttle buckets.
        """
        request = self._Request(
            HTTP_X_FORWARDED_FOR='1.2.3.4, 203.0.113.9', REMOTE_ADDR='198.51.100.7'
        )
        self.assertEqual(client_ip(request), '198.51.100.7')

    def test_a_lone_spoofed_entry_is_ignored_too(self):
        """The single-entry case is the one most likely to look trustworthy, and isn't."""
        request = self._Request(HTTP_X_FORWARDED_FOR='9.9.9.9', REMOTE_ADDR='198.51.100.7')
        self.assertEqual(client_ip(request), '198.51.100.7')

    @override_settings(EDMAT_TRUSTED_PROXY_HOPS=1)
    def test_rightmost_forwarded_entry_wins_when_a_proxy_really_exists(self):
        """With a genuine proxy in front, the rightmost entry is the one IT wrote.

        Kept as a real test because the hop-counting logic still has to be correct for the day a
        CDN or load balancer is genuinely added — it is the DEFAULT that changed, not the
        behaviour at a given hop count. A proxy appends to whatever the caller sent, so the
        leftmost entries stay attacker-controlled and only the rightmost is trustworthy.
        """
        request = self._Request(
            HTTP_X_FORWARDED_FOR='1.2.3.4, 203.0.113.9', REMOTE_ADDR='127.0.0.1'
        )
        self.assertEqual(client_ip(request), '203.0.113.9')

    def test_falls_back_to_remote_addr_without_a_proxy(self):
        self.assertEqual(client_ip(self._Request(REMOTE_ADDR='198.51.100.4')), '198.51.100.4')


class RetentionTests(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def test_ipv4_truncates_to_slash_24(self):
        self.assertEqual(truncate_ip('203.0.113.47'), '203.0.113.0')

    def test_ipv6_truncates_to_slash_48(self):
        self.assertEqual(truncate_ip('2001:db8:1234:5678::1'), '2001:db8:1234::')

    def test_unparseable_address_is_cleared_not_kept(self):
        """Failing open here would silently retain full precision past the window."""
        self.assertIsNone(truncate_ip('not-an-address'))

    def test_expired_rows_are_deleted_and_old_ones_truncated(self):
        from django.core.management import call_command

        old = timezone.now() - timezone.timedelta(days=200)
        recent = timezone.now() - timezone.timedelta(days=45)
        for created, ip in ((old, '203.0.113.1'), (recent, '203.0.113.2')):
            row = RequestLog.objects.using('logs_anon').create(
                method='GET', path='/', status_code=200, duration_ms=1, request_id='x',
                ip_address=ip,
            )
            RequestLog.objects.using('logs_anon').filter(pk=row.pk).update(created_at=created)

        call_command('enforce_log_retention', verbosity=0)

        rows = list(RequestLog.objects.using('logs_anon').all())
        self.assertEqual(len(rows), 1, 'the 200-day-old row should be gone entirely')
        self.assertTrue(rows[0].ip_truncated)
        self.assertEqual(rows[0].ip_address, '203.0.113.0')

    def test_truncation_is_idempotent(self):
        """A daily run must not keep rewriting history it already processed."""
        from django.core.management import call_command

        row = RequestLog.objects.using('logs_anon').create(
            method='GET', path='/', status_code=200, duration_ms=1, request_id='x',
            ip_address='203.0.113.1',
        )
        RequestLog.objects.using('logs_anon').filter(pk=row.pk).update(
            created_at=timezone.now() - timezone.timedelta(days=45)
        )
        call_command('enforce_log_retention', verbosity=0)
        call_command('enforce_log_retention', verbosity=0)
        self.assertEqual(
            RequestLog.objects.using('logs_anon').get(pk=row.pk).ip_address, '203.0.113.0'
        )

    def test_account_deletion_keeps_the_decision_and_drops_the_person(self):
        """Erasing the events instead would let anyone escape review of their own moderation by
        closing their account — the exact outcome the appeal process exists to prevent."""
        shard = shard_for_user(7)
        AuditEvent.objects.using(shard).create(
            actor_id=7, actor_label='kasia', action='moderation_decision',
            summary='Approved submission 42', ip_address='203.0.113.5',
        )
        pseudonymise_actor(7)
        event = AuditEvent.objects.using(shard).get()
        self.assertIsNone(event.actor_id)
        self.assertIsNone(event.ip_address)
        self.assertEqual(event.actor_label, '[deleted account]')
        self.assertEqual(event.summary, 'Approved submission 42')


class ConsentBoundaryTests(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def test_no_visitor_fingerprint(self):
        """Pins a LEGAL boundary, not just a behaviour.

        Everything logged here is collected without consent because it is server-side processing
        under legitimate interest, not storage on the visitor's device. Deriving a stable identifier
        for a returning anonymous visitor out of these same fields would be device fingerprinting,
        which the EDPB's Guidelines 2/2023 place back inside ePrivacy Art. 5(3) — consent required,
        no cookie involved. `request_id` is therefore random per REQUEST; if a future change makes it
        (or any added field) a function of the visitor rather than the request, this fails.
        """
        rows = [
            RequestLog.objects.using('logs_anon').create(
                method='GET', path='/', status_code=200, duration_ms=1,
                ip_address='203.0.113.1',
                user_agent='Mozilla/5.0 (identical browser)',
                request_id=f'request-{index}',
            )
            for index in range(2)
        ]
        # Same visitor, same browser, two requests — and nothing stored links them to each other.
        self.assertNotEqual(rows[0].request_id, rows[1].request_id)

        identifying_fields = {f.name for f in RequestLog._meta.get_fields()}
        for banned in ('visitor_id', 'fingerprint', 'device_id', 'session_hash'):
            self.assertNotIn(
                banned,
                identifying_fields,
                f'{banned} would make this a fingerprint and require a consent banner',
            )

    def test_ip_is_the_only_directly_identifying_field(self):
        """Anything else identifying would need its own entry in the privacy policy and its own
        retention rule; this fails loudly if a field is added without that conversation."""
        stored = {f.name for f in RequestLog._meta.get_fields()}
        expected = {
            'id', 'user_id', 'ip_address', 'ip_truncated', 'method', 'path', 'query_string',
            'status_code', 'duration_ms', 'user_agent', 'referer', 'request_id', 'was_throttled',
            'created_at',
        }
        self.assertEqual(
            stored, expected,
            'RequestLog gained or lost a field — update the privacy policy and the retention rules',
        )


class AnonymousReadCacheTests(TestCase):
    """config/cachemw.py — the earn-your-slot admission and, above all, the security gates.

    Runs on the test settings' LocMemCache: the middleware speaks Django's cache API only, so the
    backend (file, locmem, Redis) is configuration, and what these pin is the logic every backend
    shares. The one thing they must do that most tests here don't: clear the cache per test, since
    LocMem persists across tests in one process and admission counters would leak between them.
    """

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        from taxonomy.models import Discipline, DisciplineTranslation

        d = Discipline.objects.create(slug='cache-test-disc')
        DisciplineTranslation.objects.create(discipline=d, locale='pl', name='X', description='y')

    def test_admission_takes_two_requests_then_serves_hits(self):
        first = self.client.get('/api/disciplines/')
        self.assertEqual(first['X-EdMat-Cache'], 'miss')
        second = self.client.get('/api/disciplines/')
        self.assertEqual(second['X-EdMat-Cache'], 'stored')
        third = self.client.get('/api/disciplines/')
        self.assertEqual(third['X-EdMat-Cache'], 'hit')
        self.assertEqual(third.content, first.content)

    def test_an_authorization_header_disqualifies_the_request_entirely(self):
        """The security gate: any credential means no shared cache, in either direction — the
        response is neither served from it nor stored into it, no matter how often it repeats."""
        from rest_framework.authtoken.models import Token

        token = Token.objects.create(user=User.objects.create_user('cache-auth', password='x'))
        from config.cachemw import cache_key

        for _ in range(4):
            response = self.client.get(
                '/api/disciplines/', HTTP_AUTHORIZATION=f'Token {token.key}'
            )
            self.assertNotIn('X-EdMat-Cache', response)
        from django.core.cache import cache

        self.assertIsNone(cache.get(cache_key('/api/disciplines/')))

    def test_a_session_cookie_disqualifies_too(self):
        """SessionAuthentication is enabled for the browsable API, so a session-bearing GET can
        genuinely see different data (own drafts) — it must never share the anonymous cache."""
        User.objects.create_user('cache-sess', password='pw12345!')
        self.client.login(username='cache-sess', password='pw12345!')
        response = self.client.get('/api/disciplines/')
        self.assertNotIn('X-EdMat-Cache', response)

    def test_exercise_detail_is_excluded_by_its_view_count_side_effect(self):
        response = self.client.get('/api/exercises/1/')
        self.assertNotIn('X-EdMat-Cache', response)

    @override_settings(EDMAT_CACHE_BUSY_RPM=0)
    def test_under_busy_traffic_admission_needs_seven(self):
        """The owner's adaptive half: with the busy mark forced to zero every request counts as
        high-traffic, so the second refresh is no longer enough and the bar sits at 7."""
        for i in range(6):
            response = self.client.get('/api/disciplines/')
            self.assertEqual(response['X-EdMat-Cache'], 'miss', f'request {i + 1}')
        seventh = self.client.get('/api/disciplines/')
        self.assertEqual(seventh['X-EdMat-Cache'], 'stored')

    def test_preload_seats_responses_ahead_of_any_admission(self):
        from django.core.management import call_command

        call_command('preload_cache', '--top', '5', verbosity=0)
        response = self.client.get('/api/disciplines/')
        self.assertEqual(response['X-EdMat-Cache'], 'hit')

    def test_preload_reads_the_anonymous_log_shard(self):
        from django.conf import settings as s
        from django.core.management import call_command

        RequestLog.objects.using(s.LOG_ANON_SHARD).create(
            method='GET', path='/api/materials/', status_code=200, duration_ms=1, request_id='r1'
        )
        call_command('preload_cache', verbosity=0)
        response = self.client.get('/api/materials/')
        self.assertEqual(response['X-EdMat-Cache'], 'hit')
