"""The provider registry: what each "Sign in with …" button needs to know, as data plus three hooks.

**Adding a provider is one entry here plus its environment variables.** Everything that differs
between providers and matters is a field or an overridable method on `Provider`: endpoints, scopes,
whether PKCE is sent, whether the answer comes back as a POST, how the id_token's issuer is checked,
when an email counts as verified, and where a name comes from. The flow in `services.py` asks these
and never says `if provider == 'apple'`. (GitHub and Facebook are not OIDC — no id_token — so each
would need a `fetch_identity` hook instead of the id_token path; that is the one structural change,
named here so nobody discovers it halfway through.)

**Enabled = configured AND the `social_login` FeatureFlag is on** (`enabled_providers`). Without a
client id the provider does not exist as far as any visitor can tell: no button, and its start
endpoint answers 404 — not a draft, not a greyed-out button (house rule 10's mirror image: what
cannot work is not offered).

Configuration comes from the environment through `settings.EDMAT_SSO`, which `config/settings.py`
fills from every `EDMAT_SSO_<PROVIDER>_<FIELD>` variable: `CLIENT_ID`, `CLIENT_SECRET` (or
`CLIENT_SECRET_FILE`), Apple's `TEAM_ID`, `KEY_ID`, `PRIVATE_KEY_PATH`, Microsoft's `TENANT`.
`deploy/SSO-SETUP.md` is the runbook.

**The development stub.** `EDMAT_SSO_DEV_STUB_URL` points every provider's endpoints and issuer at
`frontend/e2e/sso-stub.mjs`, so the whole round trip can be driven in a browser on a machine that
has no client id. It is honoured only while `settings.DEBUG` is true — checked here at every call,
AND `config/settings.py` refuses to start with it set and DEBUG off — and a test pins both.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

from django.conf import settings

# Microsoft's tenant id for personal (consumer) accounts — outlook.com, hotmail.com, live.com.
MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'
_GUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


def dev_stub_url() -> str:
    """The stub's base URL, or '' — and always '' unless DEBUG. The second check (settings.py
    refusing to start) is the one that protects production; this one protects a test or a shell
    that flips DEBUG after settings were read."""
    if not settings.DEBUG:
        return ''
    return (getattr(settings, 'EDMAT_SSO_DEV_STUB_URL', '') or '').rstrip('/')


def _truthy(value) -> bool:
    # Apple sends booleans in its id_token as the STRINGS "true"/"false"; Google as JSON booleans.
    return value is True or (isinstance(value, str) and value.lower() == 'true')


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    authorize_url: str
    token_url: str
    jwks_url: str
    issuer: str
    scopes: tuple[str, ...]
    # Apple does not document PKCE on its authorization endpoint; it is a confidential client whose
    # secret is a fresh signed JWT, and `state` + `nonce` still bind the round trip.
    pkce: bool = True
    response_mode: str = 'query'  # 'form_post' → the callback arrives as a POST (Apple)
    algorithms: tuple[str, ...] = ('RS256',)
    extra_authorize_params: dict = field(default_factory=dict)
    # Which configuration keys must be non-empty before the provider counts as configured.
    required_config: tuple[str, ...] = ('client_id', 'client_secret')

    # ---- configuration -------------------------------------------------------------------------

    def config(self) -> dict:
        return dict(getattr(settings, 'EDMAT_SSO', {}).get(self.id, {}))

    def client_id(self) -> str:
        return self.config().get('client_id', '')

    def client_secret(self) -> str:
        conf = self.config()
        if conf.get('client_secret'):
            return conf['client_secret']
        path = conf.get('client_secret_file')
        if path:
            try:
                with open(path, encoding='utf-8') as handle:
                    return handle.read().strip()
            except OSError:
                return ''
        return ''

    def is_configured(self) -> bool:
        conf = self.config()
        for key in self.required_config:
            if key == 'client_secret':
                if not self.client_secret():
                    return False
            elif not conf.get(key):
                return False
        return True

    # ---- endpoints (the dev stub replaces all of them) -----------------------------------------

    def endpoint(self, which: str) -> str:
        stub = dev_stub_url()
        if stub:
            return {
                'authorize': f'{stub}/{self.id}/authorize',
                'token': f'{stub}/{self.id}/token',
                'jwks': f'{stub}/jwks',
            }[which]
        return {'authorize': self.authorize_url, 'token': self.token_url, 'jwks': self.jwks_url}[which]

    def authorize_params(self) -> dict:
        params = {'scope': ' '.join(self.scopes), **self.extra_authorize_params}
        if self.response_mode != 'query':
            params['response_mode'] = self.response_mode
        return params

    # ---- id_token claims ---------------------------------------------------------------------

    def issuer_ok(self, claims: dict) -> bool:
        stub = dev_stub_url()
        if stub:
            return claims.get('iss') == f'{stub}/{self.id}'
        return claims.get('iss') == self.issuer

    def email_verified(self, claims: dict) -> bool:
        return _truthy(claims.get('email_verified'))

    def identity_key(self, claims: dict) -> dict:
        """The (issuer, subject) half of the identity key, plus Microsoft's tid/oid. Called only
        on claims `issuer_ok` has already accepted."""
        return {
            'issuer': str(claims.get('iss') or '')[:255],
            'subject': str(claims.get('sub') or '')[:255],
            'tenant_id': str(claims.get('tid') or '')[:64],
            'object_id': str(claims.get('oid') or '')[:64],
        }

    def suggested_name(self, claims: dict, form: dict) -> str:
        name = claims.get('name') or ' '.join(
            p for p in (claims.get('given_name'), claims.get('family_name')) if p
        )
        return (name or '').strip()[:100]


@dataclass(frozen=True)
class GoogleProvider(Provider):
    def issuer_ok(self, claims: dict) -> bool:
        # Google documents both spellings as valid issuers of its id_tokens.
        if dev_stub_url():
            return super().issuer_ok(claims)
        return claims.get('iss') in ('https://accounts.google.com', 'accounts.google.com')

    def identity_key(self, claims: dict) -> dict:
        # Both spellings are the same issuer; one person must not become two identities.
        key = super().identity_key(claims)
        if key['issuer'] == 'accounts.google.com':
            key['issuer'] = 'https://accounts.google.com'
        return key


@dataclass(frozen=True)
class AppleProvider(Provider):
    def client_secret(self) -> str:
        """Apple's client secret is not a string from a console: it is an ES256 JWT signed with a
        private key downloaded once from the developer account (team id + key id identify it).
        Built fresh for every token request and valid five minutes, so nothing long-lived exists
        except the key file itself."""
        import jwt

        conf = self.config()
        path = conf.get('private_key_path', '')
        if not (conf.get('client_id') and conf.get('team_id') and conf.get('key_id') and path):
            return ''
        try:
            with open(path, encoding='utf-8') as handle:
                private_key = handle.read()
        except OSError:
            return ''
        now = int(time.time())
        try:
            return jwt.encode(
                {
                    'iss': conf['team_id'],
                    'iat': now,
                    'exp': now + 300,
                    'aud': 'https://appleid.apple.com',
                    'sub': conf['client_id'],
                },
                private_key,
                algorithm='ES256',
                headers={'kid': conf['key_id']},
            )
        except (ValueError, TypeError, jwt.PyJWTError):
            return ''

    def suggested_name(self, claims: dict, form: dict) -> str:
        """Apple puts the name in a `user` JSON form field on the FIRST authorization only — never
        in the id_token, never again. Only the name is taken from it; the email always comes from
        the signed id_token, because this field is unsigned."""
        import json

        raw = form.get('user') or ''
        try:
            data = json.loads(raw) if raw else {}
        except (ValueError, TypeError):
            data = {}
        name = data.get('name') if isinstance(data, dict) else None
        if isinstance(name, dict):
            parts = [name.get('firstName'), name.get('lastName')]
            return ' '.join(p.strip() for p in parts if isinstance(p, str) and p.strip())[:100]
        return ''


@dataclass(frozen=True)
class MicrosoftProvider(Provider):
    """Microsoft identity platform (Entra ID) v2.0. The tenant decides who may sign in:
    `common` (any work/school account AND personal accounts), `organizations` (work/school only),
    `consumers` (personal only), or one tenant's GUID (one institution only)."""

    def tenant(self) -> str:
        return (self.config().get('tenant') or 'common').strip().lower()

    def tenant_valid(self) -> bool:
        return self.tenant() in ('common', 'organizations', 'consumers') or bool(_GUID.match(self.tenant()))

    def is_configured(self) -> bool:
        # A tenant given as a domain name (uw.edu.pl) cannot be checked against the token's `tid`,
        # so it is refused as a configuration rather than accepted unchecked.
        return super().is_configured() and self.tenant_valid()

    def endpoint(self, which: str) -> str:
        url = super().endpoint(which)
        return url.replace('{tenant}', self.tenant())

    def tenant_allowed(self, tid: str) -> bool:
        tenant = self.tenant()
        if not tid:
            return False
        if tenant == 'common':
            return True
        if tenant == 'consumers':
            return tid == MICROSOFT_CONSUMER_TENANT
        if tenant == 'organizations':
            return tid != MICROSOFT_CONSUMER_TENANT
        return tid == tenant

    def issuer_ok(self, claims: dict) -> bool:
        tid = str(claims.get('tid') or '')
        if not self.tenant_allowed(tid):
            return False
        if dev_stub_url():
            return super().issuer_ok(claims)
        # Multi-tenant: the issuer names the tenant that actually signed the person in.
        return claims.get('iss') == f'https://login.microsoftonline.com/{tid}/v2.0'

    def email_verified(self, claims: dict) -> bool:
        """Microsoft's `email` claim is NOT guaranteed verified — an Entra tenant admin can type any
        address into a user's mail attribute (the "nOAuth" class of takeover). It counts only when
        Microsoft says so: the optional claim `xms_edov` (email domain owner verified) is true, or
        the address appears in the optional claim `verified_primary_email`. Both have to be
        switched on in the app registration (deploy/SSO-SETUP.md); without them every Microsoft
        address is treated as unverified, which costs a confirmation email and nothing else."""
        if _truthy(claims.get('xms_edov')) or claims.get('xms_edov') == 1:
            return True
        email = (claims.get('email') or '').lower()
        verified = claims.get('verified_primary_email') or []
        if isinstance(verified, str):
            verified = [verified]
        return bool(email) and email in {str(v).lower() for v in verified}


