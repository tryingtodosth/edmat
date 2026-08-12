# Outbound webhooks — design

Grounded in `backend/notifications/services.py` (`notify()`), `backend/notifications/redisbus.py`,
`backend/messaging/services.py`, `backend/telemetry/` and `backend/config/settings.py` as they exist
today. No code changed for this document.

## 1. Overview

Goal: let a user (or later, a course/service) register a URL that gets an HTTP POST when something
notification-worthy happens to them — the same events `notify()` already turns into a `Notification`
row, plus optionally a new message arriving via `messaging/services.py`. Delivery is asynchronous,
capped, signed, and **automatically throttled off** when the production box (webek4, Apache +
mod_wsgi, 8 WSGI slots total, no Celery/systemd-timer/task-queue, cron is the only scheduler) is busy
or loaded — with only 8 slots, anything synchronous that can stall on a third party is a
self-inflicted outage.

**Non-goals for v1:** inbound webhooks; fine-grained per-event filtering beyond a coarse type
allowlist (mirrors `notify()`'s own coarse `Profile.notify_on_*` categories); guaranteed,
ordered, exactly-once delivery — at-least-once, best-effort is the honest target, the same posture
`publish_notification()` already takes ("a lost publish costs at most the live push, never the
notification itself"); a detailed webhook-management UI (a small DRF viewset is assumed, not
designed here); sending message/notification **bodies** to third parties (§5).

## 2. Data model

New app `webhooks/` (own models/migrations/admin, same shape as `messaging/`, which also carries no
models of its own but still gets its own app boundary).

```python
class WebhookEndpoint(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='webhooks')
    url = models.URLField(max_length=500)
    secret = models.CharField(max_length=64)            # generated server-side, shown once
    event_types = models.JSONField(default=list)        # subset of notifications.NOTIFICATION_TYPES + 'message_received'; empty = all
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    consecutive_failures = models.PositiveIntegerField(default=0)
    disabled_reason = models.CharField(max_length=200, blank=True)  # set when auto-disabled, §4

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'url'], name='uniq_owner_url')]
```

Per-user cap at creation time (`EDMAT_WEBHOOK_MAX_PER_USER`, default 3) — same reasoning as
`STREAM_SLOT_LIMIT = 2` in `redisbus.py`: one account must not turn itself into an amplifier.

No `WebhookDelivery` table on the primary DB. Attempts live only in Redis (the queue, §3); writing
one SQLite row per attempt per endpoint on a box whose shard files are already under write pressure
(`telemetry/routers.py`) is exactly the "durable record nobody asked for" this codebase avoids
elsewhere. `last_success_at`/`last_failure_at`/`consecutive_failures` is enough to auto-disable a
dead endpoint and show "last delivered: 2h ago" — a full delivery log is not a goal, and payload
minimalism (§5) means there's little to archive anyway.

## 3. Delivery pipeline

**Enqueue — inside `notify()`, additive, fire-and-forget**, same shape as `publish_notification()`
right below it today:

```python
publish_notification(recipient.pk, NotificationSerializer(notification).data)
enqueue_webhook_events(recipient.pk, notif_type, notification.pk)   # new
return notification
```

`enqueue_webhook_events` looks up the recipient's matching active `WebhookEndpoint`s (small,
per-user-cap-bounded query) and, for each, adds a small envelope (`{endpoint_id, event_type,
object_id, occurred_at}` — ids and a type, not content, §5) to a Redis structure (below). Wrapped in
`try/except Exception: pass` like `publish_notification` — must never fail the action that triggered
it. If `get_redis()` is `None` (bare clone, no `EDMAT_REDIS_URL`) it no-ops immediately, matching the
"a bare clone without Redis must keep working" constraint. This is the **one hook point**; no
caller of `notify()` needs to know webhooks exist, same as none know about Redis pub/sub today.
`messaging/services.py`'s `send_message`/`reply_to_message` get the identical one-line addition for a
`message_received` event.

