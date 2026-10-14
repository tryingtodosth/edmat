"""The only server-to-server calls the flow makes: POST (or, for Facebook, GET) the code to a token
endpoint; GET a JWKS; and, for the OAuth 2.0 providers with no id_token (GitHub, Facebook), GET the
person's profile with the access token.

Standard-library `urllib`, because `requests` is not a dependency of this project and two calls do
not justify one. Kept in its own module so the tests replace exactly this seam
(`mock.patch('sso.http.post_form')` / `get_json`) and nothing else — every line of verification
above it runs for real against keys the test generates.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 10
MAX_BYTES = 1_000_000


class ProviderHttpError(Exception):
    """The provider could not be reached, or answered with something that is not a usable JSON
    object. Its message is for the server log, never for the browser."""


USER_AGENT = 'EdMat sign-in (+https://edmat.net)'  # GitHub's API refuses a request without one


def _read(request, *, allow_list: bool = False):
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310 — https URLs from the registry
            body = response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        # A token endpoint answers a refused code with 400 and a JSON `error`; keep it for the log.
        detail = exc.read(2000).decode('utf-8', 'replace')
        raise ProviderHttpError(f'HTTP {exc.code}: {detail}') from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderHttpError(f'unreachable: {exc}') from exc
    if len(body) > MAX_BYTES:
        raise ProviderHttpError('response too large')
    try:
        data = json.loads(body.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProviderHttpError('not JSON') from exc
    if not isinstance(data, dict) and not (allow_list and isinstance(data, list)):
        raise ProviderHttpError('not a JSON object')
    return data


def post_form(url: str, data: dict) -> dict:
    encoded = urllib.parse.urlencode(data).encode('ascii')
    request = urllib.request.Request(
        url,
        data=encoded,
        method='POST',
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': USER_AGENT},
    )
    return _read(request)


def get_json(url: str, *, headers: dict | None = None, allow_list: bool = False):
    """A JSON object — or, with `allow_list`, an array (GitHub's `/user/emails`)."""
    merged = {'Accept': 'application/json', 'User-Agent': USER_AGENT, **(headers or {})}
    return _read(urllib.request.Request(url, headers=merged), allow_list=allow_list)