GOOGLE = GoogleProvider(
    id='google',
    label='Google',
    authorize_url='https://accounts.google.com/o/oauth2/v2/auth',
    token_url='https://oauth2.googleapis.com/token',
    jwks_url='https://www.googleapis.com/oauth2/v3/certs',
    issuer='https://accounts.google.com',
    scopes=('openid', 'email', 'profile'),
    extra_authorize_params={'prompt': 'select_account'},
)

APPLE = AppleProvider(
    id='apple',
    label='Apple',
    authorize_url='https://appleid.apple.com/auth/authorize',
    token_url='https://appleid.apple.com/auth/token',
    jwks_url='https://appleid.apple.com/auth/keys',
    issuer='https://appleid.apple.com',
    # Asking for `name` or `email` obliges response_mode=form_post — Apple refuses a query callback.
    scopes=('name', 'email'),
    pkce=False,
    response_mode='form_post',
    required_config=('client_id', 'team_id', 'key_id', 'private_key_path'),
)

MICROSOFT = MicrosoftProvider(
    id='microsoft',
    label='Microsoft',
    authorize_url='https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    token_url='https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
    jwks_url='https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys',
    issuer='',  # per tenant — see MicrosoftProvider.issuer_ok
    scopes=('openid', 'email', 'profile'),
    extra_authorize_params={'prompt': 'select_account'},
)

# Order is the order of the buttons.
PROVIDERS: tuple[Provider, ...] = (GOOGLE, APPLE, MICROSOFT)
PROVIDERS_BY_ID = {p.id: p for p in PROVIDERS}


def flag_on() -> bool:
    from moderation.services import is_feature_enabled

    return is_feature_enabled('social_login')


def get(provider_id: str) -> Provider | None:
    return PROVIDERS_BY_ID.get(provider_id)


def enabled_providers() -> list[Provider]:
    """What the login page offers: configured providers, and none at all while the flag is off."""
    if not flag_on():
        return []
    return [p for p in PROVIDERS if p.is_configured()]


def enabled_ids() -> set[str]:
    return {p.id for p in enabled_providers()}