**Why not call the endpoint from inside `notify()`:** it runs on a request thread, one of 8. A
receiver that's slow or unreachable (SSRF hardening exists precisely because "unreachable/internal"
is a real outcome, not hypothetical) would hold that thread until timeout; two or three concurrent
slow endpoints is enough to exhaust the WSGI pool. A Redis push is one fast round-trip; the HTTP call
happens elsewhere.

**Drain — a management command run from cron, not a daemon.** No systemd timer, no Celery, so
"elsewhere" means a short-lived process cron starts and stops: `manage.py drain_webhooks`, same
family as `enforce_log_retention`/`migrate_log_shards`/`preload_cache`.

1. Check the governor (§4); if OFF, print one status line and exit — no HTTP at all.
2. Otherwise pop due entries (up to a wall-clock budget, `EDMAT_WEBHOOK_DRAIN_SECONDS`, default 50 —
   cron runs every minute, so one run must finish before the next starts).
3. Per envelope: re-check `is_active`, build the minimal payload (§5), sign it, `requests.post(url,
   timeout=(2, 5), allow_redirects=False)`.
4. 2xx → reset `consecutive_failures`, stamp `last_success_at`.
5. Failure (non-2xx, timeout, redirect, or SSRF re-check failing — DNS can rebind between enqueue and
   drain) → increment failure counters, retry with backoff, cap at 4 attempts total (~35 min span),
   then **dead-letter** the event. If `consecutive_failures` crosses `EDMAT_WEBHOOK_FAIL_THRESHOLD`
   (default 10, tracked across events on the endpoint row) set `is_active=False` with a
   `disabled_reason` — "flag it, don't fake it": a dead endpoint stops being retried forever, and the
   owner sees *why* it's off, not silent nothing.

**Queue structure:** a Redis **sorted set** `edmat:webhooks:pending` scored by `not_before` (unix ts).
`enqueue_webhook_events` adds with `not_before = now`; a retry re-adds with `not_before = now +
backoff`. The drain loop is `ZRANGEBYSCORE ... 0 <now> LIMIT 0 N` + remove — simpler than juggling
delay buckets, no dependency beyond Redis (already required). Collisions on removal are harmless:
worst case one duplicate delivery, which the receiver's `X-EdMat-Delivery-Id` should dedupe.

**Cap:** `ZCARD` checked before enqueue; at `EDMAT_WEBHOOK_QUEUE_MAX` (default 5000) new events are
dropped rather than queued — same cap applies whether the governor is on or off (§4).

## 4. The load governor

**Signals:**
- **Traffic** — reuse `config/cachemw.py`'s `anoncache:rate:{minute}` counter verbatim (per-minute
  Redis `incr`) rather than invent a second traffic mechanism that can drift from the real one. The
  drain command reads the current + previous minute's key. Threshold `EDMAT_WEBHOOK_BUSY_RPM`
  (default 150, just above `EDMAT_CACHE_BUSY_RPM`'s 120 so the cache layer's own busy mode kicks in
  slightly first).
