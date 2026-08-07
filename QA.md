# EdMat — QA Research

Compiled 2026-07-29 by re-verifying `CLAUDE.md`/`LAUNCHCHECKLIST.md`'s own claims against the live
repo (ran the real test suite, `npm run check`, `npm audit`, inspected the live `db.sqlite3`, grepped
for stale TODOs) rather than re-summarizing those two documents blind. Findings below are split into
**newly found this session** (not previously documented anywhere) and **confirmed still-open**
(already flagged in `LAUNCHCHECKLIST.md`/`CLAUDE.md`, re-checked and found still true today). Where a
claim in those docs turned out to be *stale* (already fixed, or no longer accurate), that's called out
explicitly rather than silently repeated.

---

## 1. Needs your decision

These aren't bugs — they're calls only you can make. Nothing downstream should proceed on some of
these without an answer first.

1. **Who is `piotrek` / `asd@asd.asd`?** A live superuser account in `db.sqlite3` that appears
   nowhere in any doc — not the known `admin`/`admin12345` account, not one of the 5 documented demo
   accounts. **Newly found.** If this is your own scratch account, fine, but it's a second undisclosed
   superuser sitting in the same database `LAUNCHCHECKLIST.md` already asks you to clean up — worth
   deciding its fate explicitly rather than it surviving into a real deploy by accident.
2. **What happens to `FUW/`?** A 177 MB, entirely untracked, non-gitignored directory
   (`FUW/CURRENTLY.zip` + `FUW/backups/` + `FUW/CURRENTLY/`) sitting inside the `edmat` project root.
   **Newly found.** Nothing in `CLAUDE.md`/`README.md` mentions it, it isn't part of EdMat's own
   architecture, and its name/contents suggest an unrelated project (`FUW` = Wydział Fizyki UW) that
   may have landed here by accident. Left untouched — decide whether it belongs here at all, should be
   moved out, or at minimum gitignored so a future `git add -A` doesn't try to commit 177 MB of
   unrelated data.
3. ✅ **Which `requirements.txt` is canonical — root or `backend/`? Resolved (2026-08-07):
   `backend/requirements.txt`**, with the root file reduced to a one-line `-r backend/requirements.txt`
   include. Not the "consolidate to one file" this originally proposed, because that turned out to
   break the server: **the deploy rsyncs only `backend/`, `frontend/` and `deploy/`**
   (`deploy/DEPLOYMENT.md` step 1), so the root file never reaches it and cannot be canonical, while
   local dev installs from the root because that is where a fresh clone's `.venv` lives (`README.md`
   step 1, `setup.sh:84`). An include is what serves both consumers from one list. See Fix #1 below.
4. **Is this still heading toward a real public launch, or staying a personal/prototype deployment?**
   Almost everything in `LAUNCHCHECKLIST.md`'s 🔴/🟠/🟡 sections only matters if the answer is "public
   launch" — worth a real answer since it reprioritizes everything below (e.g., password reset/email
   verification/rate limiting are all moot for a single-user prototype, urgent for a public site).
5. **Corpus copyright/provenance** (`CLAUDE.md` §18 item 2, `LAUNCHCHECKLIST.md` 🟢) — still
   genuinely unresolved: do the 742 exercises, transcribed from real UW course material, need
   instructor/institution permission before public redistribution? No decision has been made; this
   blocks "public" regardless of every technical fix below.
6. **Terms of service, privacy policy, GDPR posture, moderation policy/code of conduct** (`CLAUDE.md`
   §18, `LAUNCHCHECKLIST.md` 🟢) — none exist. Needs real legal review, not engineering work, before
   launch.
7. **Is the verified-contributor auto-publish policy (§18 item 4) still what you want?** It's built
   and live: a verified contributor's brand-new exercise goes out with **zero review**, to students
   actively studying from it. Worth reconfirming deliberately given how little friction that path has
   — see the business-logic risk in §5 below.
8. **Deployment target** (`CLAUDE.md` §18 item 6) — Postgres vs. staying on SQLite, real hosting,
   TLS — undecided. Blocks a large fraction of `LAUNCHCHECKLIST.md`'s 🔴/🟡 items from even being
   actionable.
