"""The Redis side of notification delivery — pub/sub fan-out and the per-user stream cap.

Redis is an OPT-IN (`EDMAT_REDIS_URL`, empty by default): every caller here must keep working when
`get_redis()` returns None, by degrading to the pre-Redis behavior (the SSE view's own DB-polling
loop, no connection cap). That keeps `setup.sh`/a fresh clone working with zero new daemons, the
same posture the ClamAV integration already takes (`MATERIAL_SCAN_REQUIRED`), while a deployment
that exports one env var gets the real thing.

Why pub/sub at all: the SSE stream used to discover new rows by re-querying the database every 3
seconds PER CONNECTION — the only busy loop in the app, and measured against the real vhost's 8
WSGI slots, an availability problem as much as an energy one (ENERGY-BRIEF.md §1). With Redis,
`notify()` publishes each row once and an idle stream blocks on a socket — zero queries, zero
wakeups, until something actually happens.
"""

import json

from django.conf import settings

_client = None
_client_failed = False


def get_redis():
    """A connected client, or None when Redis is unconfigured or unreachable.

    The client is created once per process and kept; a failed first connection marks the process as
    Redis-less rather than retrying on every request — a dead Redis must not add a connect timeout
    to every notification write. (Restart the workers after bringing Redis up; on mod_wsgi that is
    `touch` on the wsgi file.)
    """
    global _client, _client_failed
    if _client is not None:
        return _client
    if _client_failed:
        return None
    url = getattr(settings, 'EDMAT_REDIS_URL', '')
    if not url:
        _client_failed = True
        return None
    try:
        import redis

        client = redis.Redis.from_url(url, socket_connect_timeout=1, socket_timeout=30)
        client.ping()
    except Exception:
        _client_failed = True
        return None
    _client = client
    return _client


def channel_for(user_id: int) -> str:
    return f'edmat:notify:{user_id}'


def publish_notification(user_id: int, payload: dict) -> None:
    """Fire-and-forget: the Notification row is already committed, and every non-live surface (the
    bell's fetch on mount, the inbox page) reads the table — a lost publish costs at most the live
    push, never the notification itself. So failures are swallowed, deliberately."""
    client = get_redis()
    if client is None:
        return
    try:
        client.publish(channel_for(user_id), json.dumps(payload))
    except Exception:
        pass


# --- the per-user stream cap -----------------------------------------------------------------------
# One person's open tabs must not be able to absorb the server's whole WSGI slot pool (8 on the real
# vhost). Two streams per account: one for the tab in use, one so a reconnect race or a second
# window never locks anybody out. A third tab simply gets no LIVE stream — its bell still fills on
# every page load, so nothing is lost but immediacy. Enforced only when Redis is up, because the
# counter must be shared across processes to mean anything; the no-Redis fallback keeps the old
# behavior rather than pretending an in-process count is a real cap.

STREAM_SLOT_LIMIT = 2


def acquire_stream_slot(client, user_id: int, ttl_seconds: int) -> bool:
    key = f'edmat:sse-slots:{user_id}'
    try:
        n = client.incr(key)
        # The TTL is a leak guard, not the accounting: a worker killed mid-stream never DECRs, and
        # without an expiry that slot would be gone until somebody noticed. Refreshed on every
        # acquire, sized to outlive the longest legal connection.
        client.expire(key, ttl_seconds + 60)
        if n > STREAM_SLOT_LIMIT:
            client.decr(key)
            return False
        return True
    except Exception:
        # Redis died between get_redis() and here — fail open (the stream still works, uncapped),
        # matching the "degrade, never break notifications" rule at the top of this module.
        return True


def release_stream_slot(client, user_id: int) -> None:
    try:
        key = f'edmat:sse-slots:{user_id}'
        if client.decr(key) < 0:
            client.delete(key)
    except Exception:
        pass
