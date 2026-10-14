"""Sign in with Google / Apple / Microsoft — the security properties, one by one.

Real keys are generated per run (RSA for the providers' id_tokens, EC P-256 for Apple's client
secret) and the ONLY thing mocked is `sso/http.py` — the token endpoint and the JWKS fetch. Every
signature check, claim check, state claim and browser-key comparison runs for real.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from datetime import timedelta
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlparse

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from django.contrib.auth.models import User
from django.core import mail as django_mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards

from . import providers, services
from .models import SsoAttempt, SsoIdentity, SsoLoginCode, SsoSignupTicket

FRONT = 'http://front.test'
API = 'http://api.test/api'
GOOGLE_ID = 'google-client.apps.googleusercontent.com'
MS_ID = '11111111-2222-3333-4444-555555555555'
MS_TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
APPLE_ID = 'net.edmat.signin'


def _rsa():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return key, pem


def _jwk(public_key, kid):
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(public_key, as_dict=True)
    jwk.update({'kid': kid, 'use': 'sig', 'alg': 'RS256'})
    return jwk


RSA_KEY, RSA_PEM = _rsa()
OTHER_KEY, OTHER_PEM = _rsa()
JWKS = {'keys': [_jwk(RSA_KEY.public_key(), 'k1')]}

EC_KEY = ec.generate_private_key(ec.SECP256R1())
_apple_dir = tempfile.mkdtemp(prefix='sso-test-')
APPLE_KEY_PATH = str(Path(_apple_dir) / 'AuthKey_TEST.p8')
Path(APPLE_KEY_PATH).write_bytes(
    EC_KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
)

SSO_CONFIG = {
    'google': {'client_id': GOOGLE_ID, 'client_secret': 'g-secret'},
    'microsoft': {'client_id': MS_ID, 'client_secret': 'm-secret', 'tenant': 'common'},
    'apple': {'client_id': APPLE_ID, 'team_id': 'TEAM123456', 'key_id': 'KEY1234567', 'private_key_path': APPLE_KEY_PATH},
}

ISSUERS = {
    'google': 'https://accounts.google.com',
    'apple': 'https://appleid.apple.com',
}
AUDIENCES = {'google': GOOGLE_ID, 'apple': APPLE_ID, 'microsoft': MS_ID}


def make_id_token(provider_id, nonce, *, key_pem=RSA_PEM, kid='k1', alg='RS256', **overrides):
    now = int(time.time())
    claims = {
        'iss': ISSUERS.get(provider_id) or f'https://login.microsoftonline.com/{MS_TENANT}/v2.0',
        'aud': AUDIENCES[provider_id],
        'sub': f'{provider_id}-subject-1',
        'iat': now,
        'exp': now + 600,
        'nonce': nonce,
        'email': 'ala@example.com',
        'email_verified': True,
        'name': 'Ala Kowalska',
    }
    if provider_id == 'microsoft':
        claims['tid'] = MS_TENANT
        claims.pop('email_verified')
    if provider_id == 'apple':
        claims['email_verified'] = 'true'
        claims.pop('name')
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key_pem, algorithm=alg, headers={'kid': kid})


@override_settings(EDMAT_SSO=SSO_CONFIG, EDMAT_SITE_URL=FRONT, EDMAT_SSO_API_URL=API, EDMAT_SSO_DEV_STUB_URL='')
class SsoTestCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        cache.clear()  # JWKS cache and throttle counters

    # ---- the round trip, as a browser would drive it -------------------------------------------

    def start(self, provider='google', intent='login', next_path='/exercises/1', user=None):
        if user is not None:
            self.client.force_authenticate(user)
        res = self.client.post(f'/api/auth/sso/{provider}/start/', {'intent': intent, 'next': next_path}, format='json')
        self.client.force_authenticate(None)
        self.assertEqual(res.status_code, 200, res.content)
        query = parse_qs(urlparse(res.data['authorization_url']).query)
        return query['state'][0], query['nonce'][0], res.data['browser_key'], query

    def callback(self, provider, state, id_token=None, *, params=None, method=None, jwks=JWKS, form_extra=None):
        data = params if params is not None else {'state': state, 'code': 'provider-code'}
        if form_extra:
            data = {**data, **form_extra}
        method = method or ('post' if provider == 'apple' else 'get')
        with mock.patch('sso.http.post_form', return_value={'id_token': id_token}) as post, \
                mock.patch('sso.http.get_json', return_value=jwks) as get:
            if method == 'post':
                res = self.client.post(f'/api/auth/sso/{provider}/callback/', data)
            else:
                res = self.client.get(f'/api/auth/sso/{provider}/callback/', data)
        self.assertEqual(res.status_code, 302, res.content)
        location = urlparse(res['Location'])
        self.last_post, self.last_get = post, get
        return location.scheme + '://' + location.netloc + location.path, {k: v[0] for k, v in parse_qs(location.query).items()}

    def full(self, provider='google', **overrides):
        state, nonce, key, _q = self.start(provider)
        where, query = self.callback(provider, state, make_id_token(provider, nonce, **overrides))
        return where, query, key

    def exchange(self, code, key, user=None):
        if user is not None:
            self.client.force_authenticate(user)
        res = self.client.post('/api/auth/sso/exchange/', {'code': code, 'browser_key': key}, format='json')
        self.client.force_authenticate(None)
        return res

    def complete(self, ticket, key, **fields):
        body = {
            'ticket': ticket, 'browser_key': key, 'username': 'ala', 'display_name': 'Ala',
            'birth_year': 1990, 'accept_terms': True, 'preferred_locale': 'pl', **fields,
        }
        return self.client.post('/api/auth/sso/complete/', {k: v for k, v in body.items() if v is not None}, format='json')

    def set_flag(self, key, on):
        FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': on})


class ProvidersAndFlagTests(SsoTestCase):
    def test_configured_providers_are_listed_in_order(self):
        res = self.client.get('/api/auth/sso/providers/')
        self.assertEqual([p['id'] for p in res.data['providers']], ['google', 'apple', 'microsoft'])

    def test_nothing_configured_means_no_provider(self):
        with override_settings(EDMAT_SSO={}):
            self.assertEqual(self.client.get('/api/auth/sso/providers/').data['providers'], [])
            res = self.client.post('/api/auth/sso/google/start/', {}, format='json')
            self.assertEqual(res.status_code, 404)

    def test_a_half_configured_provider_is_absent(self):
        with override_settings(EDMAT_SSO={'google': {'client_id': GOOGLE_ID}, 'apple': {'client_id': APPLE_ID, 'team_id': 'T'}}):
            self.assertEqual(self.client.get('/api/auth/sso/providers/').data['providers'], [])

    def test_a_microsoft_tenant_given_as_a_domain_is_refused_as_configuration(self):
        conf = {**SSO_CONFIG, 'microsoft': {**SSO_CONFIG['microsoft'], 'tenant': 'uw.edu.pl'}}
        with override_settings(EDMAT_SSO=conf):
            ids = [p['id'] for p in self.client.get('/api/auth/sso/providers/').data['providers']]
            self.assertNotIn('microsoft', ids)

    def test_unknown_provider_is_404(self):
        self.assertEqual(self.client.post('/api/auth/sso/github/start/', {}, format='json').status_code, 404)

    def test_flag_off_empties_the_list_and_closes_every_flow_endpoint(self):
        state, nonce, key, _q = self.start()
        self.set_flag('social_login', False)
        self.assertEqual(self.client.get('/api/auth/sso/providers/').data['providers'], [])
        self.assertEqual(self.client.post('/api/auth/sso/google/start/', {}, format='json').status_code, 404)
        self.assertEqual(self.client.post('/api/auth/sso/exchange/', {'code': 'x', 'browser_key': 'y'}, format='json').status_code, 404)
        self.assertEqual(self.client.post('/api/auth/sso/ticket/', {'ticket': 'x', 'browser_key': 'y'}, format='json').status_code, 404)
        self.assertEqual(self.client.post('/api/auth/sso/complete/', {'ticket': 'x'}, format='json').status_code, 404)
        # A browser half-way through the round trip is told why rather than shown a bare 404.
        where, query = self.callback('google', state, make_id_token('google', nonce))
        self.assertEqual(where, f'{FRONT}/auth/sso/done')
        self.assertEqual(query['error'], 'flag_off')
        self.assertFalse(SsoSignupTicket.objects.exists())

    def test_flag_off_still_lets_a_person_see_and_remove_their_links(self):
        user = User.objects.create_user('bob', 'bob@example.com', 'a-long-Passw0rd!')
        identity = SsoIdentity.objects.create(user=user, provider='google', subject='s')
        self.set_flag('social_login', False)
        self.client.force_authenticate(user)
        self.assertEqual(len(self.client.get('/api/auth/sso/identities/').data['identities']), 1)
        self.assertEqual(self.client.delete(f'/api/auth/sso/identities/{identity.pk}/').status_code, 204)

    def test_callback_for_an_unconfigured_provider_redirects_with_the_reason(self):
        state, nonce, key, _q = self.start()
        with override_settings(EDMAT_SSO={}):
            where, query = self.callback('google', state, make_id_token('google', nonce))
        self.assertEqual(query['error'], 'not_configured')


class StartTests(SsoTestCase):
    def test_authorization_url_carries_state_nonce_and_an_s256_pkce_challenge(self):
        import base64
        import hashlib

        state, nonce, key, query = self.start('google')
        attempt = SsoAttempt.objects.get(state=state)
        self.assertEqual(query['client_id'], [GOOGLE_ID])
        self.assertEqual(query['redirect_uri'], [f'{API}/auth/sso/google/callback/'])
        self.assertEqual(query['response_type'], ['code'])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        expected = base64.urlsafe_b64encode(hashlib.sha256(attempt.code_verifier.encode()).digest()).rstrip(b'=').decode()
        self.assertEqual(query['code_challenge'], [expected])
        self.assertEqual(attempt.nonce, nonce)
        self.assertGreaterEqual(len(state), 40)
        # The browser key is never stored, only its hash.
        self.assertNotEqual(attempt.browser_key_hash, key)
        self.assertEqual(attempt.browser_key_hash, services._digest(key))
        self.assertEqual(attempt.expires_at - attempt.created_at < timedelta(minutes=11), True)

    def test_apple_asks_for_form_post_and_sends_no_pkce(self):
        _s, _n, _k, query = self.start('apple')
        self.assertEqual(query['response_mode'], ['form_post'])
        self.assertNotIn('code_challenge', query)

    def test_unsafe_next_is_dropped(self):
        for bad in ('//evil.example/', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)'):
            state, _n, _k, _q = self.start(next_path=bad)
            self.assertEqual(SsoAttempt.objects.get(state=state).next_path, '')

    def test_link_needs_a_signed_in_account(self):
        res = self.client.post('/api/auth/sso/google/start/', {'intent': 'link'}, format='json')
        self.assertEqual(res.status_code, 401)

    def test_a_child_account_cannot_link(self):
        child = User.objects.create_user('kid', '', 'a-long-Passw0rd!')
        child.profile.is_minor = True
        child.profile.save()
        self.client.force_authenticate(child)
        res = self.client.post('/api/auth/sso/google/start/', {'intent': 'link'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['detail'], 'minor')

    def test_bad_intent_is_400(self):
        res = self.client.post('/api/auth/sso/google/start/', {'intent': 'admin'}, format='json')
        self.assertEqual(res.status_code, 400)


class StateTests(SsoTestCase):
    def test_a_state_nobody_issued_is_refused_without_calling_the_provider(self):
        self.start()
        where, query = self.callback('google', 'forged-state', make_id_token('google', 'n'))
        self.assertEqual(query['error'], 'state_invalid')
        self.last_post.assert_not_called()

    def test_a_missing_state_is_refused(self):
        where, query = self.callback('google', None, params={'code': 'c'})
        self.assertEqual(query['error'], 'state_invalid')

    def test_a_state_is_single_use(self):
        state, nonce, key, _q = self.start()
        token = make_id_token('google', nonce)
        _w, first = self.callback('google', state, token)
        self.assertIn('ticket', first)
        _w, second = self.callback('google', state, token)
        self.assertEqual(second['error'], 'state_invalid')

    def test_an_expired_state_says_so(self):
        state, nonce, key, _q = self.start()
        SsoAttempt.objects.filter(state=state).update(expires_at=timezone.now() - timedelta(seconds=1))
        _w, query = self.callback('google', state, make_id_token('google', nonce))
        self.assertEqual(query['error'], 'state_expired')
        self.last_post.assert_not_called()

    def test_a_state_issued_for_another_provider_is_refused(self):
        state, nonce, key, _q = self.start('google')
        _w, query = self.callback('microsoft', state, make_id_token('microsoft', nonce))
        self.assertEqual(query['error'], 'state_invalid')

    def test_cancel_at_the_provider(self):
        state, _n, _k, _q = self.start()
        _w, query = self.callback('google', state, params={'state': state, 'error': 'access_denied'})
        self.assertEqual(query['error'], 'cancelled')
        self.assertEqual(query['provider'], 'google')

    def test_any_other_provider_error(self):
        state, _n, _k, _q = self.start()
        _w, query = self.callback('google', state, params={'state': state, 'error': 'server_error'})
        self.assertEqual(query['error'], 'provider_error')

    def test_the_token_request_repeats_the_redirect_uri_and_sends_the_verifier(self):
        state, nonce, key, _q = self.start()
        self.callback('google', state, make_id_token('google', nonce))
        url, data = self.last_post.call_args[0]
        self.assertEqual(url, 'https://oauth2.googleapis.com/token')
        attempt = SsoAttempt.objects.get(state=state)
        self.assertEqual(data['code_verifier'], attempt.code_verifier)
        self.assertEqual(data['redirect_uri'], f'{API}/auth/sso/google/callback/')
        self.assertEqual(data['client_secret'], 'g-secret')
        self.assertEqual(data['code'], 'provider-code')
        self.assertEqual(data['grant_type'], 'authorization_code')

    def test_an_unreachable_token_endpoint_is_a_provider_error(self):
        from .http import ProviderHttpError

        state, _n, _k, _q = self.start()
        with mock.patch('sso.http.post_form', side_effect=ProviderHttpError('HTTP 400: invalid_grant')):
            res = self.client.get('/api/auth/sso/google/callback/', {'state': state, 'code': 'c'})
        self.assertIn('error=provider_error', res['Location'])


class IdTokenTests(SsoTestCase):
    def assertRefused(self, provider='google', jwks=JWKS, token_fn=None, **overrides):
        state, nonce, key, _q = self.start(provider)
        nonce_claim = overrides.pop('nonce', nonce)
        token = token_fn(nonce) if token_fn else make_id_token(provider, nonce_claim, **overrides)
        _w, query = self.callback(provider, state, token, jwks=jwks)
        self.assertEqual(query.get('error'), 'provider_error', query)
        self.assertFalse(SsoSignupTicket.objects.exists())
        self.assertFalse(SsoLoginCode.objects.exists())

    def test_nonce_mismatch(self):
        self.assertRefused(nonce='somebody-elses-nonce')

    def test_missing_nonce(self):
        self.assertRefused(nonce=None)

    def test_wrong_audience(self):
        self.assertRefused(aud='another-client.apps.googleusercontent.com')

    def test_wrong_issuer(self):
        self.assertRefused(iss='https://evil.example')

    def test_expired(self):
        now = int(time.time())
        self.assertRefused(iat=now - 4000, exp=now - 3000)

    def test_issued_long_ago(self):
        now = int(time.time())
        self.assertRefused(iat=now - 3600, exp=now + 600)

    def test_signed_by_a_key_that_is_not_the_providers(self):
        self.assertRefused(key_pem=OTHER_PEM)

    def test_unknown_key_id_refetches_once_then_refuses(self):
        state, nonce, key, _q = self.start()
        _w, query = self.callback('google', state, make_id_token('google', nonce, kid='rotated'))
        self.assertEqual(query['error'], 'provider_error')
        self.assertEqual(self.last_get.call_count, 2)

    def test_a_rotated_key_is_found_after_one_refetch(self):
        cache.set('sso:jwks:https://www.googleapis.com/oauth2/v3/certs', {'keys': []}, 3600)
        state, nonce, key, _q = self.start()
        _w, query = self.callback('google', state, make_id_token('google', nonce))
        self.assertIn('ticket', query)

    def test_alg_none_is_refused(self):
        def unsigned(nonce):
            now = int(time.time())
            claims = {'iss': ISSUERS['google'], 'aud': GOOGLE_ID, 'sub': 'x', 'iat': now, 'exp': now + 600, 'nonce': nonce, 'email': 'a@b.c'}
            return jwt.encode(claims, None, algorithm='none', headers={'kid': 'k1'})

        self.assertRefused(token_fn=unsigned)

    def test_hs256_with_the_public_key_as_secret_is_refused(self):
        public_pem = RSA_KEY.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)

        def confused(nonce):
            now = int(time.time())
            claims = {'iss': ISSUERS['google'], 'aud': GOOGLE_ID, 'sub': 'x', 'iat': now, 'exp': now + 600, 'nonce': nonce}
            import hmac
            import hashlib
            import base64
            import json

            def b64(data):
                return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

            head = b64(json.dumps({'alg': 'HS256', 'kid': 'k1', 'typ': 'JWT'}).encode())
            body = b64(json.dumps(claims).encode())
            sig = b64(hmac.new(public_pem, f'{head}.{body}'.encode(), hashlib.sha256).digest())
            return f'{head}.{body}.{sig}'

        self.assertRefused(token_fn=confused)

    def test_garbage_and_missing_tokens(self):
        self.assertRefused(token_fn=lambda nonce: 'not.a.jwt')
        SsoAttempt.objects.all().delete()
        self.assertRefused(token_fn=lambda nonce: None)

    def test_multiple_audiences_need_azp(self):
        self.assertRefused(aud=[GOOGLE_ID, 'other'], azp='other')


class SignupTests(SsoTestCase):
    def ticket(self, provider='google', **overrides):
        where, query, key = self.full(provider, **overrides)
        self.assertEqual(where, f'{FRONT}/auth/sso/complete', query)
        return query['ticket'], key

    def test_a_new_identity_gets_a_ticket_and_the_ticket_reads_back_only_with_the_key(self):
        ticket, key = self.ticket()
        row = SsoSignupTicket.objects.get()
        self.assertEqual(row.ticket_hash, services._digest(ticket))
        self.assertEqual(row.email, 'ala@example.com')
        self.assertTrue(row.email_verified)
        res = self.client.post('/api/auth/sso/ticket/', {'ticket': ticket, 'browser_key': key}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['email'], 'ala@example.com')
        self.assertEqual(res.data['suggested_name'], 'Ala Kowalska')
        self.assertEqual(res.data['suggested_username'], 'ala')
        self.assertTrue(res.data['asks_age'])
        wrong = self.client.post('/api/auth/sso/ticket/', {'ticket': ticket, 'browser_key': 'other-tab'}, format='json')
        self.assertEqual(wrong.status_code, 400)

    def test_complete_creates_an_account_with_no_password(self):
        from legal.models import TermsAcceptance
        from mail.services import is_confirmed

        ticket, key = self.ticket()
        res = self.complete(ticket, key)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertIn('token', res.data)
        self.assertEqual(res.data['next'], '/exercises/1')
        user = User.objects.get(username='ala')
        self.assertFalse(user.has_usable_password())
        self.assertEqual(user.email, 'ala@example.com')
        self.assertEqual(user.profile.display_name, 'Ala')
        self.assertEqual(user.profile.preferred_locale, 'pl')
        self.assertTrue(SsoIdentity.objects.filter(user=user, provider='google', issuer=ISSUERS['google'], subject='google-subject-1').exists())
        acceptance = TermsAcceptance.objects.get(user=user)
        self.assertEqual(acceptance.via, 'sso:google')
        # Google vouched for the address, so it is confirmed and no confirmation mail goes out.
        self.assertTrue(is_confirmed(user))
        self.assertEqual(len(django_mail.outbox), 0)
        # And the next sign-in with the same Google account is a login, not a second signup.
        where, query, key2 = self.full()
        self.assertEqual(where, f'{FRONT}/auth/sso/done')
        login = self.exchange(query['code'], key2)
        self.assertEqual(login.data['kind'], 'login')
        self.assertEqual(login.data['profile']['id'], user.pk)

    def test_an_unverified_address_is_not_confirmed_and_gets_the_confirmation_mail(self):
        from mail.services import is_confirmed

        ticket, key = self.ticket(email_verified=False)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.complete(ticket, key).status_code, 201)
        user = User.objects.get(username='ala')
        self.assertFalse(is_confirmed(user))
        self.assertEqual(len(django_mail.outbox), 1)
        self.assertEqual(django_mail.outbox[0].to, ['ala@example.com'])

    def test_the_ticket_is_single_use(self):
        ticket, key = self.ticket()
        self.assertEqual(self.complete(ticket, key).status_code, 201)
        again = self.complete(ticket, key, username='ala2')
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data['detail'], 'ticket_invalid')

    def test_the_ticket_needs_the_starting_tabs_key(self):
        ticket, key = self.ticket()
        res = self.complete(ticket, 'a-different-tab')
        self.assertEqual(res.data['detail'], 'ticket_invalid')
        self.assertFalse(User.objects.filter(username='ala').exists())

    def test_an_expired_ticket(self):
        ticket, key = self.ticket()
        SsoSignupTicket.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.complete(ticket, key).data['detail'], 'ticket_invalid')

    def test_terms_must_be_accepted(self):
        ticket, key = self.ticket()
        for value in (False, None, 'yes please'):
            res = self.complete(ticket, key, accept_terms=value)
            self.assertEqual(res.status_code, 400)
            self.assertEqual(res.data['accept_terms'], ['terms_required'])
        self.assertFalse(User.objects.filter(username='ala').exists())
        # The ticket was not spent by a refused attempt.
        self.assertEqual(self.complete(ticket, key).status_code, 201)

    def test_under_sixteen_gets_the_guardian_refusal(self):
        ticket, key = self.ticket()
        res = self.complete(ticket, key, birth_year=timezone.now().year - 12)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['birth_year'], ['guardian_required'])
        self.assertFalse(User.objects.filter(email='ala@example.com').exists())

    def test_the_age_question_cannot_be_skipped_while_it_is_asked(self):
        ticket, key = self.ticket()
        self.assertEqual(self.complete(ticket, key, birth_year=None).data['birth_year'], ['required'])
        self.assertEqual(self.complete(ticket, key, birth_year='abc').data['birth_year'], ['invalid'])

    def test_age_verification_off_takes_the_question_away_here_too(self):
        self.set_flag('age_verification', False)
        ticket, key = self.ticket()
        self.assertEqual(self.complete(ticket, key, birth_year=None).status_code, 201)

    def test_username_rules(self):
        User.objects.create_user('Taken', 'other@example.com', 'x')
        ticket, key = self.ticket()
        self.assertEqual(self.complete(ticket, key, username='taken').data['username'], ['taken'])
        self.assertEqual(self.complete(ticket, key, username='has space').data['username'], ['invalid'])
        self.assertEqual(self.complete(ticket, key, username='').data['username'], ['required'])
        self.assertEqual(self.complete(ticket, key, username='x' * 151).data['username'], ['too_long'])

    def test_an_email_already_on_an_account_is_never_adopted(self):
        existing = User.objects.create_user('ala-old', 'ALA@example.com', 'a-long-Passw0rd!')
        where, query, key = self.full()
        self.assertEqual(where, f'{FRONT}/auth/sso/done')
        self.assertEqual(query['error'], 'email_in_use')
        self.assertEqual(query['provider'], 'google')
        self.assertFalse(SsoIdentity.objects.exists())
        self.assertFalse(SsoSignupTicket.objects.exists())
        self.assertFalse(SsoLoginCode.objects.filter(user=existing).exists())

    def test_an_email_taken_while_the_ticket_waited(self):
        ticket, key = self.ticket()
        User.objects.create_user('quick', 'ala@example.com', 'x')
        res = self.complete(ticket, key)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['detail'], 'email_in_use')

    def test_no_email_at_all(self):
        where, query, key = self.full(email=None)
        self.assertEqual(query['error'], 'email_missing')

    def test_ticket_with_no_terms_and_unsafe_fields_never_touches_privileges(self):
        ticket, key = self.ticket()
        res = self.complete(ticket, key, is_staff=True, is_superuser=True)
        self.assertEqual(res.status_code, 201)
        user = User.objects.get(username='ala')
        self.assertFalse(user.is_staff or user.is_superuser)


class LoginCodeTests(SsoTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user('ala', 'ala@example.com', 'a-long-Passw0rd!')
        SsoIdentity.objects.create(user=self.user, provider='google', issuer=ISSUERS['google'], subject='google-subject-1', email='ala@example.com')

    def test_a_known_identity_signs_in(self):
        where, query, key = self.full()
        self.assertEqual(where, f'{FRONT}/auth/sso/done')
        self.assertNotIn('token', query)
        res = self.exchange(query['code'], key)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['kind'], 'login')
        self.assertEqual(res.data['profile']['id'], self.user.pk)
        self.assertEqual(res.data['next'], '/exercises/1')
        self.assertIsNotNone(SsoIdentity.objects.get().last_login_at)
        # Same token LoginView would hand out.
        from rest_framework.authtoken.models import Token

        self.assertEqual(res.data['token'], Token.objects.get(user=self.user).key)

    def test_sign_in_matches_on_subject_not_on_email(self):
        where, query, key = self.full(email='changed@example.com')
        self.assertEqual(self.exchange(query['code'], key).data['profile']['id'], self.user.pk)

    def test_the_code_is_single_use(self):
        where, query, key = self.full()
        self.assertEqual(self.exchange(query['code'], key).status_code, 200)
        again = self.exchange(query['code'], key)
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data['detail'], 'code_invalid')

    def test_a_forwarded_callback_is_useless_in_another_tab(self):
        where, query, key = self.full()
        res = self.exchange(query['code'], 'the-victims-own-tab-key')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'code_invalid')
        self.assertEqual(self.exchange(query['code'], '').status_code, 400)

    def test_an_expired_code(self):
        where, query, key = self.full()
        SsoLoginCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.exchange(query['code'], key).status_code, 400)

    def test_the_code_is_stored_hashed(self):
        where, query, key = self.full()
        self.assertFalse(SsoLoginCode.objects.filter(code_hash=query['code']).exists())
        self.assertTrue(SsoLoginCode.objects.filter(code_hash=services._digest(query['code'])).exists())

    def test_an_inactive_account_does_not_sign_in(self):
        self.user.is_active = False
        self.user.save()
        where, query, key = self.full()
        self.assertEqual(query['error'], 'account_inactive')


class LinkTests(SsoTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user('ala', 'ala@uw.edu.pl', 'a-long-Passw0rd!')
        self.other = User.objects.create_user('ola', 'ola@example.com', 'a-long-Passw0rd!')

    def link(self, provider='google', **overrides):
        state, nonce, key, _q = self.start(provider, intent='link', user=self.user)
        token = make_id_token(provider, nonce, **overrides)
        where, query = self.callback(provider, state, token)
        return where, query, key

    def test_link_attaches_on_redemption_by_the_same_account(self):
        where, query, key = self.link()
        self.assertFalse(SsoIdentity.objects.exists())  # nothing attached at the callback
        res = self.exchange(query['code'], key, user=self.user)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['kind'], 'link')
        identity = SsoIdentity.objects.get()
        self.assertEqual(identity.user, self.user)
        # The provider's address differs from the account's, and that is fine: linking proves both.
        self.assertEqual(identity.email, 'ala@example.com')

    def test_link_code_redeemed_anonymously_or_by_another_account_is_refused(self):
        where, query, key = self.link()
        self.assertEqual(self.exchange(query['code'], key).data['detail'], 'wrong_account')
        self.assertEqual(self.exchange(query['code'], key, user=self.other).data['detail'], 'wrong_account')
        self.assertFalse(SsoIdentity.objects.exists())
        # Still redeemable by the right account — a refused try does not burn it.
        self.assertEqual(self.exchange(query['code'], key, user=self.user).status_code, 200)

    def test_an_identity_linked_to_someone_else_is_refused_with_the_reason(self):
        SsoIdentity.objects.create(user=self.other, provider='google', issuer=ISSUERS['google'], subject='google-subject-1')
        where, query, key = self.link()
        self.assertEqual(query['error'], 'already_linked')
        self.assertEqual(SsoIdentity.objects.get().user, self.other)

    def test_linking_twice_is_harmless(self):
        where, query, key = self.link()
        self.exchange(query['code'], key, user=self.user)
        where, query, key = self.link()
        self.assertEqual(self.exchange(query['code'], key, user=self.user).status_code, 200)
        self.assertEqual(SsoIdentity.objects.count(), 1)

    def test_a_link_may_even_carry_an_email_another_account_uses(self):
        # Link is proof of holding BOTH accounts, so the address collision rule does not apply.
        where, query, key = self.link(email='ola@example.com')
        self.assertEqual(self.exchange(query['code'], key, user=self.user).status_code, 200)

    def test_an_attempt_cannot_be_turned_into_a_link_for_another_account(self):
        # Ola starts a LOGIN; whoever finishes it cannot redirect it onto Ala's account.
        where, query, key = self.full(email='new@example.com')
        self.assertEqual(where, f'{FRONT}/auth/sso/complete')


class UnlinkTests(SsoTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user('ala', 'ala@example.com', 'a-long-Passw0rd!')
        self.google = SsoIdentity.objects.create(user=self.user, provider='google', subject='g')
        self.client.force_authenticate(self.user)

    def test_list_mine(self):
        res = self.client.get('/api/auth/sso/identities/')
        self.assertTrue(res.data['has_password'])
        self.assertEqual([i['provider'] for i in res.data['identities']], ['google'])

    def test_unlink_with_a_password_and_it_is_audited(self):
        from telemetry.models import AuditEvent
        from telemetry.routers import shard_for_user

        res = self.client.delete(f'/api/auth/sso/identities/{self.google.pk}/')
        self.assertEqual(res.status_code, 204)
        self.assertFalse(SsoIdentity.objects.exists())
        events = AuditEvent.objects.using(shard_for_user(self.user.pk)).filter(target_type='sso_identity')
        self.assertEqual(events.count(), 1)
        self.assertIn('Unlinked google', events.get().summary)

    def test_the_last_way_in_cannot_be_removed(self):
        self.user.set_unusable_password()
        self.user.save()
        res = self.client.delete(f'/api/auth/sso/identities/{self.google.pk}/')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['detail'], 'set_password_first')
        self.assertTrue(SsoIdentity.objects.exists())

    def test_another_provider_counts_as_a_way_in(self):
        self.user.set_unusable_password()
        self.user.save()
        SsoIdentity.objects.create(user=self.user, provider='microsoft', subject='m')
        self.assertEqual(self.client.delete(f'/api/auth/sso/identities/{self.google.pk}/').status_code, 204)

    def test_someone_elses_identity_is_404(self):
        other = User.objects.create_user('ola', 'ola@example.com', 'x')
        theirs = SsoIdentity.objects.create(user=other, provider='microsoft', subject='m2')
        self.assertEqual(self.client.delete(f'/api/auth/sso/identities/{theirs.pk}/').status_code, 404)
        self.assertTrue(SsoIdentity.objects.filter(pk=theirs.pk).exists())

    def test_anonymous_is_refused(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/auth/sso/identities/').status_code, 401)


class PasswordResetForSsoAccountsTests(SsoTestCase):
    def test_an_sso_only_account_can_get_a_reset_link_to_set_a_password(self):
        user = User.objects.create_user('ala', 'ala@example.com')
        SsoIdentity.objects.create(user=user, provider='google', subject='g')
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post('/api/auth/password-reset/', {'email': 'ala@example.com'}, format='json')
        self.assertEqual(res.status_code, 202)
        self.assertEqual(len(django_mail.outbox), 1)

    def test_an_unusable_password_without_a_provider_still_gets_nothing(self):
        User.objects.create_user('legacy', 'legacy@example.com')
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post('/api/auth/password-reset/', {'email': 'legacy@example.com'}, format='json')
        self.assertEqual(len(django_mail.outbox), 0)


class MicrosoftTests(SsoTestCase):
    def test_an_ordinary_email_claim_is_not_trusted_as_verified(self):
        where, query, key = self.full('microsoft', email_verified=True)
        self.assertEqual(where, f'{FRONT}/auth/sso/complete')
        self.assertFalse(SsoSignupTicket.objects.get().email_verified)

    def test_xms_edov_makes_it_verified(self):
        self.full('microsoft', xms_edov=True)
        self.assertTrue(SsoSignupTicket.objects.get().email_verified)

    def test_verified_primary_email_makes_it_verified(self):
        self.full('microsoft', verified_primary_email=['ALA@example.com'])
        self.assertTrue(SsoSignupTicket.objects.get().email_verified)

    def test_the_issuer_must_name_the_tokens_own_tenant(self):
        where, query, key = self.full('microsoft', iss='https://login.microsoftonline.com/ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0')
        self.assertEqual(query['error'], 'provider_error')

    def test_a_single_tenant_configuration_refuses_other_tenants(self):
        conf = {**SSO_CONFIG, 'microsoft': {**SSO_CONFIG['microsoft'], 'tenant': 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee'}}
        with override_settings(EDMAT_SSO=conf):
            state, nonce, key, query = self.start('microsoft')
            _w, q = self.callback('microsoft', state, make_id_token('microsoft', nonce))
        self.assertEqual(q['error'], 'provider_error')

    def test_consumers_tenant_accepts_only_personal_accounts(self):
        conf = {**SSO_CONFIG, 'microsoft': {**SSO_CONFIG['microsoft'], 'tenant': 'consumers'}}
        consumer = providers.MICROSOFT_CONSUMER_TENANT
        with override_settings(EDMAT_SSO=conf):
            state, nonce, key, _q = self.start('microsoft')
            _w, q = self.callback('microsoft', state, make_id_token('microsoft', nonce))
            self.assertEqual(q['error'], 'provider_error')
            state, nonce, key, _q = self.start('microsoft')
            _w, q = self.callback('microsoft', state, make_id_token(
                'microsoft', nonce, tid=consumer, iss=f'https://login.microsoftonline.com/{consumer}/v2.0'))
            self.assertIn('ticket', q)

    def test_the_tenant_goes_into_the_endpoints(self):
        self.assertEqual(providers.MICROSOFT.endpoint('authorize'),
                         'https://login.microsoftonline.com/common/oauth2/v2.0/authorize')


class AppleTests(SsoTestCase):
    def test_the_callback_is_a_form_post(self):
        state, nonce, key, _q = self.start('apple')
        where, query = self.callback(
            'apple', state, make_id_token('apple', nonce, email='abc123@privaterelay.appleid.com', is_private_email='true'),
            form_extra={'user': '{"name":{"firstName":"Ala","lastName":"Kowalska"},"email":"spoofed@example.com"}'},
        )
        self.assertEqual(where, f'{FRONT}/auth/sso/complete')
        row = SsoSignupTicket.objects.get()
        # The address comes from the signed id_token, never from the unsigned `user` field.
        self.assertEqual(row.email, 'abc123@privaterelay.appleid.com')
        self.assertTrue(row.email_verified)
        self.assertEqual(row.suggested_name, 'Ala Kowalska')

    def test_a_get_callback_is_not_apples(self):
        state, nonce, key, _q = self.start('apple')
        _w, query = self.callback('apple', state, make_id_token('apple', nonce), method='get')
        self.assertEqual(query['error'], 'state_invalid')
        # …and the attempt was not consumed by the wrong-method request.
        self.assertEqual(SsoAttempt.objects.get(state=state).status, 'pending')

    def test_the_client_secret_is_a_fresh_es256_jwt(self):
        state, nonce, key, _q = self.start('apple')
        self.callback('apple', state, make_id_token('apple', nonce))
        _url, data = self.last_post.call_args[0]
        self.assertNotIn('code_verifier', data)
        secret = data['client_secret']
        self.assertEqual(jwt.get_unverified_header(secret)['kid'], 'KEY1234567')
        claims = jwt.decode(secret, EC_KEY.public_key(), algorithms=['ES256'], audience='https://appleid.apple.com')
        self.assertEqual(claims['iss'], 'TEAM123456')
        self.assertEqual(claims['sub'], APPLE_ID)
        self.assertLessEqual(claims['exp'] - claims['iat'], 300)

    def test_an_unreadable_key_file_means_not_configured(self):
        conf = {**SSO_CONFIG, 'apple': {**SSO_CONFIG['apple'], 'private_key_path': '/nonexistent/key.p8'}}
        with override_settings(EDMAT_SSO=conf):
            self.assertTrue(providers.APPLE.is_configured())  # the path is set…
            self.assertEqual(providers.APPLE.client_secret(), '')  # …but no secret can be made


class DevStubGuardTests(TestCase):
    """The development stub signs tokens for anybody. It must be unreachable outside DEBUG."""

    @override_settings(DEBUG=False, EDMAT_SSO_DEV_STUB_URL='http://localhost:8043')
    def test_ignored_without_debug(self):
        self.assertEqual(providers.dev_stub_url(), '')
        self.assertEqual(providers.GOOGLE.endpoint('token'), 'https://oauth2.googleapis.com/token')
        self.assertFalse(providers.GOOGLE.issuer_ok({'iss': 'http://localhost:8043/google'}))

    @override_settings(DEBUG=True, EDMAT_SSO_DEV_STUB_URL='http://localhost:8043')
    def test_used_with_debug(self):
        self.assertEqual(providers.GOOGLE.endpoint('token'), 'http://localhost:8043/google/token')
        self.assertTrue(providers.GOOGLE.issuer_ok({'iss': 'http://localhost:8043/google'}))

    def test_settings_refuse_to_load_with_the_stub_and_debug_off(self):
        env = {
            **os.environ,
            'DJANGO_DEBUG': 'False',
            'DJANGO_SECRET_KEY': 'x' * 50,
            'DJANGO_ALLOWED_HOSTS': 'edmat.example',
            'EDMAT_SSO_DEV_STUB_URL': 'http://localhost:8043',
        }
        backend = Path(__file__).resolve().parent.parent
        result = subprocess.run(
            [sys.executable, '-c', 'import config.settings'], cwd=backend, env=env, capture_output=True, text=True, timeout=60,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('EDMAT_SSO_DEV_STUB_URL', result.stderr)


class SettingsParsingTests(TestCase):
    def test_env_variables_land_in_the_config(self):
        env = {**os.environ, 'EDMAT_SSO_GOOGLE_CLIENT_ID': 'abc', 'EDMAT_SSO_MICROSOFT_TENANT': 'organizations'}
        backend = Path(__file__).resolve().parent.parent
        result = subprocess.run(
            [sys.executable, '-c', 'import config.settings as s; print(s.EDMAT_SSO["google"]["client_id"], s.EDMAT_SSO["microsoft"]["tenant"])'],
            cwd=backend, env=env, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.stdout.strip(), 'abc organizations', result.stderr)


class PurgeTests(SsoTestCase):
    def test_expired_rows_go_and_live_ones_stay(self):
        self.start()
        live = SsoAttempt.objects.get()
        old = SsoAttempt.objects.create(state='old', provider='google', nonce='n', redirect_uri='r', browser_key_hash='h',
                                        expires_at=timezone.now() - timedelta(hours=2))
        SsoSignupTicket.objects.create(ticket_hash='t', provider='google', subject='s', email='a@b.c', browser_key_hash='h',
                                       expires_at=timezone.now() - timedelta(hours=2))
        counts = services.purge()
        self.assertEqual(counts['attempts'], 1)
        self.assertEqual(counts['tickets'], 1)
        self.assertTrue(SsoAttempt.objects.filter(pk=live.pk).exists())
        self.assertFalse(SsoAttempt.objects.filter(pk=old.pk).exists())


class IdentityKeyTests(SsoTestCase):
    """The identity is (provider, issuer, subject) — ANALYTICS-LAW.md §7.2 rule 1."""

    def test_googles_two_issuer_spellings_are_one_identity(self):
        user = User.objects.create_user('ala', 'ala@example.com', 'a-long-Passw0rd!')
        SsoIdentity.objects.create(user=user, provider='google', issuer='https://accounts.google.com', subject='google-subject-1')
        where, query, key = self.full('google', iss='accounts.google.com')
        self.assertEqual(self.exchange(query['code'], key).data['profile']['id'], user.pk)

    def test_the_same_microsoft_sub_in_another_tenant_is_another_identity(self):
        user = User.objects.create_user('ala', 'ala@uw.edu.pl', 'a-long-Passw0rd!')
        SsoIdentity.objects.create(
            user=user, provider='microsoft', subject='microsoft-subject-1',
            issuer='https://login.microsoftonline.com/ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0',
        )
        where, query, key = self.full('microsoft', email='someone@example.com')
        self.assertEqual(where, f'{FRONT}/auth/sso/complete')

    def test_microsoft_tenant_and_object_id_are_kept(self):
        where, query, key = self.full('microsoft', oid='0bj3ct-1d')
        self.assertEqual(self.complete(query['ticket'], key).status_code, 201)
        identity = SsoIdentity.objects.get()
        self.assertEqual(identity.issuer, f'https://login.microsoftonline.com/{MS_TENANT}/v2.0')
        self.assertEqual(identity.tenant_id, MS_TENANT)
        self.assertEqual(identity.object_id, '0bj3ct-1d')