9. **Should EdMat's tutoring/donation-link features actually facilitate real money changing hands
   with zero platform involvement?** (See §5, business logic — this is a real product decision, not
   an engineering one: peer-to-peer payment links + zero moderation on Service listings today.)

---

## 2. Fixes

### 2A. Newly found this session — nobody had flagged these

1. ✅ **🔴 A fresh clone following `README.md`'s own documented setup is currently broken — fixed
   (2026-08-07).** The root `.venv` (the one `README.md` step 1 tells you to build, `python3 -m venv
   .venv` + `.venv/bin/pip install -r requirements.txt`) could not boot the backend at all —
   `ModuleNotFoundError: No module named 'postman'`. Root cause: `INSTALLED_APPS`
   (`backend/config/settings.py`) has required `'services'`, `'messaging'`, `'django.contrib.sites'`,
   and `'postman'` since the Section 17P messaging feature landed, but the **root**
   `requirements.txt` was never updated to include `django-postman`, `python-magic`, or `clamd` — it
   only had the original Phase 2 dependency set. `backend/requirements.txt` *did* have all of them
   (and is what the then-existing `backend/.venv` was built from), but nothing in `README.md` told a
   fresh user to use that file instead of the root one.

   **Fixed by making the root file a one-line `-r backend/requirements.txt` include** rather than the
   consolidate-to-one-file this originally proposed — see decision #3 above for why one file cannot
   serve both consumers. `README.md` needed no change: its step 1 command is unchanged and now
   resolves to the complete list. Verified by `pip install --dry-run` against the root file, which
   follows the include and reports all 10 requirements satisfied.

   **Note on the two related symptoms, both since gone:** the missing packages had at some point been
   installed into the root `.venv` by hand, so that venv booted fine even while the file it was
   nominally built from did not describe it — the defect survived only on a *clean* clone. And
   `backend/.venv`, named above as "the actually-working one", was deleted on 2026-08-07 as a
   duplicate; the root `.venv` is now the only one, and the file backing it is finally complete.
2. ✅ **The two requirements files also disagree on pinned versions, not just contents — fixed
   (2026-08-07).** Root pinned exact versions (`Django==5.2.16`, `django-filter==26.1`) while
   `backend/` used ranges (`Django>=5.2,<5.3`, `django-filter>=24.3,<25.0`), and `django-filter==26.1`
   in root actively violated `backend/`'s own `<25.0` ceiling.

   Resolved in the direction the *working* environment pointed, not the file's: three of `backend/`'s
   ceilings were stale rather than deliberate, and the installed, test-passing versions had already
   moved past them — `djangorestframework` 3.17.1 against `<3.17`, `django-filter` 26.1 against
   `<25.0`, `Pillow` 12.3.0 against `<11.0`. Ceilings raised to the next major (`<3.18`, `<27.0`,
   `<13.0`); the other seven pins already admitted their installed versions and were left alone. The
   root file's exact pins disappear with the file's contents, so the two can no longer disagree.
   `asgiref` and `sqlparse` are dropped with them — both are Django's own transitive dependencies and
   were never direct requirements of this project.
3. **Registration's "Preferred interface language" field still has no effect on the interface** —
   `LAUNCHCHECKLIST.md` flagged this during the webek4 deploy session and marked it unconfirmed-fixed.
   Re-checked directly this session: `register/+page.svelte` still never calls `setLocale(...)`
   after a successful register, and neither `LoginView`/`auth.svelte.ts`'s `init()` apply a returning
   user's stored `preferred_locale` on load either. **Confirmed still broken, not fixed since it was
   first reported.**
4. **`credentials: 'omit'` was never added to `lib/api/client.ts`'s `fetch()` call**, the fix
   `LAUNCHCHECKLIST.md` recommended (not confirmed applied) for the admin-session-cookie-breaks-
   registration bug. Grepped `client.ts` directly this session — no `credentials` option is set
   anywhere in the file at all, meaning `fetch()`'s default (`same-origin`) is still active and the
   whole bug class is still live. **Confirmed still open.**
