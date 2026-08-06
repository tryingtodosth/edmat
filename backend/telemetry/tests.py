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
