# e2e/ — check-counting browser scripts (playwright-core, no framework, no CI)

~21 `.mjs` scripts driven by `playwright-core` (a cached Chromium binary — no full playwright
install, no X server) against BOTH real dev servers. `test.md` at repo root documents each
script and how to run it. They are sequential check-counters printing pass/fail lines — not a
test-runner suite.

## Traps that have each burned a real session

1. **The register endpoint is throttled ~10/hour per IP in a per-process cache.** A long e2e
   session exhausts it and every later script fails in ways that look exactly like a code
   regression (pages with no menus, forms that won't submit). Fix: restart the backend. Kill it
   **by the PID holding the port** — `pkill -f "manage.py runserver…"` matches the shell issuing
   it and kills the replacement too. Prefer signing in as seeded demo users
   (`seed_demo_users` / `seed_demo_content`, password `password123`) over registering; scripts
   that need mutable state should reset it through the real API at the start of a run.
2. **`waitUntil: 'networkidle'` never fires on an authenticated page** — the notification SSE
   stream is a permanently in-flight request. Use `'load'` + explicit `waitFor()`s on the
   elements the checks read.
3. **Editing files while a script runs triggers a Vite HMR reload underneath it** — fake
   failures. Long chains of full page loads can also exhaust Chromium/Vite and time out a
   navigation; re-run against a fresh dev server before believing it.
4. **Ports:** scripts read `E2E_API`; several default to `:8000` while `test.md` documents
   `:8011` — set it explicitly. No script may hardcode a host/port.
5. **Whole-page text assertions are ambiguous** — one added sentence of copy once matched a
   membership check's phrase. Scope every assertion to a section/selector.
6. **Positional locators lie** — `page.locator('select').first()` once matched the header's
   language picker instead of the form's course picker. Scope to the owning form/section; target
   rows by text, not position (list ordering is newest-first and has flipped an assertion).
7. **`/pl/...` is not a locale URL** — Paraglide has no URL strategy; switch language through
   the picker.
8. **Vacuous passes are real**: a search check once passed against a stale backend because an
   unfiltered list also contained the test rows — assert exact counts, and look at the
   screenshots (several genuine bugs were found only that way).
9. Real HTML5 drag-and-drop can't be driven by Playwright's mouse API — dispatch synthesized
   `dragstart/dragover/drop/dragend` with a real `DataTransfer` against the DOM nodes.
10. A staff-bypassed check proves nothing about a FeatureFlag — assert kill-switch behavior as a
    non-staff user. (Seeded staff account: kasia.)
11. `page.on('response')`-style listeners can miss the first navigation's subresources; the
    first page of a fresh context also pays a ~3–5s Vite cold-compile cost absent from
    production — don't chase it.
12. **Anonymous list responses come from the 60 s read cache** (§17AB, TTL-only invalidation): an
    unauthenticated `fetch` of a list URL the script already hit can return a row it just
    deleted, so a "scratch data removed" check fails while the row is genuinely gone. Verify
    cleanup (and any post-mutation count) through an AUTHENTICATED request, which bypasses it.

13. **The login form's identifier field is `type="text"` (email OR username since the guardian
    accounts, §17AP)** — `form input[type="email"]` no longer matches anything on `/login`, and a
    script written before then times out at sign-in in a way that reads like a broken page. Use
    `form input[autocomplete="username"]` (the register form keeps a real email input).

14. **Every submit form requires an audience band** (§17AL) — select it by option, never by
    position: `form select:has(option[value="university"])`. The band select is often the FIRST
    select on the form now, so `form select').first()` picks the wrong control.
15. **The register form requires a birth year**: `form input[inputmode="numeric"]` (§17AP).
16. **Lists are narrowed to the reader's languages** (§17AQ). The corpus is Polish and a fresh
    context reads the English interface, so a browse list, a search picker or a reference picker
    can honestly be EMPTY for the rows a script just created. Either create rows with
    `language: 'en'`, give the account `content_locales: ['pl']` (`PATCH /api/auth/me/`), or set
    `localStorage['edmat.contentLocales'] = '["pl"]'` in a signed-out context. **For a signed-in
    context only the API route works**: the profile's own `content_locales` overwrite the
    localStorage extras the moment it loads (that is how classroom-overhaul's picker first came
    back empty). Put the account back afterwards.
17. **The settings page holds several forms** (the guardian panel has its own) — the Save you
    mean is `form.edit-form button[type="submit"]`.
18. **Running a course lives at `/courses/{id}/manage`** (the course page only links there); the
    chapter/lesson dialogs edit titles in `textarea`s, and the "Add something" panel is a title
    search picker, not an id box (§17AC).
19. **The claim scripts leave their claims behind** (no delete endpoint) and claims are unique per
    kind+topic — run the cleanup snippet in `test.md` before a re-run.
20. **`getByRole('button', { name })` matches substrings** — the header's "Aa" button's label
    says "Press to change", so `{ name: 'change' }` needs `exact: true`.

21. **bleach never falls through to `'*'` for a tag with its own attribute callable** — an
    `<img class="…">` lost its class on write while the read-side probe kept it, so a selector
    like `img.chem-drawing` found 0 in the posted comment and only a screenshot + an API probe
    told the two layers apart (§17AV). When a rendered check fails, probe `renderContent` in
    Node AND post through the API before blaming either side.