- **CPU** — `/proc/loadavg` (1-minute figure), read directly by the drain process itself — load
  average is per-machine, so there's no "which worker's view is authoritative" question the way
  there would be with a WSGI-worker-local metric. Threshold `EDMAT_WEBHOOK_BUSY_LOADAVG` (default
  4.0 — a guess; needs tuning to webek4's real core count, flagged in §7, not silently trusted).

**Hysteresis** (avoid flapping every cron minute): ON/OFF state lives in Redis
(`edmat:webhooks:governor`), not recomputed independently each run. Turning OFF needs the busy
condition (traffic OR loadavg over threshold) for **2 consecutive runs**; turning back ON needs **5
consecutive clean runs** (~5 min). Asymmetric on purpose — quick to protect the site, slow to trust
that a busy period is over.

**Queue policy while OFF:** nothing is drained. New events still enqueue normally (cheap push, not
the risky part) up to the same `EDMAT_WEBHOOK_QUEUE_MAX` cap. Entries older than
`EDMAT_WEBHOOK_MAX_AGE_SECONDS` (default 3600) are **dropped at drain time, not delivered late** — a
webhook firing an hour after "your submission was approved" is noise, and the in-app `Notification`
row is unaffected and still current. At the cap, newest events simply stop being added (checked via
`ZCARD` first) rather than evicting older ones — equivalent in practice since the old ones age out
via the timestamp rule anyway.

**Observability:** `drain_webhooks` prints one status line per run — e.g. `webhooks: governor=ON
traffic=48rpm loadavg=1.2 queue=3 delivered=2 failed=0 disabled=0` — captured by cron's own log
redirect. The same numbers are mirrored into a small Redis hash (`edmat:webhooks:status`, TTL past
the drain interval so a stalled cron shows as stale, not silently frozen-good) for a staff-only
`GET /api/admin/webhooks/status/` endpoint. Per-worker vs shared: governor state, traffic counter and
status hash are all in Redis and read by one cron-invoked process at a time (locking in §6) — no
"per-WSGI-worker" ambiguity here, unlike request-time code that must reason about many concurrent
mod_wsgi processes.

## 5. Security & privacy

**SSRF** — validated at *registration* and re-checked at *delivery* (DNS can change between the two):
require `https://` only; resolve the hostname and reject if any address is
private/loopback/link-local (`ipaddress`), matches known FUW/UW campus CIDRs (needs the actual ranges
from webek4's admins — flagged open in §7, "private" alone under-blocks a routable-but-internal
university subnet), or is the cloud metadata address `169.254.169.254`; reject non-standard ports;
`allow_redirects=False` on delivery (a redirect is exactly how a validated public URL turns into an
internal one later — any 3xx counts as a delivery failure). Re-running the IP-class check at delivery
time (not just registration) is what defeats DNS rebinding.

**Authenticity — HMAC.** `WebhookEndpoint.secret` is server-generated, shown once, stored in
cleartext (same trust level as `EDMAT_OAUTH_CLIENTS`/`EDMAT_USOS_CREDENTIALS` in settings today — no
existing secret-vault convention to defer to; flagged in §7). Delivery sets:

```
X-EdMat-Signature: sha256=<HMAC-SHA256(secret, raw_body)>
X-EdMat-Delivery-Id: <uuid4, one per attempt — lets receivers dedupe a retry>
X-EdMat-Timestamp: <unix ts>
```

**Payload minimalism — bodies are never sent.** Payload is just:

```json
{"event": "submission_approved", "notification_id": 481, "occurred_at": "2026-08-12T10:03:00Z",
 "delivery_id": "…", "fetch_url": "https://webek4.fuw.edu.pl/api/notifications/481/"}
```

Why: a notification's `note` or a message body can carry what a student wrote about their own
struggles, a moderation reason, a comment's content — genuinely sensitive text. Per
`telemetry/models.py`'s own stated posture on `q=` search terms, "what somebody typed... is their
content, not metadata," treated as *more* revealing than an IP. Pushing that to a user-supplied
third-party URL is a data-exfiltration channel by construction — the receiver is whoever the user
typed in, not someone EdMat vetted. IDs + a fetch-back URL instead means: the receiver must
authenticate as the real recipient to see content, so a leaked webhook URL alone reveals nothing; the
existing `Profile.notify_on_*`/mute gating and any access control on the notification-detail endpoint
still applies to the fetch rather than being bypassed by a second delivery path with none of it.

**Per-user cap** (§2) bounds one compromised account's amplification. `WebhookEndpoint`
create/delete/secret-rotate should go through `AuditEvent` (needs a new `ACTION_CHOICES` entry, e.g.
`'webhook_registered'` — a small schema touch outside this doc's no-code scope, flagged in §7).

## 6. Deployment notes (webek4.fuw.edu.pl)

- Requires `EDMAT_REDIS_URL` (already standard post-Aug-2026 per `deploy/DEPLOYMENT.md`). Without it,
  `enqueue_webhook_events` no-ops and `drain_webhooks` exits immediately reporting `governor=OFF
  reason=no-redis` — no error, matching every other Redis-optional feature here.
- New env vars, all `EDMAT_WEBHOOK_*` with safe defaults: `MAX_PER_USER` (3), `BUSY_RPM` (150),
  `BUSY_LOADAVG` (4.0, tune to core count), `QUEUE_MAX` (5000), `MAX_AGE_SECONDS` (3600),
  `FAIL_THRESHOLD` (10), `DRAIN_SECONDS` (50).
- Crontab (todoonet's, same convention as `enforce_log_retention`/`preload_cache`):
  ```
  * * * * * cd /path/to/edmat/backend && /path/to/venv/bin/python manage.py drain_webhooks >> logdata/webhooks-cron.log 2>&1
  ```
  A Redis `SET NX` lock (`edmat:webhooks:drain-lock`, TTL just above `EDMAT_WEBHOOK_DRAIN_SECONDS`)
  guards against overlap if a run ever exceeds a minute — the one piece of real locking needed;
  everything else tolerates at-least-once duplication via `X-EdMat-Delivery-Id`.
- Runs as `www-data`, same as the app, via the project's own `manage.py` — no new user or permission
  boundary. No Apache/mod_wsgi config changes at all: the whole feature lives in cron + Redis + one
  hook line in `notify()`/`messaging/services.py`, the cheapest way to add background work to a stack
  with no task queue.

## 7. Risks & left open

- **FUW intranet CIDR list not in this document** — needs real ranges from webek4's admins before
  shipping; "private/loopback" alone under-blocks a routable internal university subnet.
- **No real secrets vault** — `secret` sits in cleartext in the primary DB, consistent with
  `EDMAT_OAUTH_CLIENTS` today but still a real exposure if the DB leaks.
- **Traffic signal is anonymous-GET-only** (reused from `cachemw`), not authenticated/write load,
  which is arguably more webhook-relevant but has no cheap existing counter. A dedicated counter is
  possible but adds a Redis write to every `notify()` call — deliberately not added, since it would
  raise the choke point's per-request cost even when webhooks are idle.
- **Loadavg threshold (4.0) is a guess** pending webek4's real core count.
- **No delivery-history UI** beyond last success/failure timestamps — debugging "why didn't my
  webhook fire three weeks ago" has no record. Deliberate cost trade-off, not an oversight.
- **Retry backoff is coarse** (a handful of fixed delays over ~35 min), not exponential+jitter — fine
  at today's volume, would need revisiting if usage grows a lot.
- **Governor is conservative by design** (slow to re-enable) — on a mostly-idle study site this likely
  means webhooks stay ON almost always, with the governor earning its keep only during rare spikes
  (exam period, a course going viral). Worth confirming that's the wanted trade, not over-tuned.

## 8. Implementation effort — staged, each independently shippable

**Stage 1 — model, registration, delivery (no governor, always-on when Redis exists).**
`WebhookEndpoint` model+migration+admin+DRF viewset with secret-once-shown and SSRF validation;
`enqueue_webhook_events` hook in `notify()` and `messaging/services.py`; `drain_webhooks` command with
HMAC signing, minimal payload, `allow_redirects=False`, ZSET-based retry, dead-letter/auto-disable.
**~2–3 days** (model/viewset half a day; hook an hour; drain command incl. SSRF re-check and retries
a day; SSRF/HMAC tests deserving real coverage, half to one day).

**Stage 2 — the load governor.** Traffic from `cachemw`'s counter, loadavg from `/proc/loadavg`,
Redis hysteresis state machine, status line + status hash, env vars in `settings.py`. **~1 day** of
coding; budget a separate few-day *observation* window in production before trusting the default
thresholds.

**Stage 3 — admin visibility + cron locking + docs.** Staff status endpoint, `SET NX` cron lock,
crontab line added to `deploy/DEPLOYMENT.md`, `AuditEvent` action for webhook lifecycle changes.
**~half a day.**

**Stage 4 (optional) — per-event filtering UI, owner-facing delivery metrics, secret rotation flow.**
Pure polish on a working Stages 1–3; **~1–2 days**, skippable if webhook adoption stays small (likely
on a student study site — probably a handful of course integrations, not hundreds of endpoints).

**Total for a production-ready v1 (Stages 1–3): roughly 4–5 days**, plus an observation period for
governor tuning before the §6 defaults can be trusted unattended.