5. **`notifications/tests.py` is a 3-line empty stub.** `CLAUDE.md` §17L's own "Left open" note says
   this plainly, but it's easy to miss buried in a huge document: the SSE stream (§17H) and all ten
   notification-trigger event types (§17B) have **zero automated test coverage**, despite being one
   of the more architecturally delicate features in the app (polling loop, token-in-query-param auth,
   a custom renderer just to satisfy content negotiation). Real risk for silent regression.
6. **The live database still has the exact scratch/test-data pile `LAUNCHCHECKLIST.md` already asks
   you to clean up, unchanged**: `admin`/`admin12345` superuser present; all 5 demo accounts present;
   plus `student1`, `realuser-abc123`, and three `verify-<timestamp>-*@example.com` accounts — clearly
   Playwright-verification leftovers, not real users. 12 total `User` rows, only ~6 of which are
   "real" in any sense.

### 2B. Confirmed still-open (already documented, re-verified true today — not stale)

Everything in `LAUNCHCHECKLIST.md`'s 🔴 (Blockers) section is still true as written: hardcoded
`SECRET_KEY`, `DEBUG = True`, `ALLOWED_HOSTS = []`, SQLite, no HTTPS enforcement settings,
`CORS_ALLOWED_ORIGINS` still localhost-only, `PUBLIC_API_BASE_URL` still `localhost:8000`, the
`admin`/`admin12345` superuser still live (see 2A #6 above), all 5 demo accounts still live with a
publicly-documented shared password. Also re-confirmed directly this session:

- `CSRF_TRUSTED_ORIGINS` is genuinely absent from `backend/config/settings.py` — the webek4-deploy
  fix was applied to that deployment, never backported into this repo's own settings file (it can't
  be, generically — it needs a real domain — but there's no placeholder/comment marking it as an
  item to fill in before the next deploy either).
- 🟠 items all still true: password reset is still a stub with no email backend configured anywhere
  (confirmed: no `EMAIL_HOST`/SMTP config in `settings.py`, only the `django-postman`-motivated
  console `EMAIL_BACKEND`), no email verification on registration, no rate limiting
  (`DEFAULT_THROTTLE_*` unset), no CAPTCHA/bot protection, tokens never expire.
- `npm audit`: still exactly the 3 low-severity `cookie`/`@sveltejs/kit` transitive vulnerabilities
  `LAUNCHCHECKLIST.md` names, same advisory, same "needs a deliberate look, not `--force`" situation.
- The Python side has still never been run through `pip-audit` or equivalent — genuinely unknown
  whether the pinned versions carry known CVEs.
- No CI pipeline exists — `manage.py test`, `npm run check`/`lint`/`build` all still only run
  manually, confirmed by the absence of any `.github/workflows/` or equivalent.

---

## 3. New functionality worth considering

Not gaps that block anything — genuine feature ideas, some adjacent to what `CLAUDE.md`'s own
"Left open" notes already gesture at, some new:

- **Real user search** (`/api/accounts/search/?q=`). Three separate features already hit this exact
  missing piece independently — granting a node governor, starting a new message, and (implicitly)
  moderator user-management — each currently requires already knowing a numeric User ID. One real
  endpoint would unblock all three at once, the same "shared fix, three beneficiaries" pattern
  `getExercisesByIds`'s bulk-endpoint fix (§17F) already demonstrated for a different problem.
- **A personal practice/progress history**, distinct from the existing anonymous `browsingHistory`
  store — "exercises I've actually attempted/solved," self-reported or lightly tracked, feeding into
  something more useful than the current Random Exercise picker's topic-affinity weighting (e.g., a
  "review what you got wrong" queue before an exam).
