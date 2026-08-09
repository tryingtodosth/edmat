# Brief: performance per złoty — where EdMat's watts actually go, and the secure way to stop paying them

**Status: analysis only — nothing below is built.** Grounded in the real deployment
(`deploy/apache/edmat.conf`, `deploy/DEPLOYMENT.md`: Apache + mod_wsgi on webek4.fuw.edu.pl,
`WSGIDaemonProcess processes=2 threads=4`, SQLite, the static SPA build served by Apache), not in
generic advice. Ordered by złoty-saved-per-hour-of-work, with the security consequence of every
item stated next to it — a performance change that weakens a boundary is a regression here, not an
optimization.

## 0. The frame: what actually costs money

The server is a university box, so the marginal electric bill is FUW's; what Piotr pays is
capacity, availability, and any temptation to self-host. Two numbers anchor everything below:

- **The API has exactly 8 concurrent request slots** (2 processes × 4 threads). Every performance
  and availability question on this deployment is really a question about those 8 slots.
- **If home hardware ever enters the picture**: idle draw dominates. An old tower idling 40–80 W at
  Polish prices (~1.2 zł/kWh) is **420–840 zł/year doing nothing**; an N100 mini-PC or Pi at 3–6 W
  is 30–60 zł/year; the FUW box is 0 zł/year. The single best "electric bill refactor" is a
  non-refactor: **stay on webek4, never move this to a home tower.**

## 1. The one real fire: SSE holds the server's slots open (availability + energy, same fix)

`NotificationStreamView` (§17H) holds a mod_wsgi thread per open connection for up to 600 s,
running a DB poll every 3 s. On an 8-slot server that is not an energy footnote, it is an
**availability vulnerability**: eight browser tabs left open on `/notifications` — one person's —
occupy every slot, and the API is down for everyone. No malice required; `EventSource`
auto-reconnects forever. It is also the only genuinely busy loop in the system: N open tabs cost
N × 20 queries/minute around the clock.

The secure fix, in preference order:

1. **One shared poller per process, not per connection**: a single background tick queries
   "new notifications since id X per waiting user" once per interval and fans results out to
   waiting generators via a condition variable — one query per 3 s per *process* regardless of
   connection count. Keeps the 3 s latency promise.
2. **A per-user concurrent-stream cap** (one stream per account; a second connect closes the
   first): turns "one person can absorb every slot" into "one person absorbs one." This is the
   security half and is worth doing even if nothing else changes.
3. **The blunt cheap alternative** if 1 is too much work: drop SSE for a 60 s client-side poll of
   the existing unread-count endpoint. §17H's own "honest limitation" note already frames the
   latency as bounded-not-instant; 60 s is a legitimate bound for a notification bell, and the
   busy loop disappears entirely.

## 2. Free wins: config only, no code (one afternoon)

- **Far-future caching on the hashed assets.** The vhost sets no `Cache-Control`/`Expires` at all,
  so every visit revalidates every asset against Apache. SvelteKit's `/assets/` filenames are
  content-hashed — `Cache-Control: public, max-age=31536000, immutable` is safe *by construction*
  there (and only there; `index/200.html` stays revalidated). Cuts most repeat-visit requests to
  zero before they cost a slot.
- **Precompress at build time** (`gzip`/`brotli` files next to the originals, Apache
  `MultiViews`/`mod_deflate` serving them): the CPU is spent once per deploy instead of per
  request. The KaTeX/vendor chunks are the big beneficiaries.
- **Security note, not a change**: the env-var block (`DJANGO_DEBUG` off, HTTPS-ready flags) from
  DEPLOYMENT.md is the precondition for everything here; a `DEBUG=True` slip costs more CPU per
  request than every optimization in this file saves, and leaks stack traces.

## 3. Cheap code: stop paying per-request costs that buy nothing

- **Telemetry writes**: `RequestLogMiddleware` writes one SQLite row per request, synchronously,
  into the log shards. Batch it (an in-process buffer flushed every few seconds / N rows) or
  sample ordinary 200-GETs — keep every error and every write-verb row full, since those are the
  security-relevant ones. On SQLite, per-request commits are the dominant write cost of a read-only
  page view.
- **HTTP caching for anonymous reads, done the safe way**: ~30 lines of middleware that sets
  `Cache-Control: public, s-maxage=60` + a real `ETag` **only when the request carries no
  `Authorization` header and the view is a public GET** (browse lists, exercise detail, search).
  Authenticated responses get `Cache-Control: private, no-store`, unconditionally. The rule is
  positive-list, not negative — a cached authenticated response is an account-data leak, which is
  why the gate is "no Authorization present," never "endpoint looks public." One test pins that an
  authenticated response is never emitted with `public`.
- With that header discipline in place, **Cloudflare's free tier in front of edmat.net** becomes
  safe and worthwhile: edge-cached statics, absorbed bot traffic (bots are pure wasted watts —
  this repo's own access pattern is public-read-heavy, the best case for edge caching), TLS, and
  the origin IP hidden. Needs only DNS control of the domain, which the project has.

## 4. What NOT to do, named so it stays not-done

- No caching of anything authenticated, ever, no matter the hit rate (§3's rule).
- No relaxing of the upload/sanitization boundaries (§17N/§17Q) for throughput — they are the
  expensive parts *because* they are the security parts. The avatar re-encode's CPU burst per
  upload is rare and correct.
- No moving off SQLite "for performance" — at this traffic it is the cheapest correct choice, and
  §17I's own lessons about its locking are already encoded in the code.
- No home-server migration to "save" hosting costs (§0's arithmetic runs the other way).
- The Rust/C/Go ports (PORTS-BRIEF.md) are **not** the energy answer: Tier 2–3 above removes most
  per-request CPU for ~1% of a port's effort. A Go M1 behind Apache would genuinely cut per-request
  CPU ~10–30× — do it for the learning and the benchmarks, not for the bill.

## 5. How to verify (the discipline this repo already uses)

Before/after each tier, against the staging ports: requests-per-second and CPU-seconds per 1 000
anonymous page-loads (`hey`/`ab`); the count of DB queries per idle minute with 5 notification
tabs open (the §1 fix should take it from ~100 to ~20 per process, then to ~0 under option 3);
repeat-visit request count in the browser network tab (Tier 2 should take it to a handful); and
one negative test that an `Authorization`-bearing request never receives a `public` cache header.
The `measure_moderation_queue` command (§17F) is the in-repo precedent for keeping such
measurements as re-runnable tools rather than one-off claims.

## 6. Suggested order

1. §2 (cache headers + precompression) — an afternoon, config only.
2. §1 item 2 (per-user SSE cap) — the security fix, ~20 lines.
3. §1 item 1 or 3 (shared poller, or drop to polling) — one session.
4. §3 (telemetry batching + anonymous-read caching) — one session, with the negative test.
5. Cloudflare in front — an evening, after §3's headers exist.
