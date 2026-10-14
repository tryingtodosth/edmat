# analytics — consent-free usage statistics, aggregates only

Built 2026-10-14. The staff dashboard at `/moderation/analytics` (frontend `routes/moderation/analytics/`,
`lib/services/analytics.ts`, `lib/components/analytics/`). Legal reading: `ANALYTICS-LAW.md` at the
repo root — §3 classifies every figure here (all class A, except active accounts and cohorts, class B
with the conditions below), the basis: **GDPR art. 6(1)(f) legitimate interest — the controller is the student
team, not the University (LEGAL.md §1); ANALYTICS-LAW.md §4's (e) recommendation assumed a university
controller**, plus art. 5(1)(b)/89(1) for reusing
the security log statistically.

## Where the numbers come from

- **Rolled up nightly** from the request-log shards (`telemetry.RequestLog`) by
  `manage.py rollup_analytics` → `rollup.py` → the tables in `models.py`: `DailyRouteStat` (route
  TEMPLATE × method × audience anon|auth|bot: requests, 4xx, 5xx, 429, searches, p50/p95),
  `DailyContentView` (successful human GETs of a content detail endpoint), `DailyReferrer` (external
  HOST only), `DailyClient` (browser/OS/device family), `DailyActiveUsers`, `WeeklyCohort`, `RollupRun`.
- **Live** from the main database (`live.py`), nothing stored: registrations, email confirmation rate,
  guardian-created accounts, contribution funnel, moderation queues, community activity per week,
  feature usage per week, corpus coverage per discipline/branch.

## Invariants — each pinned by a test

- **No personal column in any analytics table** — no IP, UA string, user id, path, referrer URL,
  request id, no FK to an account (`NoPersonalColumnsTests`). User ids are read during the rollup into
  a local set to count distinct accounts, and only the count is written.
- **No visitor identifier, ever.** Distinct ANONYMOUS visitors are not counted, because counting
  them needs a fingerprint (`telemetry.tests.test_no_visitor_fingerprint`; ANALYTICS-LAW.md §3 row
  11 is class C). Do not add a hashed-IP "unique visitors" figure.
- **No client-side beacon for analytics.** Nothing in the browser exists for analytics — no cookie, no
  storage, no script (the error reporter below is not analytics and sends only on a crash). Web Vitals would need consent (class C); speed is measured server-side only.
- **`Sec-GPC: 1` / `DNT: 1` is an Art. 21 objection**: `RequestLog.analytics_opt_out`, set by
  `telemetry/middleware.py`, and every rollup skips those rows (they are only counted as "excluded").
  `views.HealthView` is the one reader of raw rows that includes them — it is the security/operations
  purpose the log exists for, and the objection does not reach that (ANALYTICS-LAW.md §3 row 12).
- **Minors are never counted as active accounts or in a cohort** (`rollup.adult_accounts`:
  `Profile.is_minor` or a `Guardianship` child) — §3 row 5. Their requests still count as requests.
- **Staff are never counted as people** (`rollup.without_staff`: `is_staff` or `is_superuser` at
  rollup/request time) — not in active accounts, cohorts and their sizes, registrations or the
  funnel. Owner's decision 2026-10-14. Their REQUESTS stay in every traffic figure: a request is a
  request. `counted_people` = adults who are not staff; use it for any new people-count.
- **No per-account "exclude me from statistics" switch — on purpose** (owner, 2026-10-14): the
  request log is what spam and scam handling runs on. The GPC/DNT objection is honoured for
  STATISTICS only; it never touches the security log, which anti-abuse reads. Keep the two apart in
  any wording: "left out of the statistics", never "not logged".
