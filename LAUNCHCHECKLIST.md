# EdMat — Launch Checklist

Everything below is grounded in the actual current state of this codebase (checked directly, not
guessed) — see [`CLAUDE.md`](./CLAUDE.md) for the full build history.

Grouped by how bad it is to skip. Nothing in "Blockers" should be skipped.

> **⚠️ This file was significantly out of date and has been corrected.** It previously opened with
> "Nothing here has been done yet," written at the end of Phase 3 and never revised, while most of
> the 🔴 Blockers had in fact been done in the meantime (the environment-driven `SECRET_KEY`/
> `DEBUG`/`ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS`, the TLS settings behind `EDMAT_HTTPS_READY`, real
> DRF throttling, `credentials: 'omit'`). A stale checklist is worse than no checklist — it sends
> you to re-do finished work while genuinely open items sit unread — so each item below now says
> what is actually true, verified against the code rather than carried forward. See
> **"Pre-deploy security pass"** below for what a recent audit found and fixed.

---

## 🟣 First production deployment (webek4.fuw.edu.pl) — issues hit this session, fixes applied

Everything below happened live on the actual `webek4.fuw.edu.pl` deployment (Apache reverse-proxying
`vite preview` on :4173 and `manage.py runmodwsgi` on :8000), logged in the order encountered so
nothing here gets lost or re-diagnosed from scratch later.

- [x] **Apache `ProxyPass` order was backwards — `/api`/`/admin` requests were silently routed to
  the Svelte server, not Django.** `mod_proxy` matches `ProxyPass` directives in file order (first
  match wins, not longest-prefix like nginx) — the vhost had `ProxyPass / http://localhost:4173/`
  listed *before* `ProxyPass /api ...`/`ProxyPass /admin ...`, so the catch-all `/` shadowed both.
  Symptom: `[404] GET /api/exercises/` printed in the `vite preview` terminal itself, not Django's.
  **Fixed for real** — reordered the vhost so `/api`, `/admin`, and the `Alias /static`/`/media`
  blocks come before the frontend catch-all `ProxyPass /`.
- [x] **`PUBLIC_API_BASE_URL` was hardcoded to `http://webek4.fuw.edu.pl:8000/api`**, bypassing the
  Apache `/api` proxy entirely and making every API call cross-origin (different port = different
  origin). `curl` "worked" because CORS is browser-only; the real SPA silently failed. **Fixed for
  real** — changed to a relative `/api` in `frontend/.env`, rebuilt (`npm run build`); now
  same-origin, no CORS needed at all.
  - Recommended, **not confirmed applied**: add `ProxyPreserveHost On` to the vhost (above the
    `/api`/`/admin` ProxyPass lines) so Django sees the real `Host: webek4.fuw.edu.pl` instead of
    `localhost:8000` — also why the DRF browsable API root showed self-links pointing at
    `localhost:8000`. Cosmetic today, worth doing for correctness.
- [x] **Django admin login: `CSRF Failed: CSRF token missing. Origin checking failed -
  http://webek4.fuw.edu.pl does not match any trusted origins.`** `CSRF_TRUSTED_ORIGINS` was never
  set in `backend/config/settings.py` (a real Django 4+ requirement, distinct from `ALLOWED_HOSTS`).
  **Fixed for real** — added `CSRF_TRUSTED_ORIGINS = ['http://webek4.fuw.edu.pl']`.
  - ⚠️ **New pre-launch item, not previously tracked in this checklist:** this needs to become
    `https://` once TLS is added, and should stay scoped to the real domain only — fold into the
    🔴 Blockers section once TLS lands.
- [x] **`vite preview` refused the host: "Blocked request. This host ("webek4.fuw.edu.pl") is not
  allowed."`** `allowedHosts` had been added at the top level of `vite.config.ts` — Vite requires it
  nested under `preview: { allowedHosts: [...] }` for the preview server specifically
  (`server.allowedHosts` is the separate dev-server equivalent). **Fixed for real** — moved it under
  `preview`.
- [ ] **Deleting a `User` from Django admin silently destroys real content, with no warning.**
  `Review.author`/`Comment.author`/`ExerciseSet.owner`/`Profile.user` are all `on_delete=CASCADE`
  and not nullable — deleting a user hard-deletes every review, comment, and study set they ever
  made, no confirmation, no way back short of a DB backup. Meanwhile
  `Exercise.submitted_by`/`ExerciseTranslation.translated_by`/`reviewed_by`/
  `ExerciseSubmission.reviewed_by`/`EditSuggestion.reviewed_by` are `SET_NULL` — those rows survive,
  just unattributed. Gave the reattachment queries for the `SET_NULL` columns (Django-shell
  `.filter(x__isnull=True).update(x=user)` per model, or equivalent raw
  `UPDATE ... WHERE x_id IS NULL`) — **not confirmed whether actually run**. The CASCADE-deleted rows
  (reviews/comments/study sets) are genuinely gone; only a pre-deletion backup could recover them.
  **Real fix worth doing later:** make user deletion in the admin deactivate (`is_active=False`)
  instead of hard-delete, or add a custom admin confirmation step that shows exactly what's about to
  cascade before it happens.
