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
    # 'oidc' → the token response carries a signed id_token (tokens.py verifies it).
    # 'oauth2' → no id_token: the identity is read from the provider's API with the access token,
    # over TLS, by `fetch_identity` (GitHub, Facebook). The access token is used for those calls
    # and then dropped — never stored.
    protocol: str = 'oidc'
    userinfo_url: str = ''
    emails_url: str = ''

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
            return f'{stub}/jwks' if which == 'jwks' else f'{stub}/{self.id}/{which}'
        return {
            'authorize': self.authorize_url,
            'token': self.token_url,
            'jwks': self.jwks_url,
            'userinfo': self.userinfo_url,
            'emails': self.emails_url,
        }[which]

    def request_token(self, data: dict) -> dict:
        """The server-to-server code exchange. A POST of the form, which is what OAuth 2.0 says;
        a provider that wants something else overrides this (Facebook)."""
        from . import http

        return http.post_form(self.endpoint('token'), data)

    def fetch_identity(self, access_token: str) -> dict:
        """For an 'oauth2' provider: claims in the same shape an id_token gives
        ({iss, sub, email, email_verified, name}), read from the provider's API."""
        raise NotImplementedError

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


@dataclass(frozen=True)
class OAuth2Provider(Provider):
    """A provider with no id_token. `fetch_identity` fills `iss` with the provider's own fixed
    issuer (the identity key's middle part), so `issuer_ok` only confirms that it did."""

    def issuer_ok(self, claims: dict) -> bool:
        return claims.get('iss') == self.issuer


@dataclass(frozen=True)
class GitHubProvider(OAuth2Provider):
    """GitHub OAuth App. `/user` gives the numeric id (the subject — a login can be renamed) and a
    name; the address comes from `/user/emails`, and only the PRIMARY address GitHub marks VERIFIED
    is used. GitHub will happily report an address the account holder never proved (the reason the
    identity app's draft card warned about it); with no primary verified address there is no
    email (`email_missing` for a new signup — an already-linked identity still signs in)."""

    def request_token(self, data: dict) -> dict:
        response = super().request_token(data)
        # GitHub answers a refused code with HTTP 200 and an `error` field, not a 4xx.
        if response.get('error'):
            from .http import ProviderHttpError

            raise ProviderHttpError(f"github token error: {response.get('error')}")
        return response

    def fetch_identity(self, access_token: str) -> dict:
        from . import http

        headers = {
            'Authorization': f'Bearer {access_token}',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }
        user = http.get_json(self.endpoint('userinfo'), headers=headers)
        emails = http.get_json(self.endpoint('emails'), headers=headers, allow_list=True)
        if not isinstance(emails, list):
            emails = []
        primary = next(
            (e for e in emails if isinstance(e, dict) and e.get('primary') is True and e.get('verified') is True),
            None,
        )
        uid = user.get('id')
        if not isinstance(uid, int) or isinstance(uid, bool):
            raise http.ProviderHttpError('github /user has no numeric id')
        return {
            'iss': self.issuer,
            'sub': str(uid),
            'email': (primary or {}).get('email') or '',
            'email_verified': primary is not None,
            'name': user.get('name') or user.get('login') or '',
        }


@dataclass(frozen=True)
class FacebookProvider(OAuth2Provider):
    """Facebook Login for the web (Graph API). The subject is the APP-SCOPED user id — a
    different number for the same person in every app, so it cannot be correlated elsewhere.
    Facebook says nothing about whether the address was verified, so it is treated as
    unverified: the person gets the ordinary confirmation mail."""

    def authorize_params(self) -> dict:
        return {**super().authorize_params(), 'scope': ','.join(self.scopes)}

    def graph_version(self) -> str:
        # Pinned, because a Graph version is retired about two years after release: v25.0 is the
        # one Facebook's manual-flow guide uses (Feb 2026, expires 2028-07-29). Override with
        # EDMAT_SSO_FACEBOOK_GRAPH_VERSION before then.
        version = (self.config().get('graph_version') or 'v25.0').strip()
        return version if re.match(r'^v\d+\.\d+$', version) else 'v25.0'

    def endpoint(self, which: str) -> str:
        return super().endpoint(which).replace('{v}', self.graph_version())

    def request_token(self, data: dict) -> dict:
        # Facebook's documented code exchange is a GET with the parameters in the query.
        import urllib.parse

        from . import http

        query = {k: data[k] for k in ('client_id', 'redirect_uri', 'client_secret', 'code')}
        return http.get_json(f"{self.endpoint('token')}?{urllib.parse.urlencode(query)}")

    def fetch_identity(self, access_token: str) -> dict:
        import hashlib
        import hmac
        import urllib.parse

        from . import http

        # appsecret_proof: proves the call comes from the holder of the app secret, so a token
        # that leaked from somewhere is useless to anybody else against this app.
        proof = hmac.new(self.client_secret().encode(), access_token.encode(), hashlib.sha256).hexdigest()
        query = urllib.parse.urlencode(
            {'fields': 'id,name,email', 'access_token': access_token, 'appsecret_proof': proof}
        )
        me = http.get_json(f"{self.endpoint('userinfo')}?{query}")
        uid = str(me.get('id') or '')
        if not uid.isdigit():
            raise http.ProviderHttpError('facebook /me has no id')
        return {
            'iss': self.issuer,
            'sub': uid,
            'email': me.get('email') or '',
            'email_verified': False,
            'name': me.get('name') or '',
        }


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

GITHUB = GitHubProvider(
    id='github',
    label='GitHub',
    authorize_url='https://github.com/login/oauth/authorize',
    token_url='https://github.com/login/oauth/access_token',
    jwks_url='',
    issuer='https://github.com',
    # `read:user` is the narrowest scope that returns the profile; `user:email` is what lists the
    # addresses with their `verified` flags. Neither grants any write.
    scopes=('read:user', 'user:email'),
    protocol='oauth2',
    userinfo_url='https://api.github.com/user',
    emails_url='https://api.github.com/user/emails',
    # PKCE (S256) is supported on GitHub's OAuth web flow since 2025-07-14 (GitHub changelog).
    extra_authorize_params={'allow_signup': 'true'},
)

FACEBOOK = FacebookProvider(
    id='facebook',
    label='Facebook',
    authorize_url='https://www.facebook.com/{v}/dialog/oauth',
    token_url='https://graph.facebook.com/{v}/oauth/access_token',
    jwks_url='',
    issuer='https://www.facebook.com',
    # Facebook joins scopes with commas. `public_profile` and `email` are the two that need no App
    # Review; nothing else is asked for.
    scopes=('public_profile', 'email'),
    # PKCE is not relied on: Facebook's web flow is a confidential client (the secret stays on the
    # server) and `state` binds the round trip, exactly as for Apple.
    pkce=False,
    protocol='oauth2',
    userinfo_url='https://graph.facebook.com/{v}/me',
)

# Order is the order of the buttons: the four the owner asked for, then Microsoft — built, not
# requested, and invisible unless somebody configures it.
PROVIDERS: tuple[Provider, ...] = (GOOGLE, APPLE, GITHUB, FACEBOOK, MICROSOFT)
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
