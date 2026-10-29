"""The browser error beacon's server half (`client_errors.py`, `ingest.py`) and its staff read.

Several of these pin a PRIVACY property, not a behaviour, and must not be "fixed" by loosening
them: the field allowlist, URL stripping, the GPC/DNT drop, and the absence of any IP, User-Agent
or account column (`test_no_personal_column`).
"""

import datetime as dt
import io
import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user

from . import client_errors
from .models import ClientErrorGroup, ClientErrorReport, DailyClientError

User = get_user_model()

URL = '/api/client-errors/'
FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'
STACK = (
    'TypeError: x is undefined\n'
    '    at render (https://edmat.net/_app/immutable/nodes/12.Bx3k9_aZ.js?v=3#frag:10:5)\n'
    '    at https://edmat.net/_app/immutable/entry/app.Q1w2E3r4.js:1:200\n'
)


def report(**over):
    body = {
        'kind': 'error',
        'message': 'x is undefined at id 4711',
        'stack': STACK,
        'route': '/exercises/[id]',
        'build': '1760450000000',
        'locale': 'pl',
    }
    body.update(over)
    return body


class IngestBase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        cache.clear()

    def send(self, body, **headers):
        raw = body if isinstance(body, (bytes, str)) else json.dumps(body)
        return self.client.generic(
            'POST', URL, raw, content_type='text/plain;charset=UTF-8',
            HTTP_USER_AGENT=FIREFOX, **headers,
        )


class SanitizeTests(TestCase):
    def test_urls_in_a_stack_lose_origin_query_and_fragment(self):
        out = client_errors.strip_urls(STACK)
        self.assertNotIn('edmat.net', out)
        self.assertNotIn('?v=3', out)
        self.assertNotIn('#frag', out)
        self.assertIn('(/_app/immutable/nodes/12.Bx3k9_aZ.js', out)
        self.assertIn('/_app/immutable/entry/app.Q1w2E3r4.js:1:200', out)

    def test_a_concrete_route_has_its_ids_masked_and_junk_is_unknown(self):
        self.assertEqual(client_errors.clean_route('/exercises/[id]'), '/exercises/[id]')
        self.assertEqual(client_errors.clean_route('/exercises/123'), '/exercises/[n]')
        self.assertEqual(client_errors.clean_route('/search?q=secret'), client_errors.UNKNOWN_ROUTE)
        self.assertEqual(client_errors.clean_route('https://x/y'), client_errors.UNKNOWN_ROUTE)
        self.assertEqual(client_errors.clean_route(42), client_errors.UNKNOWN_ROUTE)

    def test_control_characters_and_lengths(self):
        out = client_errors.sanitize(report(message='a\x00b\x1b[31mc' + 'x' * 2000, stack='y' * 9000))
        self.assertEqual(out['message'][:5], 'ab[31')
        self.assertEqual(len(out['message']), client_errors.MAX_MESSAGE)
        self.assertEqual(len(out['stack']), client_errors.MAX_STACK)

    def test_the_signature_ignores_numbers_line_numbers_and_chunk_hashes(self):
        a = client_errors.sanitize(report())
        b = client_errors.sanitize(
            report(message='x is undefined at id 99', stack=STACK.replace('Bx3k9_aZ', 'Zz9y8x7w').replace(':10:5', ':11:7'))
        )
        self.assertEqual(client_errors.signature_of(a)[0], client_errors.signature_of(b)[0])
        c = client_errors.sanitize(report(message='something else'))
        # Only whole numbers are masked; a digit inside a word is part of the word.
        self.assertEqual(
            client_errors.normalise_message('e2e-run 9235: Uint8Array id 4711'),
            'e2e-run N: Uint8Array id N',
        )
        self.assertNotEqual(client_errors.signature_of(a)[0], client_errors.signature_of(c)[0])


