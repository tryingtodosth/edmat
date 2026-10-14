"""Verifying an id_token: signature against the provider's published keys, then iss, aud, exp, iat
and nonce. Nothing in the token is read before all of that has passed.

The JWKS is cached for an hour in Django's cache (per process without Redis — fine, it is a GET of
a public document). A token signed with a key id the cache does not know triggers ONE refetch,
because providers rotate keys and the new one appears in the JWKS shortly before it is used; a
second miss is a refusal, never a loop.
"""

from __future__ import annotations

import logging

import jwt
from django.core.cache import cache

from . import http
from .providers import Provider

log = logging.getLogger(__name__)

JWKS_TTL = 3600
LEEWAY = 60  # seconds of clock skew tolerated on exp / iat / nbf
MAX_AGE = 600  # an id_token issued more than ten minutes ago is not this sign-in's


class TokenRejected(Exception):
    """The id_token failed a check. The message names which, for the server log."""


def _jwks(provider: Provider, *, refresh: bool = False) -> dict:
    url = provider.endpoint('jwks')
    key = f'sso:jwks:{url}'
    if not refresh:
        cached = cache.get(key)
        if cached:
            return cached
    try:
        data = http.get_json(url)
    except http.ProviderHttpError as exc:
        raise TokenRejected(f'jwks unavailable: {exc}') from exc
    if not isinstance(data.get('keys'), list):
        raise TokenRejected('jwks has no keys')
    cache.set(key, data, JWKS_TTL)
    return data


def _signing_key(provider: Provider, kid: str):
    for refresh in (False, True):
        jwks = _jwks(provider, refresh=refresh)
        for entry in jwks['keys']:
            if entry.get('kid') == kid:
                try:
                    return jwt.PyJWK.from_dict(entry).key
                except jwt.PyJWTError as exc:
                    raise TokenRejected(f'unusable key {kid}: {exc}') from exc
    raise TokenRejected(f'unknown key id {kid!r}')


def verify_id_token(provider: Provider, id_token: str, *, nonce: str) -> dict:
    """Returns the verified claims, or raises TokenRejected."""
    import time

    if not id_token or not isinstance(id_token, str):
        raise TokenRejected('no id_token')
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError as exc:
        raise TokenRejected(f'malformed: {exc}') from exc
    alg = header.get('alg')
    # The algorithm comes from OUR registry, never from the token: a token that says `none` or
    # `HS256` (signing with the public key as an HMAC secret) is refused here, before any key.
    if alg not in provider.algorithms:
        raise TokenRejected(f'algorithm {alg!r} not allowed')
    key = _signing_key(provider, header.get('kid') or '')
    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=list(provider.algorithms),
            audience=provider.client_id(),
            leeway=LEEWAY,
            options={'require': ['iss', 'aud', 'exp', 'iat', 'sub'], 'verify_iss': False},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenRejected('expired') from exc
    except jwt.InvalidAudienceError as exc:
        raise TokenRejected('wrong audience') from exc
    except jwt.PyJWTError as exc:
        raise TokenRejected(f'invalid: {exc}') from exc
    # The issuer is checked by the provider, because Microsoft's depends on the tenant claim.
    if not provider.issuer_ok(claims):
        raise TokenRejected(f'wrong issuer {claims.get("iss")!r}')
    # A token with several audiences must name us as the party it was issued to.
    aud = claims.get('aud')
    if isinstance(aud, list) and len(aud) > 1 and claims.get('azp') != provider.client_id():
        raise TokenRejected('azp does not name this client')
    if not isinstance(claims.get('iat'), (int, float)) or claims['iat'] < time.time() - MAX_AGE - LEEWAY:
        raise TokenRejected('issued too long ago')
    if not nonce or claims.get('nonce') != nonce:
        raise TokenRejected('nonce mismatch')
    if not str(claims.get('sub') or '').strip():
        raise TokenRejected('no subject')
    return claims