- **Exercise-level diagrams/images.** The content pipeline (§11) is Markdown+LaTeX with raw-HTML
  passthrough, sanitized — geometry/graph-heavy exercises presumably need real images, and nothing in
  the submission form or moderation queue currently handles an image upload the way material
  submissions now do (§17N's real content-sniffing/validation work could largely be reused here).
- **Machine-translation-assisted drafts** — already explicitly flagged as a clean extension point in
  the data model (§10's own "Left open," a `pending` row with `translated_by = null`) but never
  built. Would meaningfully reduce the translation backlog without redesigning anything.
- **Digest/email notifications**, not just the real-time SSE stream — a weekly "3 of your submissions
  were reviewed" email is a different, complementary need from in-tab real-time delivery, and shares
  the exact missing infrastructure (`EMAIL_BACKEND`) the password-reset stub already needs — one
  piece of infra, two features unblocked (§18 item 9 already names this synergy).
- **A public, documented read API** (e.g. `drf-spectacular` + a schema page) — the API is already
  clean/RESTful; making it a real, documented public surface could turn this into a citable dataset
  for other students'/researchers' tools, not just this one frontend's private backend.
- **Course-level contributor recognition** (a leaderboard, or just a "top contributors this course"
  list) — the data (`submitted_by`, `translated_by`, verified-contributor flag) all already exists;
  nothing currently surfaces it as a incentive/recognition mechanism.
- **A "solved it differently" alternate-solution mechanism**, distinct from an edit suggestion — right
  now the only way to propose a second valid approach to a problem is either a discussion comment
  (ephemeral, not structured) or an edit suggestion (implies the original is wrong). A real "alternate
  solution" object, reviewable like a translation, would fit this app's existing moderation shape well.
- **Multi-institution support.** Everything today is implicitly University of Warsaw-scoped
  (`Course.university` is a free-text field, but nothing in the UI filters/groups by it). If growth
  beyond UW is a real goal, that's worth designing for before the corpus grows large enough that
  retrofitting it is painful.

---

## 4. Improvements to what already exists

- **Reintroduce pagination before it becomes a real problem, not after.** `DEFAULT_PAGINATION_CLASS`
  is deliberately `None` (§16 Phase 3, reasoned as correct because every current list is "bounded by
  construction" — course-scoped, `limit=`-capped, etc.). That reasoning holds today at 742 exercises;
  it stops holding the moment a popular course organically grows past what one unpaginated response
  should carry, or once community submissions meaningfully grow any single course's list. Worth a
  real threshold/plan now, not a retrofit under pressure later.
- **A committed frontend test suite.** Every one of the (extensive, genuinely rigorous) verification
  passes documented throughout `CLAUDE.md` was a one-off manual headless-Chromium session — there is
  no committed Vitest/Playwright suite that runs on every future change. Given how many real,
  subtle bugs those manual passes *did* catch (the `composedPath()` fix, the SSR-crash-the-whole-dev-
  server bug, the `bind:value` type mismatches — three separate times, same bug class, never
  caught by `svelte-check`), this is the single highest-leverage quality investment available: it
  would have caught at least 3 of those bugs automatically instead of requiring a dedicated live
  session each time.
- **A CI pipeline** running `manage.py test`, `npm run check`/`lint`/`build`, and (once it exists) the
  frontend suite above, on every push — closing the exact gap `CLAUDE.md`'s own "Left open" notes
  flag repeatedly (§17L, §17F) as never done.
- ✅ **Consolidate the two venvs into one, and document which is canonical — done (2026-08-07),
  except for the CI half.** This had already caused real confusion twice (§18 item 5's own "recurred"
  note, and this session's own Fix 2A #1 finding a *third* occurrence of essentially the same class
  of problem). There are now three fewer moving parts: `venv/` (Python 3.14, a dangling `bin/python`
  symlink to an interpreter not on this machine — a copy from another user's machine, the same
  recurrence §18 item 5 describes) and `backend/.venv` (a duplicate whose only unique packages were
  *older* versions of ones the root venv already had newer) were both deleted, leaving the single
  root-level, README-matching `.venv`; and the requirements file behind it is now complete and
  single-sourced (Fix 2A #1/#2 above). Verified before deleting: the root venv passes `manage.py
  check` and `manage.py test taxonomy accounts`, `run.sh` already pointed at it, and both deleted
  directories were gitignored.

  **The CI half is the part that remains, and it is what would make this stick** — nothing yet
  *exercises* the requirements file on a clean machine, so the same drift can recur silently. Note
  this was never purely hypothetical: the reason Fix 2A #1's defect survived unnoticed is that the
  packages had been hand-installed into the root venv, so the environment worked while the file
  describing it did not. Only a clean-clone install catches that, and nothing runs one.
- **A manual keyboard-only and screen-reader pass.** `axe-core` (§17E) is real and already found four
  genuine bugs, but its own documented ~30% real-world coverage means a real accessibility audit is
  still only partially done — the remaining ~70% needs a human pass, not more automated tooling.
- **Widen the material-price currency list, or add a real escape hatch**, per §17O's own honestly-
  flagged tradeoff (4 curated currencies, no way to express a 5th without a backend change).
- **Close the small structural gaps `CLAUDE.md` itself already named and left open**: no avatar
  upload UI, no "delete my account" flow (ties to the GDPR decision above), no donation-link
  reordering UI, no archive/trash UI for messages despite the backend already supporting both
  folders, `MaterialSubmission.type` not validated against `choices=` (a malformed value 500s at
  approval time instead of 400ing at submission time).

---

## 5. Business-logic risk review

These are places where the *mechanism* works exactly as designed and tested, but the design itself
carries a real trust/abuse/liability question worth thinking through, not a bug to fix in code:

- **Verified-contributor auto-publish has no stated criteria for who becomes "verified."** The flag
  is grantable only via Django admin, with no documented policy for what earns it. Once granted, that
  person's brand-new exercises go live to students **with zero review**, immediately. The tier name
  itself ("verified contributor") plausibly reads to an ordinary user as "this person's identity/
  credentials were checked," when what it actually means is "a moderator trusted them once." Worth a
  real, written bar for granting it before this is a public feature, not just an engineering
  mechanism that happens to work correctly.
- **Tags are entirely ungated — any authenticated user can apply any free-form tag to any exercise or
  material, live, with zero moderation.** Deliberately designed this way, reasoned as "additive,
  reversible, low-stakes" (§17C) by analogy to `MaterialCoverage`'s own community-vote model — but a
  tag is *visible, published text*, unlike a coverage claim that's gated behind its own vote-
  aggregation display. A malicious or simply wrong tag (a slur, a defamatory label, an off-topic joke)
  is live the instant it's applied, discoverable by anyone browsing by that tag, with removal
  requiring either the applier or a governor/staff member to notice and act. Worth reconsidering
  whether *some* tags (or a report/flag path on tags specifically, which doesn't currently exist —
  see below) need a lighter gate than "fully open."
- **Auto-hide (3 reports + 20% of viewers) has no reporter-reputation weighting at all.** Three
  coordinated bad-faith reports against a correct, well-liked exercise/comment/review can hide it
  just as easily as three genuine ones — the mechanism can't currently distinguish brigading from
  real community signal. Worth deciding whether this is an acceptable risk at current scale or needs
  hardening before the platform is public enough to attract that kind of behavior.
- **Neither Service listings nor Messages are wired into the Report/auto-hide system at all**
  (explicitly flagged as a real, if narrow, gap in §17P's own "Left open" list) — these are the two
  newest, most directly person-to-person-facing content types in the app (a public tutoring ad, a
  private conversation), and neither has any abuse-reporting path. If tutoring listings go live
  publicly, this is a real, immediate gap: nothing stops a fraudulent listing from sitting up
  indefinitely with no way for a visitor to flag it.
- **Donation links + tutoring listings mean EdMat is facilitating real peer-to-peer payment
  arrangements (PayPal/BLIK/bank transfer/etc.) with zero platform involvement, moderation, escrow,
  or stated liability.** This is a genuine product/legal question, not an engineering one: is EdMat
  comfortable being the discovery layer for real money changing hands between a "tutor" (self-
  declared, unverified beyond the same `is_verified_contributor` flag discussed above) and a student,
  with no dispute-resolution mechanism, no fee, and — per the point above — no report path if a
  listing turns out to be a scam?
- **A shared "My Set" link is unconditionally, permanently public the instant it's created, with no
  unshare mechanism** (§17J's own "Left open" note) — a user who shares a study-sheet link, then
  later wants it private again, has no way to do that short of deleting the set outright (losing their
  own copy too). A reasonable UX expectation mismatch worth naming, even if low-stakes content-wise.
- **The corpus copyright question (decision #5 above) is the one item that, left unresolved, makes
  every other business-logic question here somewhat moot** — if the underlying content can't be
  legally redistributed publicly, none of the trust/moderation/monetization questions above matter
  until that's settled first.

---

## 6. Second sweep — module by module, same three lenses

A systematic pass across every backend app + the frontend, specifically looking for what each one is
still missing on the functionality/improvement/business-logic axes, rather than re-deriving what's
already covered above.

| Module | Functionality gap | Improvement | Business-logic note |
|---|---|---|---|
| **taxonomy** (Field/Course/Topic/Chapter) | Chapter/textbook page-map exists in the schema but was never surfaced as a browsable UI (§16's own still-deferred item, never picked back up) | `Course.university` is free text, unused for any real filtering — dead weight or an opportunity, not currently either | None beyond the multi-institution question already raised in §3 |
| **exercises** | No "alternate solution" object (§3); no per-exercise version history/diff view for edits over time | Bulk endpoint (§17F) fixed the moderation-page N+1, but a similarly-shaped fan-out risk exists anywhere else `getExercisesByIds`-style per-id fetching might still be hiding, worth a repo-wide grep before it recurs a third time | `verified` flag semantics are sound but entirely moderator-attested — no visible "N students found this correct/helpful" community signal distinct from the star rating |
| **materials** | No star-rating/review system for materials at all (only Exercises get `Review`, confirmed in §17G's own "Left open") — a material can accumulate coverage-claim discussion but never an overall quality signal | No material-level top-level discussion, only per-coverage-claim (§17G) — a "general question about this whole document" has nowhere to go | Requirements/price/time-estimate fields are self-declared by the uploader with no verification step — a materially wrong "prerequisite" or price is only caught if a governor happens to check |
| **community** (Review/Comment) | No comment-editing (only removal/tombstone) — a typo in a posted comment can't be fixed, only deleted and reposted | — | Tombstone-not-delete is a good, deliberate choice for thread integrity, but combine with the tag/report gaps above — a removed comment's *reports* presumably still count toward that user's history somewhere, worth confirming there's no way this becomes a silent reputation system with no visibility to the user themselves |
| **moderation** | No moderator-facing UI to grant/revoke `is_verified_contributor` (§18 item 4's own "Left open") — Django admin only | No audit trail for node-governor revokes (§17M's own "Left open") | The entire trust hierarchy (staff → node governor → verified contributor) is granted by humans with no documented criteria at any level — see §5 |
| **study** (My Set) | No "sets shared with me" list, no view/copy count for a shared set's original owner (§17J's own "Left open") | — | Public-by-default sharing model, see §5 |
| **accounts** | No "delete my account" flow, no avatar upload UI (both already named in `LAUNCHCHECKLIST.md`/`CLAUDE.md`) | `ProfileSerializer`/registration flow are solid, but the interface-locale-on-register bug (Fix 2A #3) sits exactly here | — |
| **notifications** | Browser/OS push (Web Push API) not built, explicitly deferred (§17H) | **Zero test coverage** (Fix 2A #5) — the highest-value single test-writing target in the whole backend given the feature's real architectural complexity | — |
| **services** (tutoring) | No listing reordering, no search/filter beyond course | — | No report/abuse path (§5); no verification that a "tutor" has any actual qualification beyond self-declaration |
| **messaging** | No archive/trash UI despite backend support, no attachments, no message search | — | No abuse/report path (§5); no rate limiting on message-sending specifically (falls under the general rate-limiting gap, but worth naming as the most spam-attractive endpoint in the app) |
| **frontend infra** | No i18n locale beyond en/pl (structurally fine per §18 item 7, just unbuilt) | No committed test suite (§4); the `.env`-baked `PUBLIC_API_BASE_URL` means every deploy target needs its own build, worth confirming the deploy process actually accounts for this | — |

---

## Suggested reading order

1. **§1 (decisions)** first — several fixes below are meaningless until these are answered (e.g., no
   point auditing SQLite→Postgres migration effort before deciding whether this launches publicly at
   all).
2. **§2A** — these are new, concrete, and the venv/requirements one actively blocks anyone else from
   even running the project from a clean clone today.
3. **§2B** — already well-tracked in `LAUNCHCHECKLIST.md`; this document doesn't repeat the reasoning
   there, just confirms it's all still accurate.
4. **§5 (business logic)** — read this before §3/§4 if a public launch is actually the goal; several
   of the "new functionality" ideas in §3 (real user search, digest email) are lower priority than
   closing the trust/abuse gaps §5 identifies.
