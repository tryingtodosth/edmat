# EdMat — Launch Checklist

Everything below is grounded in the actual current state of this codebase (checked directly, not
guessed) as of the end of Phase 3 — see [`CLAUDE.md`](./CLAUDE.md) for the full build history.
**Nothing here has been done yet.** This is a prototype that works correctly for local development;
it is not configured, secured, or populated the way a public site needs to be.

Grouped by how bad it is to skip. Nothing in "Blockers" should be skipped.

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
  **Permanent fix recommended, not confirmed applied:** add `credentials: 'omit'` to the `fetch()`
  call in `frontend/src/lib/api/client.ts` so the SPA never sends cookies at all (it's Token-only by
  design — removes this whole class of bug, including for any future admin testing signup in the
  same browser they use for `/admin/`).
- [ ] **New bug — the registration form's "Preferred interface language" field has no effect on the
  interface, ever.** Confirmed by direct code read, not guessed: `routes/register/+page.svelte`'s
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

- [ ] **Rotate `SECRET_KEY`.** `backend/config/settings.py` currently hardcodes
  `'django-insecure-x#=tushw$te2p$ti6@wo5(6o40kvc+k_n6s7x212pn9c0p_9-s'` directly in the file — the
  literal key Django's own scaffolding generated, never replaced. Generate a real one and load it
  from an environment variable, never commit it to the file. (`manage.py check --deploy` flags this
  as `security.W009` right now.)
- [ ] **Set `DEBUG = False`.** Still `True` (`config/settings.py`). With `DEBUG = True`, an
  unhandled exception shows a full traceback — including your `SECRET_KEY`, database queries, and
  local file paths — to anyone who triggers one. (`security.W018`)
- [ ] **Set real `ALLOWED_HOSTS`.** Currently `[]` (`config/settings.py`) — Django will refuse to
  serve ANY request once `DEBUG = False` until this lists your real domain(s). (`security.W020`)
- [ ] **Switch off SQLite for anything with real users.** `config/settings.py`'s `DATABASES` points
  at a single `db.sqlite3` file — fine for one developer, not for concurrent writes at any real
  traffic, and it lives on local disk with no replication. Move to PostgreSQL (CLAUDE.md's own
  Section 13 already flagged this as the intended production choice, never acted on).
- [ ] **Turn on HTTPS enforcement.** None of `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`,
  `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS` are set (`security.W004`/`W008`/`W012`/`W016`, all
  live warnings right now). Without these, session and CSRF cookies will happily travel over plain
  HTTP if a visitor's connection ever downgrades.
- [ ] **Update `CORS_ALLOWED_ORIGINS`.** Hardcoded to
  `localhost:5173`/`5174`/`127.0.0.1:5173`/`5174` only (`config/settings.py`) — swap for the real
  frontend domain(s), over HTTPS, or every API request from the deployed frontend will be silently
  rejected by the browser.
- [ ] **Update `PUBLIC_API_BASE_URL`.** `frontend/.env` points at `http://localhost:8000/api` — the
  deployed frontend needs this set to the real backend URL at build time (it's baked in at build,
  not read at runtime — `$env/static/public`).
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
- [ ] **No rate limiting anywhere.** DRF's throttle settings are unset (`config/settings.py` has no
  `DEFAULT_THROTTLE_CLASSES`/`DEFAULT_THROTTLE_RATES`). `/api/auth/login/`, `/api/auth/register/`,
  and every write endpoint (reviews, comments, submissions) can be hit as fast as a script wants.
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
