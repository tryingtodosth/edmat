"""Anonymous-read response caching with earn-your-slot admission (the owner's policy, verbatim:
"only after 2nd refresh, or even later depending on the current traffic — after like 6-7").

What may EVER be cached is a positive list, and the gates are about who is asking, not what the
endpoint looks like: a GET, on an allowlisted public-API prefix, from a request carrying **no
Authorization header and no session cookie**. Everything else — every authenticated request, every
write, everything off-list — passes through untouched and is answered with `Cache-Control:
private, no-store` left to the view. A cached authenticated response would be an account-data
leak; the positive-list-plus-anonymity rule is what makes that structurally impossible rather than
per-endpoint careful (ENERGY-BRIEF.md §3's discipline).

Admission ("preload nothing by accident, cache what proves itself"): a response is only STORED
once its exact URL has been requested `EDMAT_CACHE_ADMISSION_MIN` times (default 2 — the second
refresh) inside the miss-counter window. When current anonymous traffic is high — many distinct
URLs competing for memory — the bar rises to `EDMAT_CACHE_ADMISSION_BUSY` (default 7): under
pressure an URL must prove itself harder before it may spend shared cache space. The
`preload_cache` management command (telemetry app) is the deliberate other half: what the request
logs say is genuinely hot gets seated ahead of time, admission bypassed on purpose.

Runs through Django's cache API, so it works on the FileBasedCache a bare clone has and becomes a
SHARED cache the moment `EDMAT_REDIS_URL` points it at Redis — same code, no branches. Entries are
TTL-bounded (`EDMAT_CACHE_RESPONSE_TTL`, default 60s); writes do not invalidate, deliberately: at
this app's write volume a sub-minute staleness window is cheaper than an invalidation protocol,
and the one place that trade was wrong — nothing found so far — would show up as a user-visible
60s lag, not corruption.

The `X-EdMat-Cache` header (`miss` / `stored` / `hit`) exists for the tests and for `curl` — it
states what happened, so cache behavior is observable rather than inferred.
"""

import hashlib
import time

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse

# Public, anonymous-safe read surfaces. NOT here, deliberately: `/api/auth/` (never), messaging/
# bookings/moderation/notifications (private by nature), `/api/geocode/` (authenticated, spends a
# shared third-party budget), and anything under DEBUG media.
PUBLIC_PREFIXES = (
    '/api/disciplines/',
    '/api/branches/',
    '/api/exercises/',
    '/api/materials/',
    '/api/courses/',
    '/api/events/',
    '/api/services/',
    '/api/feature-flags/',
    '/api/users/',
)

# Carve-outs inside those prefixes. Exercise detail is excluded because `retrieve()` records a real
# `ContentView` per visit — the viewer-pool denominator the report/auto-hide system divides by
# (§17F) — and a cache hit would silently stop counting anonymous readers. `random` must stay
# random, `bulk` is id-driven and huge, `stream` is a stream.
import re

EXCLUDE = (
    re.compile(r'^/api/exercises/\d+/$'),
    re.compile(r'/random/'),
    re.compile(r'/bulk/'),
    re.compile(r'/stream/'),
)


def _setting(name, default):
    return getattr(settings, name, default)


def cache_key(full_path: str) -> str:
    digest = hashlib.sha256(full_path.encode()).hexdigest()[:32]
    return f'anoncache:resp:{digest}'


def _miss_key(full_path: str) -> str:
    digest = hashlib.sha256(full_path.encode()).hexdigest()[:32]
    return f'anoncache:miss:{digest}'


def _current_threshold() -> int:
    """2 normally; 6–7 when the current minute's anonymous traffic is past the busy mark."""
    minute = int(time.time() // 60)
    rate_key = f'anoncache:rate:{minute}'
    cache.add(rate_key, 0, 120)
    try:
        rate = cache.incr(rate_key)
    except ValueError:  # evicted between add and incr — treat as quiet
        rate = 1
    busy_rpm = _setting('EDMAT_CACHE_BUSY_RPM', 120)
    if rate > busy_rpm:
        return _setting('EDMAT_CACHE_ADMISSION_BUSY', 7)
    return _setting('EDMAT_CACHE_ADMISSION_MIN', 2)


def cacheable_request(request) -> bool:
    if request.method != 'GET':
        return False
    # Who is asking, not what they ask for: any credential at all disqualifies the request. The
    # session cookie matters as much as the token header — SessionAuthentication is enabled for
    # the browsable API, so a session-bearing GET can genuinely see different data (own drafts,
    # own paused listings) than an anonymous one.
    if 'HTTP_AUTHORIZATION' in request.META:
        return False
    if settings.SESSION_COOKIE_NAME in request.COOKIES:
        return False
    path = request.path
    if not path.startswith(PUBLIC_PREFIXES):
        return False
    return not any(rx.search(path) for rx in EXCLUDE)


def store(full_path: str, response) -> None:
    """Seat a response directly (used by the middleware once admission is earned, and by
    `preload_cache` with admission deliberately bypassed)."""
    cache.set(
        cache_key(full_path),
        (response.status_code, response.headers.get('Content-Type', ''), response.content),
        _setting('EDMAT_CACHE_RESPONSE_TTL', 60),
    )


class AnonymousReadCacheMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not cacheable_request(request):
            return self.get_response(request)

        full_path = request.get_full_path()
        cached = cache.get(cache_key(full_path))
        if cached is not None:
            status, content_type, body = cached
            response = HttpResponse(body, status=status, content_type=content_type)
            response['X-EdMat-Cache'] = 'hit'
            return response

        response = self.get_response(request)

        # Only clean, ordinary successes may be stored; a response that sets a cookie is by
        # definition not anonymous-identical and must never be shared.
        if response.status_code != 200 or response.has_header('Set-Cookie') or response.streaming:
            response['X-EdMat-Cache'] = 'skip'
            return response

        miss_key = _miss_key(full_path)
        cache.add(miss_key, 0, _setting('EDMAT_CACHE_MISS_TTL', 600))
        try:
            misses = cache.incr(miss_key)
        except ValueError:
            misses = 1
        if misses >= _current_threshold():
            store(full_path, response)
            response['X-EdMat-Cache'] = 'stored'
        else:
            response['X-EdMat-Cache'] = 'miss'
        return response