22. **Vite's dependency optimizer reloads the page mid-script the first time a new dependency
    is imported** ("optimized dependencies changed. reloading") — a modal opened before that
    reload simply vanishes. Warm the optimizer with one throwaway open before believing a
    timeout; `vite.config.ts` changes restart the server and can leave the old port bound.

23. **A backend model added this session needs `manage.py migrate` before the browser run**, not
    just `makemigrations`. A missing table surfaces as a 500 on one endpoint while every other page
    works, so the symptom reads as "that one feature is broken" rather than "the migration never
    ran" — check the server log for `no such table` before believing the feature.

24. **The interface default is POLISH (2026-09-23).** `baseLocale` in `project.inlang/settings.json`
    is `pl`, so a fresh context — no cookie, no storage — reads the Polish catalogue, and a script
    written before that date whose checks name English buttons now fails, or passes vacuously
    because its `includes()` matched nothing either way. `navbar-stages.mjs` failed five search
    checks and two picker checks on exactly this. Ask for English the way a person does:
    `import { englishContext } from './english.mjs'` and replace `browser.newContext(opts)` with
    `englishContext(browser, BASE, opts)` — it sets `PARAGLIDE_LOCALE=en` on the CONTEXT, before
    the first navigation, so even the server-rendered first paint is English. Already applied to
    eleven scripts; the rest are Polish-by-default now, which is what a real first-time visitor
    sees. A script testing the default itself (`language-default.mjs`) must NOT use it.

25. **Waiting for an element proves nothing about whether it WORKS.** Every control in the header
    is in the server-rendered HTML, so `.drawer-toggle` resolves — and clicks do nothing — until
    the bundle has hydrated, which on a dev server can be many seconds (trap 11). A
    `visibility: hidden` drawer still returns a bounding box, so geometry checks "pass" against a
    drawer that never opened. `phone-navbar.mjs` and `language-default.mjs` now wait for the root
    layout's own boot request instead of a fixed timeout:
    `page.waitForResponse((r) => r.url().includes('/feature-flags/'))`, registered BEFORE `goto`.

26. **In a WORKTREE, KaTeX's webfonts 403 and the maths renders in fallback glyphs.**
    `frontend/node_modules` is a symlink to the main checkout, so Vite serves the fonts from
    `/@fs/…/node_modules/katex/dist/fonts/*.woff2`, which is outside `server.fs.allow` and refused.
    Four to ten console errors per page with maths on it, and a script whose pass condition is
    "zero console errors" fails for a reason that has nothing to do with it. It is the dev server
    only — a production build serves the fonts itself — and it reproduces on content that predates
    whatever branch you are on, which is how to tell it apart from your own work in one step. Found
    by learning step G; `learning-record.mjs` filters it by URL (never by message: the console line
    for a refused request carries no URL in its text, so it has to be matched on the `response`
    event) and prints how many it ignored, so the suppression is never silent.

    Related and separate: `MathContent` fetches the ~380 KB renderer on demand, so statements are
    **raw LaTeX for a moment** after a page's header appears. A screenshot taken too early shows
    `\int_{-\infty}` as source and looks like a rendering bug. Wait for `.katex` before shooting.

27. **A panel that appears instantly is not a panel that has loaded.** `SectionDiscussion` renders
    its body the moment it is opened, carrying "Loading…", and fetches the thread after — so
    `waitForSelector('.section-discussion__body')` resolves against a panel with no composer in it
    yet, and `about-discussions.mjs` reported a missing composer that was simply not drawn. Register
    `page.waitForResponse((r) => r.url().includes('/api/discussions/thread/'))` BEFORE the click and
    await it. The same shape as trap 25, one layer down: there, waiting for an element proved
    nothing about hydration; here it proves nothing about the fetch the click started.

28. **Emptying `backend/cachedata/*` under a RUNNING backend 500s the next anonymous read.** The
    file cache holds its entries open, so deleting them out from under the process leaves one it
    still has a handle on, and the next anonymous list that reads it answers
    `OSError: [Errno 116] Stale file handle` — a 500 on whichever endpoint happened to own that
    entry (`/api/branches/`, in the run that found it), while every other page is fine. That reads
    exactly like "one feature is broken" and is nothing of the kind. **Stop the backend, clear
    `cachedata/`, start it again** — in that order — and only when a stale cached list is actually
    in the way (trap 12 is the cheaper answer: re-query as an authenticated user, which skips the
    cache entirely). Found 2026-10-06, closing step D.

29. **`scripts/check_accessibility.ts` reads `--base`/`--api` as CLI ARGUMENTS, not `E2E_BASE`.**
    It is the one script here that does not take the env vars every `.mjs` takes, and it has
    defaults (`:5174`, `:8000`), so `E2E_BASE=… npm run check:a11y` does not fail — it audits
    whatever is on port 5174, usually nothing, and reports every single page as a load problem.
    A "forty-one pages all broken" result is this, not a regression. Run it as
    `npm run check:a11y -- --base http://localhost:<fe> --api http://127.0.0.1:<be>` (the bare `--`
    is what gets the flags past npm to the script).

## Conventions

Zero console/page errors is part of every script's pass condition. Clean up scratch data through
the real API afterward and confirm by re-query. Script filenames still saying "classroom" refer
to the `courses` app (renamed).