class IngestTests(IngestBase):
    def test_only_allowlisted_fields_are_kept(self):
        response = self.send(
            report(user_id=7, token='abc', url='https://edmat.net/exercises/12?q=x', referrer='r',
                   screen='1920x1080', breadcrumbs=['click'])
        )
        self.assertEqual(response.status_code, 204)
        stored = ClientErrorReport.objects.get()
        self.assertEqual(stored.route, '/exercises/[id]')
        self.assertEqual(stored.locale, 'pl')
        self.assertEqual(stored.build, '1760450000000')
        self.assertEqual((stored.browser, stored.os, stored.device), ('firefox', 'linux', 'desktop'))
        self.assertNotIn('edmat.net', stored.stack)
        flat = json.dumps(
            {f.name: str(getattr(stored, f.attname)) for f in ClientErrorReport._meta.concrete_fields}
        )
        for leaked in ('abc', '1920', 'click', '?q=x', 'Gecko', '127.0.0.1'):
            self.assertNotIn(leaked, flat)
        group = ClientErrorGroup.objects.get()
        self.assertEqual(group.message, 'x is undefined at id N')
        self.assertEqual(DailyClientError.objects.get().count, 1)

    def test_a_signed_in_callers_token_is_never_read(self):
        # A token that does not exist: TokenAuthentication would answer 401 for it, so a 204 is the
        # proof that nothing read it. (A valid token answered 204 either way, and no stored column
        # records the user, so that version could not fail.)
        response = self.send(report(), HTTP_AUTHORIZATION='Token not-a-real-token')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(ClientErrorReport.objects.count(), 1)

    def test_gpc_and_dnt_drop_the_report(self):
        self.assertEqual(self.send(report(), HTTP_SEC_GPC='1').status_code, 204)
        self.assertEqual(self.send(report(), HTTP_DNT='1').status_code, 204)
        self.assertFalse(ClientErrorGroup.objects.exists())
        self.assertFalse(ClientErrorReport.objects.exists())

    def test_the_kill_switch_drops_the_report(self):
        FeatureFlag.objects.update_or_create(key='client_errors', defaults={'is_enabled': False})
        self.assertEqual(self.send(report()).status_code, 204)
        self.assertFalse(ClientErrorGroup.objects.exists())

    def test_bad_kind_empty_message_and_script_error_are_dropped(self):
        self.send(report(kind='warning'))
        self.send(report(message=''))
        self.send(report(message='Script error.', stack=''))
        self.assertFalse(ClientErrorGroup.objects.exists())

    def test_body_cap_and_garbage(self):
        big = json.dumps(report(stack='x' * (client_errors.MAX_BODY_BYTES + 10)))
        self.assertEqual(self.send(big).status_code, 413)
        self.assertEqual(self.send(b'not json').status_code, 400)
        self.assertEqual(self.send('[1, 2]').status_code, 400)
        self.assertFalse(ClientErrorGroup.objects.exists())

    def test_get_is_not_allowed(self):
        self.assertEqual(self.client.get(URL).status_code, 405)

    def test_throttled_per_ip(self):
        # DRF binds THROTTLE_RATES as a class attribute at import time, so override_settings
        # cannot reach it (accounts/test_throttling.py has the long version).
        with mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {'client_error': '3/hour'}):
            codes = [self.send(report()).status_code for _ in range(4)]
        self.assertEqual(codes, [204, 204, 204, 429])
        self.assertEqual(DailyClientError.objects.get().count, 3)

    def test_repeats_count_but_samples_are_capped(self):
        for _ in range(client_errors.SAMPLES_PER_GROUP_PER_DAY + 3):
            client_errors.record(client_errors.sanitize(report()), FIREFOX)
        self.assertEqual(ClientErrorGroup.objects.count(), 1)
        self.assertEqual(
            DailyClientError.objects.get().count, client_errors.SAMPLES_PER_GROUP_PER_DAY + 3
        )
        self.assertEqual(ClientErrorReport.objects.count(), client_errors.SAMPLES_PER_GROUP_PER_DAY)


class RetentionTests(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def test_reports_go_after_30_days_counts_and_groups_after_90(self):
        now = timezone.now()
        group = client_errors.record(client_errors.sanitize(report()), FIREFOX)
        old = ClientErrorReport.objects.create(
            group=group, received_at=now - dt.timedelta(days=31), kind='error', message='m',
            route='/', build='', browser='firefox', os='linux', device='desktop',
        )
        DailyClientError.objects.create(
            date=(now - dt.timedelta(days=91)).date(), group=group, route='/', build='',
            browser='firefox', count=5,
        )
        stale = ClientErrorGroup.objects.create(
            signature='stale', kind='error', message='old', first_seen=now - dt.timedelta(days=120),
            last_seen=now - dt.timedelta(days=95),
        )
        call_command('rollup_analytics', '--days', '1', stdout=io.StringIO())
        self.assertFalse(ClientErrorReport.objects.filter(pk=old.pk).exists())
        self.assertEqual(ClientErrorReport.objects.count(), 1)
        self.assertEqual(DailyClientError.objects.count(), 1)
        self.assertFalse(ClientErrorGroup.objects.filter(pk=stale.pk).exists())
        self.assertTrue(ClientErrorGroup.objects.filter(pk=group.pk).exists())


class StaffReadTests(IngestBase):
    URL = '/api/analytics/client-errors/'

    def test_staff_only(self):
        self.assertEqual(self.client.get(self.URL).status_code, 401)
        self.client.force_authenticate(make_user('plain'))
        self.assertEqual(self.client.get(self.URL).status_code, 403)

    def test_groups_with_series_facets_and_samples(self):
        self.send(report())
        self.send(report(message='x is undefined at id 5'))
        self.send(report(message='other', kind='rejection', route='/'))
        self.client.force_authenticate(make_user('staff', is_staff=True))
        response = self.client.get(self.URL + '?days=7')
        self.assertEqual(response.status_code, 200)
        data = response.data
        self.assertEqual(data['total'], 3)
        self.assertEqual(len(data['groups']), 2)
        top = data['groups'][0]
        self.assertEqual(top['count'], 2)
        self.assertEqual(top['message'], 'x is undefined at id N')
        self.assertEqual(len(top['daily']), 7)
        self.assertEqual(top['daily'][-1], 2)
        self.assertEqual(top['routes'], [{'name': '/exercises/[id]', 'count': 2}])
        self.assertEqual(top['browsers'], [{'name': 'firefox', 'count': 2}])
        self.assertEqual(len(top['samples']), 2)
        self.assertNotIn('edmat.net', top['samples'][0]['stack'])
        self.assertEqual(self.client.get(self.URL + '?days=3').status_code, 400)


class NoPersonalColumnTests(TestCase):
    """No error table may hold an IP, a User-Agent string, an account or a page address."""

    BANNED = {
        'ip', 'ip_address', 'user_agent', 'ua', 'user', 'user_id', 'path', 'url', 'query_string',
        'referer', 'referrer', 'request_id', 'visitor_id', 'fingerprint', 'device_id', 'session',
        'session_hash', 'email', 'token', 'cookie',
    }

    def test_no_personal_column(self):
        for model in (ClientErrorGroup, DailyClientError, ClientErrorReport):
            names = {f.name for f in model._meta.get_fields()}
            self.assertFalse(names & self.BANNED, f'{model.__name__} has {names & self.BANNED}')
            for field in model._meta.get_fields():
                self.assertNotEqual(getattr(field, 'related_model', None), User)
