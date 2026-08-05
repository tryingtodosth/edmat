"""Writes one `RequestLog` row per request, and decides what must never reach it.

The redaction rules below are the part that matters. A log is written once and read years later by
someone who was not in the room, so anything sensitive that lands in it stays there.
"""

import time
import uuid

from django.conf import settings
from django.utils.deprecation import MiddlewareMixin

from .models import RequestLog
from .routers import shard_for_user

# Bodies are never logged at all, anywhere — but these paths additionally get their query string
# dropped, since a credential mistakenly submitted as a GET parameter would otherwise be written
# down in clear text.
SENSITIVE_PATH_PREFIXES = ('/api/auth/',)

# Endpoints where the query string IS the user's own content rather than metadata. What somebody
# searched for on a study platform is more revealing than their IP address — it can indicate what
# they are struggling with, which course they are retaking, what they are about to be examined on.
# It has no security-logging purpose whatsoever, so it is dropped rather than kept short.
CONTENT_QUERY_PARAMS = ('q', 'search', 'query')

# Never logged in any form. Both carry credentials outright.
SENSITIVE_HEADERS = ('HTTP_AUTHORIZATION', 'HTTP_COOKIE')

MAX_PATH = 500
MAX_QUERY = 500
MAX_UA = 400
MAX_REFERER = 500


def redact_query_string(path: str, query_string: str) -> str:
    """Drops search terms and everything on an auth path; keeps the rest for debugging."""
    if not query_string:
        return ''
    if path.startswith(SENSITIVE_PATH_PREFIXES):
        return ''
    kept = []
    for pair in query_string.split('&'):
        name = pair.split('=', 1)[0]
        if name in CONTENT_QUERY_PARAMS:
            kept.append(f'{name}=[redacted]')
        else:
            kept.append(pair)
    return '&'.join(kept)[:MAX_QUERY]


def client_ip(request) -> str | None:
    """The real caller's address from behind the Apache reverse proxy.

    Reads the LAST `X-Forwarded-For` entry, not the first. Apache appends its own value to whatever
    the client sent, so the first entries are attacker-controlled and the rightmost is the only one
    written by our own infrastructure. `settings.EDMAT_TRUSTED_PROXY_HOPS` says how many hops to
    step back past; it mirrors DRF's `NUM_PROXIES`, which had exactly this bug before it was set.
    """
    hops = getattr(settings, 'EDMAT_TRUSTED_PROXY_HOPS', 1)
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded and hops:
        parts = [part.strip() for part in forwarded.split(',') if part.strip()]
        if parts:
            return parts[-min(hops, len(parts))]
    return request.META.get('REMOTE_ADDR')


class RequestLogMiddleware(MiddlewareMixin):
    """Times each request and records it.

    **A failure to log must never break a request.** The whole `except` at the bottom is deliberate:
    a full disk, a locked shard or a user id past the configured shard capacity should degrade
    logging, not take the site down with it. That is the correct trade for a study resource — but it
    does mean silence here is ambiguous, which is why the failure is reported to the error log
    rather than swallowed.
    """

    def process_request(self, request):
        request._telemetry_started = time.monotonic()
        # Per REQUEST. Never derived from anything about the visitor, so it cannot be used to
        # recognise them again — see the module docstring in models.py.
        request._telemetry_request_id = str(uuid.uuid4())
        return None

    def process_response(self, request, response):
        started = getattr(request, '_telemetry_started', None)
        if started is None:
            return response
        try:
            user = getattr(request, 'user', None)
            user_id = user.id if (user is not None and user.is_authenticated) else None
            path = request.path[:MAX_PATH]

            row = RequestLog(
                user_id=user_id,
                ip_address=client_ip(request),
                method=request.method[:10],
                path=path,
                query_string=redact_query_string(path, request.META.get('QUERY_STRING', '')),
                status_code=response.status_code,
                duration_ms=int((time.monotonic() - started) * 1000),
                user_agent=request.META.get('HTTP_USER_AGENT', '')[:MAX_UA],
                referer=request.META.get('HTTP_REFERER', '')[:MAX_REFERER],
                request_id=getattr(request, '_telemetry_request_id', ''),
                was_throttled=response.status_code == 429,
            )
            # Named explicitly rather than left to the router's `instance` hint. Both reach the same
            # shard; saying it here means a reader of this file can see WHERE the row goes without
            # first having to know the router exists.
            row.save(using=shard_for_user(user_id))
        except Exception:  # noqa: BLE001 — see the class docstring
            import logging

            logging.getLogger('telemetry').exception('Failed to write a request log row')
        return response