- [ ] **Registration: `Couldn't create your account: CSRF Failed: CSRF token missing.`** Caused by a
  leftover Django **admin** session cookie in the same browser (from the login-console fix above) —
  once `PUBLIC_API_BASE_URL` became same-origin, `fetch()`'s default `credentials: 'same-origin'`
  sent that cookie along with the SPA's Token-auth-only requests, and DRF's `SessionAuthentication`
  enforced CSRF against the SPA's own `apiClient`, which never sends a CSRF header by design.
  Immediate workaround given: log out of `/admin/` in that browser, or test in a private window.
  **✅ The permanent fix IS applied** — `frontend/src/lib/api/client.ts` line 61 passes
  `credentials: 'omit'`, so the SPA never sends cookies at all (it is Token-only by design).
  Verified directly; this item had been left marked unconfirmed. The browsable-API change in the
  pre-deploy pass below removes the other half of this interaction in production.
- [x] **✅ FIXED — the registration form's "Preferred interface language" field had no effect on the
  interface, ever.** `register/+page.svelte` now calls `setLocale(preferredLocale, { reload: false })`
  on a successful registration, followed by a full-page navigation to `/` (a bare `setLocale` would
  reload the *current* page, stranding a brand-new account back on `/register`; a `goto` would not
  re-evaluate the compiled messages). The remaining half — applying a *returning* user's stored
  `preferred_locale` on login or app boot — is deliberately left open as a product decision, see the
  pre-deploy section below. Original diagnosis, kept for context: Confirmed by direct code read, not guessed: `routes/register/+page.svelte`'s
  `handleSubmit()` sends `preferredLocale` to the backend (`authStore.register(...)`, saved
  correctly on `Profile.preferred_locale` server-side) and then just `goto(resolve('/'))` — it never
  calls Paraglide's `setLocale(preferredLocale)` (`$lib/paraglide/runtime`, the same function
  `LocaleSwitcher.svelte` already uses elsewhere). The value is stored and otherwise unused: nothing
  on login (`LoginView`) or app boot (`auth.svelte.ts`'s `init()`) reads a user's stored
  `preferred_locale` back and applies it either, so even a *returning* user's saved preference has
  zero effect on what they actually see. **Real fix:** call `setLocale(preferredLocale)` right after
  a successful register in `register/+page.svelte`, and — while touching this — decide whether
  login/app-init should also apply a logged-in user's stored `preferred_locale` on load.

---

## 🔴 Blockers — the site is actively unsafe or broken for real users without these

- [x] **Rotate `SECRET_KEY`** — **mechanism done, the value itself is still yours to generate.**
  `config/settings.py` reads `DJANGO_SECRET_KEY` from the environment; the committed
  `django-insecure-…` literal survives only as a local-dev fallback. **Newly hardened:** settings
  now *refuse to start* if `DEBUG=False` and that fallback is still in effect, so a missing
  environment can no longer bring the site up silently signing sessions with a key published in
  this repo. Still to do on the box: actually generate the key and export it in
  `/etc/apache2/envvars`.
- [x] **Set `DEBUG = False`** — **mechanism done.** Read from `DJANGO_DEBUG`, defaulting to `True`
  for local dev. **Newly hardened:** `DEBUG=True` together with a non-empty `ALLOWED_HOSTS` now
  refuses to start, since that combination only occurs when a production environment is
  half-applied — precisely the state that would publish tracebacks on a public domain.
- [x] **Set real `ALLOWED_HOSTS`** — **mechanism done.** Read from `DJANGO_ALLOWED_HOSTS`;
  `DEPLOYMENT.md` already exports the real domains. `CSRF_TRUSTED_ORIGINS` is env-driven too.
- [ ] **Switch off SQLite for anything with real users.** `config/settings.py`'s `DATABASES` points
  at a single `db.sqlite3` file — fine for one developer, not for concurrent writes at any real
  traffic, and it lives on local disk with no replication. Move to PostgreSQL (CLAUDE.md's own
  Section 13 already flagged this as the intended production choice, never acted on).
- [x] **Turn on HTTPS enforcement** — **done, gated behind `EDMAT_HTTPS_READY=true`.**
  `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` and the HSTS trio all switch
  on together when that variable is set, deliberately *not* unconditionally: enabling the redirect
  before certbot has issued a certificate would send every request to an HTTPS port nothing is
  listening on, taking the site down. `check --deploy` is clean with it on. Flip it after TLS is
  verified end-to-end.
- [x] **Update `CORS_ALLOWED_ORIGINS`** — **done, and largely moot.** `DJANGO_CORS_ALLOWED_ORIGINS`
  extends the dev list. Worth understanding rather than just ticking: the real vhost serves the
  built frontend and the API from the *same origin*, and `frontend/.env` in the deployment copies
  uses a relative `/api`, so production requests are same-origin and need no CORS header at all.
- [ ] **Update `PUBLIC_API_BASE_URL`** — **correct in the deployment copies, still wrong in this
  repo.** `FUW/CURRENTLY/frontend/.env` and `FUW/NEW/frontend/.env` both correctly use a relative
  `/api`. The repo's own `frontend/.env` still says `http://localhost:8000/api`, which is right for
  local dev and catastrophic if the production bundle is ever built from this tree — the value is
  baked in at build time (`$env/static/public`), so the deployed site would call `localhost` from
  every visitor's browser. **Check which tree you build from before shipping.**
- [ ] **Remove or rotate the `admin` / `admin12345` superuser.** I created this account during
  Phase 2/3 verification for convenience (see `README.md`'s "For your eyes only" section) — it is a
  real superuser with a trivially guessable password sitting in the database right now.
- [ ] **Decide what happens to the 5 demo accounts before launch.** `kasia@edmat.example` /
  `michal@...` / `ola@...` / `bartek@...` / `julia@...` all share the password `password123`,
  publicly documented on the login page itself (`auth_login_demoNote`). One of them (`u-kasia`) is a
  real moderator. Either delete them, or make very sure they're clearly cosmetic/demo-only and can't
  do real damage if someone finds the password (which is printed in this very repo).
- [ ] **Clean up my own verification test data**, or decide it doesn't matter for launch — see
  `README.md`'s "What's actually in the database right now" section for the exact list (3 fake
  exercises, a handful of test reviews/comments/edit-suggestions/translations, 5 throwaway
  registered accounts). None of it is malicious, but none of it belongs in a launched product either.

## 🔵 Pre-deploy security pass — findings, and what is left for you

A full pre-deploy audit of the current tree. Everything marked `[x]` is fixed in code and covered by
the test suite (357 passing); everything marked `[ ]` genuinely needs a human, and most of it needs
access to the server rather than to this repository.

**Fixed in this pass:**

- [x] **The `X-Forwarded-For` throttle bypass** — see the rate-limiting entry above. The single most
  serious finding: all per-IP rate limiting was defeatable with one forged header, and the same
  header set the IP recorded in the audit log, so log entries could be attributed to an address of
  the caller's choosing.
- [x] **Settings failed open.** A missing `/etc/apache2/envvars` brought the site up publicly with
  `DEBUG=True` and the committed secret key. Both dangerous combinations now refuse to boot.
- [x] **The DRF browsable API was served in production.** No `DEFAULT_RENDERER_CLASSES` meant
  `BrowsableAPIRenderer` rendered an HTML explorer of the entire API to any browser, and was the
  one place `SessionAuthentication` + CSRF were reachable from an ordinary browser session. Now
  JSON-only unless `DEBUG`.
- [x] **`.docx`/`.odt` uploads accepted any zip file.** Both are genuinely zip archives, so the MIME
  whitelist had to allow `application/zip` — which meant any archive renamed `.docx` passed. Now
  also checks for the member each format's specification requires.
- [x] **Deleting a user in the Django admin silently destroyed other people's content.** The bulk
  delete action is removed and a `Deactivate` action added — `is_active=False` blocks login without
  touching a single review, comment or study set. See `accounts/admin.py` for the full reasoning.
- [x] **Unmigrated telemetry log shards were completely silent.** `manage.py migrate` does *not*
  create the telemetry tables (`LogShardRouter.allow_migrate` confines them to the shard databases),
  and `RequestLogMiddleware` swallows every write failure by design — so forgetting
  `migrate_log_shards` produced a site that worked perfectly while recording no audit trail at all.
  `manage.py check --deploy` now fails loudly with the exact command to run.
- [x] **Registration's language selector did nothing.** The value was saved to
  `Profile.preferred_locale` and never applied. Now applied on successful registration.

**Left for you — these need the server, or a decision:**

- [ ] **Security headers on everything Apache serves.** Django's `SecurityMiddleware` only covers
  responses Django generates — i.e. `/api/` and `/admin/`. The SPA's own HTML, `/static/` and
  `/media/` are served directly by Apache and currently carry no `X-Content-Type-Options`, no
  `X-Frame-Options`/CSP `frame-ancestors`, and no `Referrer-Policy`. So the actual application has
  no clickjacking protection, and user-uploaded files are served same-origin without `nosniff`. Add
  to the vhost (`a2enmod headers` first):
  ```apache
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "SAMEORIGIN"
  # Uploaded files: never let a browser render one inline in this origin.
  <Location /media/>
      Header always set Content-Disposition "attachment"
      Header always set Content-Security-Policy "sandbox"
  </Location>
  ```
- [ ] **The `admin` / `admin12345` superuser is real and live.** Confirmed by checking the password
  hash directly, not inferred. Delete it or change the password on the deployed database — the local
  `db.sqlite3` is not the one serving traffic.
- [ ] **Five demo accounts still share `password123`**, one of them (`u-kasia`) a moderator, with
  the password printed on the login page. Plus leftover test accounts (`student1`,
  `realuser-abc123`, three `verify-*`) and 12 auth tokens that never expire.
- [ ] **The deploy configuration is not in version control at all.** `FUW/` — both the Apache vhost
  and `DEPLOYMENT.md` — is untracked (`git ls-files FUW` returns nothing). The one part of this
  system that must be reproducible exists only as loose files on one machine. Worth committing, with
  secrets kept in `envvars` where they already are.
- [ ] **`FUW/NEW` is a stale snapshot.** Dated 30 Jul against a 31 Jul tree, and missing the entire
  `telemetry` app — its middleware, its `DATABASES` entries, and the log-shard config. Deploying it
  ships code older than this repo; deploying this repo leaves you without a vhost or runbook.
  Reconcile the two before shipping, and re-run `migrate_log_shards` on the box afterward.
- [ ] **`pip-audit` has never been run.** It could not be installed here (this sandbox has no
  `ensurepip`). Run it on the server. The frontend side is genuinely clean: all 5 `npm audit`
  findings are build-time only (eslint/postcss/`@sveltejs/kit`-under-`adapter-static`) and none
  reach the shipped bundle.
- [ ] **Registration allows account enumeration.** Distinct "username taken" / "email already
  registered" errors let an attacker confirm whether an address has an account. Mitigated by the
  `register` throttle now that the bypass above is closed, but still a real disclosure — worth a
  deliberate decision rather than leaving it unnoticed.
- [ ] **Decide whether a returning user's stored `preferred_locale` should be applied on login.**
  Deliberately *not* changed in this pass: doing so would silently override a language the visitor
  had chosen with the switcher during that session, which is a product call, not a bug fix.

## 🟠 Missing functionality that real users will hit immediately

- [ ] **Password reset doesn't actually work.** `accounts/views.py`'s `PasswordResetView` is a
  deliberate stub — it always returns `200 OK` ("if that email is registered, a reset link would be
  sent") and **never sends anything, because no email backend is configured at all** (no
  `EMAIL_BACKEND`/`EMAIL_HOST` anywhere in `config/settings.py`). Anyone who forgets their password
  today is permanently locked out. This needs: an email backend (SMTP, SES, Postmark, whatever),
  Django's real `PasswordResetTokenGenerator` flow, and a "set new password" page/endpoint that
  doesn't exist yet either.
- [ ] **No email verification on registration.** `RegisterSerializer` creates a real, immediately-
  usable account from any email address with no confirmation step — nothing stops someone
  registering `notreal@fake.invalid` or impersonating someone else's address in a review/comment.
- [x] **Rate limiting** — **done (Section 17Q), and a real bypass in it has since been found and
  fixed.** Global `anon`/`user` backstops plus scoped `login`/`login_username`/`register`/
  `password_reset`/`avatar`/`geocode` rates all exist. The bypass: `NUM_PROXIES` was `1`, but the
  real vhost runs Django under embedded mod_wsgi rather than a reverse proxy, so DRF was keying
  throttles on a client-supplied `X-Forwarded-For` — rotating it gave a fresh budget per request
  and the login limit never engaged. Measured, not theorised: 15 forged attempts all returned 401
  where an honest client saw 429 after 10. Fixed by defaulting `EDMAT_NUM_PROXIES` to `0`, with a
  regression test that fails if it is set back to `1`.
- [x] **Throttle counters are now shared across worker processes.** With no `CACHES` configured,
  Django fell back to per-process `LocMemCache`, so each of the vhost's `processes=2` workers kept
  its own counters and every rate was effectively doubled. Now a `FileBasedCache` on local disk.
  Move to Redis/Memcached if this ever runs on more than one machine — a file cache is shared
  per-host, not per-cluster.
- [ ] **No bot/spam protection on registration or submission forms** (no CAPTCHA, no honeypot,
  nothing) — a public, unauthenticated `/register` plus a moderation queue that trusts every
  submitted exercise/review/comment as coming from a real person is an open invitation for spam once
  the URL is public.
- [ ] **Auth tokens never expire.** DRF's `TokenAuthentication` issues one token per user that's
  valid forever until manually deleted — there's no session timeout, no rotation. Worth deciding if
  that's an acceptable risk or if this needs a real expiring-token/refresh-token scheme before
  launch.

## 🟡 Infrastructure that doesn't exist yet

- [ ] **A real WSGI/ASGI server.** Both servers right now are `manage.py runserver` and `vite dev` —
  Django's own runserver prints "do not use in a production setting" on every startup. Need
  gunicorn/uwsgi behind nginx (or equivalent) for the backend, and a real static file host (or
  `adapter-node`/a CDN) for the built frontend.
- [ ] **Real media file hosting.** Material PDFs currently live in `backend/media/`, served by
  Django's dev server via `static()` in `config/urls.py` — that code path is explicitly gated on
  `if settings.DEBUG`, so it **stops working entirely** the moment `DEBUG = False` is set (which is
  itself a blocker above). Needs a real file host (S3, a CDN, or at minimum nginx serving
  `MEDIA_ROOT` directly) before the "Blockers" section's `DEBUG = False` change ships, or every
  material download link breaks.
- [ ] **Database backups.** Nothing automated exists. A single `db.sqlite3` file with no backup
  strategy is one bad `rm` or disk failure away from losing the entire corpus, every account, and
  all community content.
- [ ] **Error tracking / logging.** No Sentry (or equivalent) wired in on either side, no structured
  logging configured beyond Django's own console output. You'll find out about production bugs from
  users, not from monitoring.
- [ ] **A staging environment.** Nothing to test a real deploy against before it's live.
- [ ] **A CI pipeline.** `npm run check`/`lint`/`build` and `manage.py check` all exist and pass
  today, but nothing runs them automatically — a future change could silently break one without
  anyone noticing until launch.

## 🟢 Content, legal, and policy — CLAUDE.md's own still-open questions

These were flagged as genuinely unresolved throughout the build (see CLAUDE.md Section 18) —
carried forward here since "launch" is exactly the point they stop being deferrable:

- [ ] **Corpus copyright/provenance.** The 742 exercises are transcribed from real university course
  material (exam/midterm/exercise-sheet problems). Whether redistributing them publicly — even
  reworded, even with original solutions — needs instructor/institution permission is genuinely
  unresolved (CLAUDE.md Section 18, item 2). Worth real legal review before this goes beyond a
  personal/prototype deployment, not assumed clear.
- [ ] **Terms of service and a real privacy policy.** Nothing exists. A public site that collects
  emails, passwords, and lets people publish content under their own name needs both, especially
  given the account data involved (see GDPR note below).
- [ ] **GDPR / data protection compliance**, if this will realistically be reached by EU users
  (the whole corpus and UI are Polish/English) — a privacy policy alone isn't compliance. Needs a
  real data-retention policy and, practically, a way for a user to request account deletion (no
  "delete my account" flow exists in the API today).
- [ ] **A moderation policy / code of conduct**, published somewhere a submitter can actually read
  before they post — right now moderation exists as a mechanism (`u-kasia`'s queue) with no stated
  rules behind it.
- [ ] **Decide the verified-contributor fast path** (CLAUDE.md Section 18, item 4) — right now
  literally everything queues for moderation regardless of who submitted it; decide if that's the
  permanent policy or if trusted contributors should ever skip the queue.
- [ ] **Decide `Database-of-Student-Exercise`'s fate** (CLAUDE.md Section 18, item 3) — does the
  original static site stay up as a mirror/fallback, or get retired once EdMat is the real thing?

## 🔵 Quality passes that were explicitly deferred to "Phase 4," never started

- [ ] **A full KaTeX-compatibility sweep across all 742 exercises.** The one real LaTeX rendering
  bug found so far (CLAUDE.md's Section 11) was caught reactively, from a single user report, not by
  systematically rendering the whole corpus and checking for unsupported commands — which
  CLAUDE.md's own Section 11/18 always said this needed before shipping. KaTeX supports a smaller
  LaTeX command subset than the MathJax the original static site used; there could be more silent
  breakage in exercises nobody's opened yet.
- [ ] **An accessibility pass.** Never done — keyboard navigation, screen-reader labels, color
  contrast in both light/dark themes, and alt-text-equivalent handling for rendered math (KaTeX can
  emit this, but it needs deliberate configuration, not just "using KaTeX").
- [ ] **Real load testing**, especially of the moderation queue under actual concurrent moderator
  use — untested beyond one moderator account in a single Playwright session.
- [ ] **A dependency security audit.** `npm audit` on the frontend currently reports 3 low-severity
  vulnerabilities (a transitive `cookie` package issue via `@sveltejs/kit`/`adapter-static` —
  `GHSA-pxg6-pf52-xh8x`); the fix available (`npm audit fix --force`) is a breaking SvelteKit
  downgrade, so it needs a deliberate look, not a blind `--force`. The Python side
  (`requirements.txt`) has never been run through an equivalent audit (e.g. `pip-audit`) at all.

## ⚪ Smaller gaps, worth knowing about even if not launch-blocking

- [ ] **No avatar upload endpoint.** `Profile.avatar` exists as a real model field
  (`accounts/models.py`) and is in the API response shape, but nothing lets a user actually set
  their own avatar — `/api/auth/me/` is GET-only, there's no PATCH.
- [ ] **No "delete my account" flow** (ties into the GDPR item above) — an account, once created,
  can't currently be removed by its own owner through the app.
- [ ] **Locale-prefixed URLs were never built.** CLAUDE.md Section 15 originally sketched
  `/{locale}/...` routing; the real routes (`/fields`, `/courses/...`, etc.) aren't locale-prefixed.
  Not broken — Paraglide's own cookie-based locale detection still works — just a divergence from
  the original plan worth knowing about if URL-based locale switching ever becomes a real
  requirement (e.g. for SEO in two languages).
- [ ] **No sitemap or SEO consideration at all** for a content site whose entire value is being
  findable.

---

### Suggested order of attack

1. Everything in 🔴 — none of it is optional, and several items (password reset, admin/demo
   accounts) are the kind of thing that causes real harm if skipped, not just embarrassment.
2. 🟠 alongside 🟡 — the missing-functionality items and the infrastructure items are tightly
   coupled (e.g. media hosting has to land *before* `DEBUG = False` ships, or downloads break).
3. 🟢 in parallel, since legal/policy review takes real calendar time and shouldn't block engineering
   work — but nothing here should actually launch before the copyright question specifically gets a
   real answer.
4. 🔵 and ⚪ as a genuine pre-launch QA pass, not an afterthought — especially the KaTeX sweep, since
   a wrong-looking math exercise is the single most damaging thing this specific product could show
   a new visitor.
5. 🟤 is post-launch by definition — it needs real users before any of its numbers mean
   anything — but the email-verification and rate-limiting items in 🟠 are prerequisites for it,
   worth knowing while doing them.

---

## 🟤 Trust system — REP, SKILL and ENERGY (design, nothing built)

Appended as a design brief, not a checklist of known gaps: unlike everything above, none of this
exists in any form today. It replaces the current all-or-nothing trust model (`is_staff` for
moderators, one `is_verified_contributor` boolean for everyone else) with a earned-permission ladder,
and moves administration off Django admin onto our own pages.

**Numbers below are a starting proposal, not tuned.** Every threshold, weight and cost is a guess
that needs real traffic to calibrate — they're written down concretely so they can be argued with
and changed, not because they're right.

### 0. Administration moves off `/admin`

Django admin stays as break-glass for superusers only. Everything routine gets a real page, extending
the existing `/moderation` surface (which already has a Flags tab from the kill-switch work):

- [ ] **Settings page** — platform settings, currently only reachable as `FeatureFlag` rows and
  `settings.py` constants. Thresholds, energy costs and tier requirements below all belong here, not
  in code, or they can never be tuned without a deploy.
- [ ] **Verification queue** — review and grant the multi-step verification levels in §3.
- [ ] **Tier management** — see and override a user's tier, with the reason recorded.
- [ ] **Appeal panel** — §4's investigation flow.
- [ ] **Field-skill overview** — who is trusted in which field, and where nobody is.

### 1. Three separate quantities

They answer different questions and must not be collapsed into one score:

| Quantity | Scope | Answers | Moved by |
| --- | --- | --- | --- |
| **REP** | one per user, global | how much the platform trusts your judgement → your tier | votes on your content, accepted contributions, moderation decisions upheld or overturned |
| **SKILL** | one per (user, `taxonomy.Field`) | whether you're competent *in this subject* | votes and endorsements on your work in that field, weighted by content difficulty |
| **ENERGY** | one per user, regenerating | how much you may do right now — **1 energy = 1 comment/message** | spent per action, regenerates on a clock; cap and rate set by tier |

### 2. Two separate ladders

The original sketch had one ladder, where the top rung was "moderation takes effect immediately."
That does not survive contact with USOS (§2a): granting every verified UW member the top rung would
hand tens of thousands of people a one-click delete button, and the appeal panel — peers "at or above
the actor's tier" — would degenerate into "everybody," which is no panel at all.

So capability and authority are split. **What you may DO is a tier, and it can be granted by
identity. What you may do TO OTHER PEOPLE is a mod level, and it can only ever be earned.**

#### 2a. Capability tier — what you may do

Cumulative. Reached either by earning REP or, for a UW member, immediately via USOS (§3).

| Tier | Grants | REP band | Energy cap | Regen |
| --- | --- | --- | --- | --- |
| **S** | nothing further to unlock — full participation | 2500+ | 300 | 8/h |
| **A** | upload any accepted file format | 750–2499 | 150 | 4/h |
| **B** | share links | 200–749 | 80 | 2/h |
| **C** | write reviews | 50–199 | 40 | 1/h |
| **D** | comments/messages post directly | 10–49 | 20 | 1/2h |
| **E** | may comment, but every comment queues for approval | 0–9 | 5 | 1/6h |
| **F** | suspended — read only | below 0 | 0 | — |

#### 2b. Mod level — what you may do to other people's work

**Never granted by identity, never by USOS, never by capability tier.** Two of these already exist in
the codebase and should be extended rather than duplicated: `NodeGovernor` (a real Field- or
Course-scoped moderator, Section 17M) and `is_staff`.

| Level | Authority | How it is reached | Exists today? |
| --- | --- | --- | --- |
| **M0** | none — can report, nothing more | default, including every USOS-verified member | — |
| **M1** | reports carry real weight; can send content to the queue, never remove it | capability tier ≥ B and no upheld complaint in 90 days | no |
| **M2** | acts on the queue, but only in fields where SKILL ≥ C; every decision appealable | capability tier ≥ A, M1 for 30 days, granted by an M3+ | no |
| **M3** | full authority within one Field or Course, including immediate effect | granted by staff — this is `NodeGovernor` | **yes** |
| **M4** | platform-wide | `is_staff` | **yes** |

**Immediate, unqueued effect — the old S-tier power — now belongs to M3 and above only.** That is the
single change that keeps §4's accountability meaningful once tier S is handed out in bulk.

#### 2c. Vote weight comes from REP, not from tier

| REP band | Weight |
| --- | --- |
| S (2500+) | 16 |
| A (750–2499) | 8 |
| B (200–749) | 4 |
| C (50–199) | 2 |
| D (10–49) | 1 |
| E / F | 0 |

Deliberately keyed on the REP band a person actually earned, **not** on their effective capability
tier. A USOS-verified fresher holds tier S — they can upload, link, review and comment freely, which
is what trusting a real UW member should mean — while their vote still weighs 0 until they have a
record. Without this split, one first-year could hide anything on the site on their first afternoon.

**Hiding content still takes 16 points of weighted downvote**, and hiding is now additionally gated on
the content having been queued by an M1+ or crossing that threshold — so it is a real consensus of
people who have built standing, not a single click. `Comment.is_removed` is already a tombstone rather
than a hard delete, so there is somewhere for this to land without losing the record.

### 3. How a tier is reached — USOS, or the earned ladder

`effective_tier = max(usos_tier, min(rep_tier, verification_ceiling))`.

**A UW member gets tier S the moment their USOS account is connected. Everybody else earns it**, via
the ladder below — EdMat is a public study resource, not a UW-only intranet, and an alumnus, a
student at another university, or someone revising alone must still have a real path in.

| Step | Raises ceiling to |
| --- | --- |
| **USOS account connected (§3a)** | **S, immediately** |
| 1. Email confirmed (the 🟠 item above — this system needs it) | E |
| 2. Display name + declared field of study | D |
| 3. Institutional email or student ID | C |
| 4. Human check — CAPTCHA plus a cooling-off period since registration | B |
| 5. Vouched for by 2 distinct A/S contributors | A |
| 6. Manual grant — recorded, revocable | S |

#### 3a. USOS connection

USOS is the university's own student record system, and connecting to it proves — from the
institution's own database rather than from anything the user typed — that this is a real, currently
enrolled person, which of them they are, and what they study. It is a far stronger claim than steps
3–6 above were ever approximating, which is why it replaces all of them at once.

- [ ] **OAuth against the USOS API** (`apps.usos.edu.pl` / UW's own installation). Note it is
  **OAuth 1.0a**, not OAuth 2 — an older flow with request-token/authorize/access-token legs and
  signed requests, so a modern OAuth2 client library will not do.
- [ ] **This needs an administrative step before any code runs**: the application must be registered
  with the university to obtain a consumer key and be granted the scopes it needs. That is a request
  to the operator, not something engineering can unblock on its own — start it early.
- [ ] **Request the narrowest scopes that work.** Identity and enrolment are needed; grades are not,
  and must never be requested. Asking for more than is used is both a privacy failure and a reason
  for the university to refuse the registration.
  - **Amended, because the two halves of this turned out not to conflict.** A person may now choose
    to transfer their own diploma and transcript. That does not weaken the rule above — it makes
    grades a **second, separate authorization** the account holder initiates, never part of the
    default grant (`identity.usos.BASE_SCOPES` vs `GRADES_SCOPE`). The registration request should
    say exactly that, since "an optional scope the user asks for" is a very different thing to ask a
    university for than "a scope we always take".

> **Status: the ground is built, the connection is not — see CLAUDE.md Section 17S.**
> `backend/identity/` has the models, the consent model, the per-institution seam
> (`active_connector()` is the one line a real client replaces), the standing calculation, and 36
> tests exercising all of it through a stand-in connector. What remains is genuinely the two items
> above: an OAuth 1.0a client, and a consumer key from each university. Also built alongside it:
> **School/Google/Apple/GitHub sign-in as honest drafts** — each button opens a modal computed from
> real settings describing what exists and what is missing, and none of them can sign anybody in.

**What connecting grants**, all of it immediate:

- [ ] **Capability tier S.** Upload, links, reviews, comments, no approval queue.
- [ ] **Mod level M0.** Explicitly nothing — see §2b. Being a real student is an identity claim, not
  evidence of judgement about other people's work.
- [ ] **Vote weight 0 until REP is earned** — see §2c.
- [ ] **Seeded SKILL from real enrolment.** USOS knows which courses this person has actually taken,
  and those map onto `taxonomy.Course` directly. Someone who passed Analiza Matematyczna II has a
  real, institutionally-attested claim to competence in it that no amount of upvoting could establish
  as cheaply. A conservative seed (enough for tier C in that field, not more) is the honest version:
  having taken a course is evidence, not proof.
- [ ] **A staff account is a different claim from a student one.** USOS distinguishes them; a lecturer
  or TA is the obvious candidate pool for M2/M3, though still by grant rather than automatically.

**What it closes, from this section's own open questions:**

- [ ] **Sockpuppets.** One USOS identity, one account — the single most effective anti-abuse measure
  available here, and one no amount of energy-cost tuning could match.
- [ ] **Cold start.** The original ladder was unreachable at launch (nobody could be vouched for by
  two A/S contributors when none existed). USOS makes the entire founding population tier S on day
  one, so the earned ladder only ever has to serve people from outside UW.

**What it does not solve, and must be designed for:**

- [ ] **Affiliation lapses.** Students graduate and staff leave. A tier granted once and never
  re-checked becomes a permanent grant to someone the university no longer knows. Re-verify on a
  schedule (once a semester), and on lapse fall back to the *earned* tier rather than dropping the
  account to F — someone who contributed for three years should not be demoted to read-only for
  graduating.
- [ ] **Everyone at UW is not everyone who matters.** ~40,000 people is not a small trusted circle,
  and USOS proves enrolment, not good faith. This is precisely why the mod-level split in §2b exists.
- [ ] **The privacy policy must be updated before this ships.** `/privacy` currently states that no
  data goes to any third party except OpenStreetMap. Connecting USOS adds a new category of personal
  data (university identity, affiliation, enrolment) and a new recipient, and needs its own section,
  its own retention rule, and a statement of what is requested and what deliberately is not.
- [ ] **Availability.** If USOS is down, connection must fail into the ordinary earned ladder rather
  than locking people out of a study site the night before an exam.

### 4. Accountability — what makes an M3 grant safe to hand out

Immediate, unreviewable removal by one person is the most dangerous thing in this design. It is now
confined to M3+ (§2b) rather than to a tier tens of thousands of people hold, but it still needs to
be answerable: every hide and every immediate action writes an appealable record.

- [ ] An appeal convenes a panel of peers **at or above the actor's own MOD LEVEL** — not their
  capability tier, which after USOS says nothing about judgement — excluding the actor and the
  content's author. Quorum 3 for an ordinary hide, 5 for an M3+ immediate action.
- [ ] Decision **upheld** → actor **+15 REP**.
- [ ] Decision **overturned** → actor loses REP scaled by the authority they exercised: **M1 −20,
  M2 −60, M3 −160, M4 −250**. The more power you used, the more being wrong costs.
- [ ] **3 overturns in 90 days** → automatic demotion of one MOD LEVEL. Re-earnable.
- [ ] **Demotion never touches the capability tier.** Being wrong about someone else's work is not
  evidence you can no longer be trusted to upload your own, and conflating the two would make every
  moderator quietly reluctant to make a call. This is the practical payoff of splitting the ladders.
- [ ] Panel members who vote against the panel's own eventual consensus take a small penalty, so
  sitting on a panel isn't a free rubber stamp.

### 5. Field-scoped skill

SKILL(user, field) moves on the same events as REP, but only for content in that field, multiplied by
the difficulty of the linked material — `Exercise.difficulty` already exists: **easy ×1, medium ×2,
hard ×3**. Same S–F letters, lower bands, since field activity is narrower: F <0, E 0–4, D 5–24,
C 25–99, B 100–374, A 375–1249, S 1250+.

- [ ] **Endorsements — the "extra effort" review.** A user spends real energy to tag someone's
  comment with a field/skill/tag *and* rate it; that boosts the author's SKILL in that field
  specifically, not their global REP.
- [ ] **Endorsements are themselves reviewable** — was the tag even right? A bogus endorsement costs
  the endorser, or endorsement becomes a trivial way to pump a friend's skill.
- [ ] **Proposal, not in the original brief:** moderation authority should be capped by field
  competence — an M2 may only act where their own `skill_tier(field)` is C or better, and even an M3's
  scope is a Field or Course rather than the whole platform (which `NodeGovernor` already enforces
  today). Without this, someone with authority can delete specialist content they have no ability to
  judge, which is exactly the failure the skill axis exists to prevent. USOS makes this cheaper than
  it looks: enrolment already says which courses a person has actually taken (§3a).

### 6. Energy costs

| Action | Cost |
| --- | --- |
| Comment / message | **1** (the unit) |
| Vote | 0 — free, but weighted by tier |
| Share a link | 2 |
| Write a review | 3 |
| Skill endorsement | 5 |
| File upload | 10 |
| Flag content | 1, refunded if the flag is upheld |
| Serve on an appeal panel | 0, and +2 REP |

### 7. REP events

| Event | REP |
| --- | --- |
| Your comment upvoted | +2 × difficulty multiplier |
| Your comment downvoted | −2 |
| Review accepted | +10 |
| Translation published | +15 |
| Exercise submission accepted | +25 |
| Material upload accepted | +25 |
| Skill endorsement received | +5 |
| Your flag upheld | +3 |
| Your moderation decision upheld | +15 |
| Your moderation decision overturned | −(vote weight × 10) |
| Your content hidden by consensus | −20 |

- [ ] **Daily cap of +50 REP from votes alone**, or a coordinated group can farm someone to A.

### 8. Milestones — moving between levels

- [ ] **Hysteresis.** You promote at the threshold but only demote at **80%** of it — reach 200 for B,
  keep B until you drop below 160. Without this, anyone sitting on a boundary flaps tier daily.
- [ ] **Dwell time.** Minimum **7 days** at a tier before promoting again (E→D exempt, it should
  follow email confirmation immediately). Stops one burst of activity vaulting a new account to A.
- [ ] **Inactivity decay.** −2% REP per month with no actions, floored at the bottom of the current
  tier — standing tracks current engagement without demoting someone for taking a holiday. Decay
  applies to REP only, **not** SKILL: standing lapses, knowledge doesn't.
- [ ] **Every transition writes a record** (who, from, to, why, when), visible on the tier-management
  page. A tier must never change silently.
- [ ] **F is never automatic.** Suspension requires a real moderation action, never a REP threshold —
  auto-suspension on negative REP is the single easiest thing in this design to weaponise by
  brigading a user.

### 9. What this replaces or absorbs

- [ ] `Profile.is_verified_contributor` becomes **derived** (`tier >= A`), which after USOS means
  every UW member holds it. Keep the column through the migration as a manual override for the non-UW
  population, then retire it.
- [ ] **`NodeGovernor` (Section 17M) IS M3, and `is_staff` IS M4** — both already built, both already
  scoped, both already carrying `granted_by`. Mod levels should extend that model rather than
  introduce a second, parallel notion of "who may moderate what"; M1/M2 are the genuinely new rungs.
- [ ] The verified-contributor fast path in 🟢 (auto-publish for trusted submitters, CLAUDE.md
  Section 18 item 4) needs revisiting once tier S is granted in bulk: "a verified contributor's
  submission publishes with no review" is a very different policy when that means every UW student
  rather than a handful of hand-picked accounts.
- [ ] `RequireVerifiedContributorForMaterialUploads` and the `material_uploads_verified_only` flag
  (`moderation/permissions.py`) generalise into "minimum tier for this action", configurable per
  action from the settings page rather than one hardcoded boolean per feature.
- [ ] Energy **partially** covers the "No rate limiting anywhere" item in 🟠 — but it's an
  application-level budget, not a defence against someone hammering `/api/auth/login/`. DRF
  throttling is still needed underneath it.

### 10. Open questions — genuinely unresolved, not deferred detail

- [x] ~~**Sockpuppets and brigading.**~~ Largely answered by USOS (§3a): one university identity, one
  account. Still open for the non-UW population, who reach tier S through the earned ladder with no
  equivalent identity check behind them — a ring of real accounts from outside UW can still coordinate
  votes, and a discount for accounts that habitually vote together remains real work.
- [x] ~~**Cold start.**~~ Answered by USOS: the founding population is tier S on day one, so "vouched
  by 2 A/S contributors" no longer has to bootstrap from nothing. **Mod levels still cold-start
  though** — M2 requires an M3+ to grant it, and M3 requires staff, so the first appeal panels have to
  be convened from a handful of manually granted accounts. Decide what an appeal does before enough
  M2s exist to form a quorum.
- [ ] **What happens to a UW member's tier when they lose access to their own account?** USOS is the
  identity anchor, so account recovery is now partly the university's problem rather than entirely
  ours — worth confirming that a re-connection restores the same account rather than creating a
  second one.
- [ ] **Is the energy cap or the regen rate the real limit?** Everyone refills to cap overnight, so
  for anyone who isn't posting continuously the regen rate never binds and only the cap matters.
- [ ] **Does SKILL gate reading?** Assumed no — this is a study resource, and gating who may *read*
  hard material would defeat the point. Worth confirming that's the intent.
- [ ] **Do downvotes cost the voter anything?** Free downvoting is cheap to abuse; charging for it
  suppresses legitimate signal. Unresolved.
