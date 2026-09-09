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
    `localStorage['edmat.contentLocales'] = '["pl"]'` in a signed-out context.
17. **The settings page holds several forms** (the guardian panel has its own) — the Save you
    mean is `form.edit-form button[type="submit"]`.
18. **Running a course lives at `/courses/{id}/manage`** (the course page only links there); the
    chapter/lesson dialogs edit titles in `textarea`s, and the "Add something" panel is a title
    search picker, not an id box (§17AC).
19. **The claim scripts leave their claims behind** (no delete endpoint) and claims are unique per
    kind+topic — run the cleanup snippet in `test.md` before a re-run.
20. **`getByRole('button', { name })` matches substrings** — the header's "Aa" button's label
    says "Press to change", so `{ name: 'change' }` needs `exact: true`.

## Conventions

Zero console/page errors is part of every script's pass condition. Clean up scratch data through
the real API afterward and confirm by re-query. Script filenames still saying "classroom" refer
to the `courses` app (renamed).
