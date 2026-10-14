"""The only two server-to-server calls the flow makes: POST the code to a token endpoint, GET a JWKS.

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


def _read(request) -> dict:
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
    if not isinstance(data, dict):
        raise ProviderHttpError('not a JSON object')
    return data


def post_form(url: str, data: dict) -> dict:
    encoded = urllib.parse.urlencode(data).encode('ascii')
    request = urllib.request.Request(
        url,
        data=encoded,
        method='POST',
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'},
    )
    return _read(request)


def get_json(url: str) -> dict:
    return _read(urllib.request.Request(url, headers={'Accept': 'application/json'}))