- **The browser error beacon is the ONE thing that starts in the browser** (built 2026-10-14, owner-
  approved on the condition: no cookie, nothing stored on the device, no banner; ANALYTICS-LAW.md §3
  row 8, LINKING-AND-ERRORS.md §3.3). `client_errors.py` is the contract: `POST /api/client-errors/`
  (`ingest.py`, no authentication class at all, `client_error` throttle 30/h per IP, 8 KB, always 204),
  the field allowlist re-applied server-side, URLs in stacks cut to their path, route TEMPLATES only,
  browser family derived and the UA dropped, `Sec-GPC`/`DNT` dropped, kill switch `client_errors`.
  Tables `ClientErrorGroup` / `DailyClientError` / `ClientErrorReport`: no IP, UA, account or page
  address (`test_client_errors.NoPersonalColumnTests`). The column is `signature`, never
  `fingerprint` — a hash of the ERROR, the same for everybody, and the banned word stays banned.
  `DailyClientError.count` is the one INCREMENTED counter here: there is nothing to recount it from.
  Retention 30 days (reports, capped at 20 per group per day) / 90 days (counts, groups), purged by
  `rollup_analytics`. Errors are not people, so nothing in `/api/analytics/client-errors/` is
  k-suppressed. Still no Web Vitals, no breadcrumbs, no user id — each would move it to class C.
- **k = 10** (`privacy.K_ANONYMITY`): counts of PEOPLE (active accounts, registrations, guardian
  accounts, funnel, cohort cells and sizes, client families) leave the API as `null` when 1–9, drawn
  "<10"; a rate only when both its counts would be shown; a referrer host seen fewer than 10 times is
  not named at all, only summed into `referrers_other`. Counts about content are not suppressed. The
  tables keep true values — suppression is on the way out, so changing k needs no recount.
- **Recount, never increment** (house rule 5): `rollup_day` deletes the day's rows and re-inserts;
  re-running is a no-op. `RollupRun` says which days were rolled up, so the dashboard can tell "never
  rolled up" from "no traffic".
- **Routes are templates from Django's own resolver** (`classify.route_template`), so
  `/api/exercises/random/` never reads as exercise "random"; an unresolvable path is `(unmatched)` —
  one bucket, so scanners cannot grow the table. A content view is keyed by URL NAME
  (`CONTENT_DETAIL_ROUTES`).
- **Search terms stay unknown.** `searches` counts requests that carried `q`/`search`/`query`, from the
  already-redacted query string. Zero-result counting is NOT built: there is no single search view to
  count it in (each list endpoint filters on `q` itself), and it must never be done by logging terms.

## Retention and ordering

- Aggregates: **25 months**, then deleted by `purge_aggregates`, which the command runs after every
  rollup (`--keep-months`). Raw rows: telemetry's 30 days full IP / 90 days row.
- **Rollup BEFORE retention.** `deploy/cron/edmat-analytics` runs `rollup_analytics --days 3 &&
  enforce_log_retention` nightly. Until that file, nothing scheduled `enforce_log_retention` at all.
- Days are UTC days (`settings.TIME_ZONE` is UTC).

## Extending

- A new feature surface → one line in `live.FEATURE_REGISTRY`; a new queue → `QUEUE_REGISTRY`
  (`timing: None` when the model has no decision timestamp — the dashboard then says "not recorded"
  instead of inventing one); a new content page → `classify.CONTENT_DETAIL_ROUTES`.
  **Mirrored by hand** in `frontend/src/lib/components/analytics/labels.ts` (house rule 13) — an
  unknown key falls back to the raw key there, so a missing label is ugly, not broken.
  `PayloadTests.test_every_registered_queue_and_feature_answers` catches a registry entry whose model
  or field is wrong (those are skipped silently at runtime so one bad row cannot take the page down).

## API

`/api/analytics/{overview,traffic,content,community,moderation,coverage,cohorts,clients,health,client-errors}/?days=7|30|90|365`
(default 30, anything else 400 `days_not_allowed`), `POST /api/analytics/recompute/` (yesterday +
today). **Staff only** (`is_staff`): 401 anonymous, 403 otherwise — the Mail tab's shape. A node
governor is not staff.

## Known limits (said, not hidden)

- **External referrers are rare by construction**: the SPA is static files served by Apache, so
  Django only sees API requests, whose Referer is EdMat's own page. Real entry referrers would need
  Apache's access log — a separate, server-side source nobody has wired up.
- A content "view" is a detail-endpoint GET: a page that refetches on a language switch counts twice.
- Moderation decision times exist only for material versions, concept revisions and governor
  applications; the other queues never stored when they were decided.

## Verify

`manage.py test analytics telemetry --keepdb`; `manage.py rollup_analytics --days 7` against the dev
shards; `frontend/e2e/analytics.mjs` for the dashboard.
