"""The sign-in providers EdMat intends to offer, and an honest account of how far each one is.

Nothing here performs a handshake. This module is the *configuration* half of a sign-in system —
endpoints, scopes, and the per-provider quirk that actually breaks a first integration — plus a
`state()` function that reports what is genuinely missing before any of it can run. The frontend's
provider buttons render a modal straight out of this data (`GET /api/auth/providers/`), so what a
visitor is told about a connection is computed from the same settings a real client would read,
rather than being prose in a Svelte file that would quietly go stale the day someone configures one.

Why a registry and not four `if provider == ...` branches: the missing piece is identical in every
case (a client id and a secret, obtained by registering an application against a verified domain),
so the interesting differences are data, and keeping them as data is what lets the modal say
something specific about each provider without four hand-written copies drifting apart.

The scopes are the ones EdMat would genuinely request, and no more — see `identity/usos.py` for the
same principle applied where it matters far more.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from django.conf import settings

Protocol = Literal['oidc', 'oauth2', 'saml']


@dataclass(frozen=True)
class ProviderDefinition:
    id: str
    label: str
    protocol: Protocol
    scopes: tuple[str, ...]
    #: Every URL below is the provider's own current published endpoint. They are recorded here so
    #: the dependency surface is reviewable in one place against each provider's documentation,
    #: rather than being discovered one 404 at a time inside a half-written client.
    authorize_url: str = ''
    token_url: str = ''
    userinfo_url: str = ''
    jwks_url: str = ''
    uses_pkce: bool = True
    #: Apple is the odd one out and it is not a detail: requesting any scope switches the response
    #: to a POST, which a callback route written for a redirect will simply never see.
    response_mode: Literal['query', 'form_post'] = 'query'
    #: The thing a first implementation typically gets wrong. Shown verbatim in the UI.
    quirk: str = ''
    #: Extra, provider-specific work beyond "register an app and paste two secrets".
    extra_steps: tuple[str, ...] = field(default_factory=tuple)


GOOGLE = ProviderDefinition(
    id='google',
    label='Google',
    protocol='oidc',
    scopes=('openid', 'email', 'profile'),
    authorize_url='https://accounts.google.com/o/oauth2/v2/auth',
    token_url='https://oauth2.googleapis.com/token',
    userinfo_url='https://openidconnect.googleapis.com/v1/userinfo',
    jwks_url='https://www.googleapis.com/oauth2/v3/certs',
    quirk=(
        'OpenID Connect, so the id_token already carries the identity — there is no need to call '
        'the userinfo endpoint at all, and doing so is a wasted round trip on every sign-in. What '
        'the callback must do instead is verify that token properly: signature against the JWKS, '
        'plus iss, aud, exp and the nonce it sent.'
    ),
)

APPLE = ProviderDefinition(
    id='apple',
    label='Apple',
    protocol='oidc',
    scopes=('name', 'email'),
    authorize_url='https://appleid.apple.com/auth/authorize',
    token_url='https://appleid.apple.com/auth/token',
    jwks_url='https://appleid.apple.com/auth/keys',
    response_mode='form_post',
    quirk=(
        'Asking for any scope makes Apple POST its response to the redirect URI instead of '
        'redirecting to it, so a callback route that only accepts GET never runs. Apple also sends '
        "the user's name exactly once — on the very first authorization, never again — so a "
        'sign-in that drops it has thrown it away permanently. The address may be a private-relay '
        'forwarding address rather than a real inbox.'
    ),
    extra_steps=(
        'The client secret is not a fixed string: it is a short-lived ES256 JWT that must be '
        'generated from a private key downloaded from the developer account, and re-generated '
        'before it expires (six months at most).',
        'The redirect URI must be HTTPS on a domain verified with Apple. localhost is not accepted, '
        'which is why this cannot be exercised end to end on a dev machine alone.',
    ),
)

GITHUB = ProviderDefinition(
    id='github',
    label='GitHub',
    protocol='oauth2',
    scopes=('read:user', 'user:email'),
    authorize_url='https://github.com/login/oauth/authorize',
    token_url='https://github.com/login/oauth/access_token',
    userinfo_url='https://api.github.com/user',
    uses_pkce=False,
    quirk=(
        'Plain OAuth 2.0, not OIDC — the token carries no identity whatsoever, so the profile has '
        'to be fetched from /user. The email there is frequently null (it only holds the public '
        'profile email), so a second call to /user/emails is needed to find the primary address, '
        'and only the entry flagged verified there should ever be trusted.'
    ),
)

SCHOOL = ProviderDefinition(
    id='school',
    label='University account',
    protocol='saml',
    scopes=('eduPersonPrincipalName', 'eduPersonAffiliation', 'mail', 'displayName'),
    quirk=(
        'Institutional single sign-on in Poland is SAML 2.0 federation, not OAuth — so this one '
        'shares no code at all with the three above. It is also the only provider that can answer '
        'the question EdMat actually cares about: eduPersonAffiliation distinguishes a current '
        'student from an alumnus from staff, which no consumer provider can tell us.'
    ),
    extra_steps=(
        'EdMat must publish SAML metadata and register as a service provider with each federation '
        'it wants to accept, which is an agreement per institution rather than one integration.',
        'Until that exists, a university address can still be checked by email domain. That is a '
        'real but genuinely weaker claim — it proves the address, not the affiliation — and is '
        'labelled as such everywhere it is shown.',
    ),
)

PROVIDERS: tuple[ProviderDefinition, ...] = (SCHOOL, GOOGLE, APPLE, GITHUB)
PROVIDERS_BY_ID = {p.id: p for p in PROVIDERS}


def credentials_for(provider_id: str) -> dict[str, str]:
    """Whatever has actually been configured for this provider, which is nothing today.

    Reading through `settings` rather than a module-level constant is the whole point: the day
    somebody registers an application and sets EDMAT_OAUTH_CLIENTS, every status below flips on its
    own and the UI stops calling that provider a draft — without anyone remembering to edit a
    sentence in a template.
    """
    return getattr(settings, 'EDMAT_OAUTH_CLIENTS', {}).get(provider_id, {})


def blockers_for(provider_id: str) -> list[str]:
    """What specifically stands between this provider and a working sign-in, right now."""
    definition = PROVIDERS_BY_ID[provider_id]
    configured = credentials_for(provider_id)
    blockers: list[str] = []

    if definition.protocol == 'saml':
        if not configured.get('metadata_url'):
            blockers.append(
                'No SAML service-provider registration. EdMat has no published metadata and is not '
                'registered with any identity federation.'
            )
    else:
        if not configured.get('client_id'):
            blockers.append(
                'No client id. It comes from registering an application with the provider, which '
                'requires a verified domain and a redirect URI on a real origin.'
            )
        if not configured.get('client_secret'):
            blockers.append(
                'No client secret. It must be held server-side and never reach the browser, so it '
                'needs somewhere real to live before any of this can run.'
            )

    if not getattr(settings, 'EDMAT_OAUTH_REDIRECT_BASE', ''):
        blockers.append(
            'No public redirect base URL is configured, so there is no address to register as a '
            'callback in the first place.'
        )

    blockers.extend(definition.extra_steps)
    return blockers


def state_for(provider_id: str) -> dict:
    """The whole current state of one connection, as the UI shows it."""
    definition = PROVIDERS_BY_ID[provider_id]
    blockers = blockers_for(provider_id)
    return {
        'id': definition.id,
        'label': definition.label,
        'protocol': definition.protocol,
        'status': 'draft' if blockers else 'configured',
        'scopes': list(definition.scopes),
        'authorize_url': definition.authorize_url,
        'token_url': definition.token_url,
        'userinfo_url': definition.userinfo_url,
        'jwks_url': definition.jwks_url,
        'uses_pkce': definition.uses_pkce,
        'response_mode': definition.response_mode,
        'quirk': definition.quirk,
        'blockers': blockers,
        # The checks a real callback route owes regardless of provider. Written down because they
        # are the part that is easy to skip and expensive to skip: each one is a real attack if
        # omitted, and none of them is visible in a flow that otherwise appears to work.
        'callback_requirements': [
            'Reject any response whose state does not match the one issued for this browser '
            '(cross-site request forgery on the callback itself).',
            'Treat the authorization code as single-use and short-lived; refuse a replay.',
            'Exchange the code server-side only — the secret must never be in a browser.',
        ]
        + (
            [
                'Verify the id_token signature against the published JWKS, and check iss, aud, exp '
                'and nonce before trusting a single claim in it.'
            ]
            if definition.protocol == 'oidc'
            else []
        )
        + (
            [
                'Never adopt an existing account on an unverified email address. GitHub in '
                'particular will hand over an address the account holder never proved they own, '
                'and matching on it would be an account-takeover route.'
            ]
            if definition.protocol == 'oauth2'
            else []
        ),
    }


def all_states() -> list[dict]:
    return [state_for(p.id) for p in PROVIDERS]


def settings_repository_url() -> str:
    """Where the reasoning behind all of the above actually lives.

    The connection modal links here rather than restating a design in a tooltip: a draft is only
    honest if the person reading it can go and see what is planned, and LAUNCHCHECKLIST.md in the
    repository is where that is written down.
    """
    return getattr(settings, 'EDMAT_REPOSITORY_URL', 'https://github.com/tryingtodosth/edmat')
