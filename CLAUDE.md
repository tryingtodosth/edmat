# EdMat — engineering contract

A community database of exercises and teaching materials with a whole platform grown around it:
LaTeX-rendered statement / hint / solutions browsable **discipline → branch → topic → exercise**,
plus moderated submissions, per-exercise translation, coverage claims, user-run courses, tutoring
listings with real booking, one-off events with programmes and registration, messaging, an activity
feed, and a scoped moderation system. Django REST Framework API + SvelteKit SPA, seeded from a real
~740-exercise corpus.

**This file is what you need to write code here.** It is deliberately short. Everything else moved
out on 2026-09-19:

| File | Holds | Read it when |
|---|---|---|
| `CLAUDE_MAP.md` | Orientation map — repo layout, every app and frontend layer summarised | You are new, or looking for where something lives |
| `HISTORY.md` | The full chronological build log: every feature, its reasoning, every bug and how it was found | You need to know **why** something is the way it is |
| `PRODUCT.md` | Vision, scope, roles, user stories, functional requirements | You are deciding what a feature should do |
| `LEGAL.md` | Operator identity, licences, the corpus copyright question, DSA, GDPR, minors | You touch content licensing, reporting, moderation copy or personal data |
| `FINANCES.md` | Why nothing takes money, and how the project is funded | Somebody asks for payments, or you touch `grant/` |
| `test.md` | Every test suite and browser script: what it covers and how to run it | Before writing or running a test |
| `QA.md` | A standing quality assessment of the codebase | You want the honest state of things |
| `AUDIENCE-BRIEF.md` | The lifelong-learning widening (steps 1–10) | You pick up one of its remaining steps |
| `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `backend/<app>/CLAUDE.md`, `frontend/e2e/CLAUDE.md` | Scoped rules and traps for the half or app you are in | Always, for the part you are editing |

When a scoped file and this one disagree, **the scoped file wins** — it is closer to the code.
When `HISTORY.md` and anything else disagree about the present, the present wins; history records
what was true when it was written.

---

## The shared task boards — read these first, every session

This project is worked on by many agents at once (31 git worktrees at the time of writing). Three
files are how they see each other:

| File | Holds |
|---|---|
| `edmat-boards/todo.md` | work that is waiting, for anyone |
| `edmat-boards/doing.md` | what is in flight right now, one entry per agent |
| `edmat-boards/done.md` | what landed, newest first |

**Where they actually are** depends on the machine: `/home/alojzy/Wymiana_VM/edmat-boards/` is the
canonical path the boards' own text names, but a checkout may have them beside the repo (e.g.
`/Projects/edmat-boards/`). Look next to the repo before concluding they are missing.

**The rule.** At the start of a session, read all three. When you start a task, move it from
`todo.md` into `doing.md` **in the same edit**, stamped with your branch and worktree — a task in
both places is the one state that makes the boards lie. When you finish, move it to `done.md` with
the commit and what you actually verified, and put anything you deliberately left open into
`todo.md`. If you abandon it, move it back to `todo.md` and say what you learned.

**Keep `doing.md` to one task per agent.** If you are doing two things, the second is not started;
leave it in `todo.md` where somebody else can take it.

**Do not take anything already in `doing.md` under another branch** without checking whether that
branch has moved recently — sessions end without cleaning up, so stale entries are normal. Say so
in the file rather than silently taking the work.

**They live outside the repo on purpose**, and are not tracked by git: a tracked board forks the
instant two agents branch, so each would read a snapshot of whenever their branch started — exactly
the question the boards exist to answer, answered wrongly — and 31 branches editing one file means a
conflict on every merge. `edmat-boards/README.md` records that reasoning and its cost. Each board
also restates its own rules at the top, so an agent that opens one needs nothing else.

---

## Vocabulary — the rename that trips everybody

`HISTORY.md` and anything written before mid-2026 use the old names. These are the current ones:

| Concept (Polish) | Current model | Old name in the history |
|---|---|---|
| Field of study (*kierunek*) | `taxonomy.Discipline` | `taxonomy.Field` |
| University subject (*przedmiot*) | `taxonomy.Branch` | `taxonomy.Course` |
| A course a user runs (*kurs*) | `courses.Course` | the `classroom` app |

`/api/courses/` is the **user-run** course API; `/api/disciplines/` and `/api/branches/` are the
taxonomy. An untracked `backend/classroom/` directory may still exist on disk — the live app is
`courses/`; never resurrect `classroom`.

---

## The shape of the thing

```
frontend/  SvelteKit 2 + Svelte 5 runes + TS, adapter-static (SPA fallback), Paraglide i18n
             routes/ + components  →  lib/services/*.ts  →  lib/api/client.ts  →  HTTP
                   (never fetch)         (the only seam)      (the only fetch())
backend/   Django 5.2 + DRF, SQLite, 27 local apps + config/ + testing/ + imaging.py
             views  →  <app>/services.py or a rule module  →  models
deploy/    Apache vhosts + the webek4 / edmat.net runbooks
Database-of-Student-Exercise/   the retired static site, kept only as corpus provenance
```

The 27 apps: `taxonomy` `exercises` `materials` `community` `moderation` `study` `accounts`
`notifications` `services` `messaging` `issues` `legal` `chem` `galleries` `telemetry` `identity`
`courses` `booking` `activity` `events` `coauthoring` `concepts` `sketches` `venues` `documents`
`shifts` `cloakroom`. Each has its own `CLAUDE.md`. The last four are the conference layer
(`CONFERENCE-BRIEF.md`, 2026-09-23), each hung off `events.Event` by a row of its own so that
`events` kept its schema while seven branches were built at once.

**Two boundaries are load-bearing and everything else follows from them:**

1. **No component or route contains fetch logic, ever.** `lib/services/*.ts` is the only seam;
   `lib/api/client.ts` is the only `fetch()`. This is what let the entire mocked Phase-1 frontend be
   pointed at a real backend without touching a single route file, and it still pays off.
2. **A rule that more than one endpoint needs lives in one module, and the endpoints ask it.**
   `accounts/minors.py`, `exercises/entries.py`, `config/audience.py`, `galleries/visibility.py`,
   `moderation/services.py`, `booking/availability.py` are all this shape. An endpoint that
   re-implements the rule is how two surfaces start disagreeing.

`adapter-static` is a **deliberate non-change**, not an oversight: every request originates
client-side against a separate-origin API, so nothing needs SSR. Thirteen hub and standing pages are
prerendered for first paint, and `deploy/fuw/pack.sh` refuses a build that is missing one.

---

## Shapes that repeat across the data model

Learn these five and most of the schema reads itself.

- **Text lives in a translation table, including the original.** `ExerciseTranslation` is one row
  per (exercise, locale) with a `status`, and a partial unique constraint allows exactly one
  `published` row per locale — not `unique_together` across all statuses, which once blocked a
  legitimate second pending or rejected row and produced 500s. Resolve for the requested locale,
  fall back to `original_locale`.
- **A polymorphic target is a `GenericForeignKey` plus a registry.** `community.Comment`,
  `moderation.Report`, `moderation.NodeGovernor`, `galleries.Gallery` all work this way, each with
  its own allowlist of legal targets (`community/targets.py`, `REPORT_KIND_MODELS`,
  `GOVERNABLE_NODE_MODELS`, `galleries/visibility.py`). **The registries are deliberately
  different lengths** — a thread makes sense on a coverage claim; a photo album does not.
- **A claim is a `ClaimBase` subclass** (`materials.ClaimBase` → material / course / exercise
  claims), with shared vote, importance and thread handling in `materials/claims.py`.
- **A lifecycle is one `status` field, never two booleans.** Two booleans make an illegal state
  representable — finished but never published — that every read site then has to defend against.
- **A feature surface gets a `FeatureFlag` kill switch**, checked through `feature_gate('<key>')`
  with an `is_staff` bypass. Twenty exist today — `exercise_submissions` `material_submissions`
  `tutoring` `messaging` `courses` `events` `posts` `issues` `galleries` `chemistry`
  `age_verification` `coauthoring` `concepts` `sketches` and the six conference switches
  `venues` `event_documents` `tickets` `shifts` `cloakroom` `role_preview` (seeded together by
  moderation migration 0043, so that seven parallel branches never each added one) — and the
  `legal` notice channel is the one deliberate exception
  (`LEGAL.md` §4). House rule 3 is what "kill switch" has to mean. A key is a **three-file**
  change — backend choices + migration, `types/featureFlag.ts`, `utils/labels.ts` — and the third
  has been forgotten twice, each time taking the whole Flags tab down. `age_verification` is also
  the one flag read with a plain `is_feature_enabled()` rather than `feature_gate`, because it
  removes a *rule* from an anonymous endpoint everybody must still reach, not a whole surface.

---

## House rules

Each of these was learned by something breaking. The half-specific ones (SQLite concurrency, Svelte
5 `bind:value`, `$effect` re-firing) are in `backend/CLAUDE.md` and `frontend/CLAUDE.md` — read
those too.

**1. Never English-only.** A new or changed user-facing string is a key added to *both*
`messages/en.json` and `messages/pl.json` in the same change. A key with no Polish counterpart is an
incomplete change, not a follow-up. Verify the two key sets are identical before calling a pass
done. Every `m.*()` call site carries a trailing `// "Original text"` comment.

**2. Verify by running it, not by reading it.** `svelte-check`, `eslint`, `manage.py test` and a
production build have all passed cleanly on bugs that a real browser found in one click — a
`bind:value` type mismatch, a 401 during SSR that killed the dev server, a blank canvas, an invite
link pointing at a route renamed months earlier. Drive the actual form with the real servers up, and
**look at the screenshot**: several real bugs were found by looking rather than by any assertion.
`frontend/e2e/CLAUDE.md` catalogues the traps that make a browser script lie to you.

**3. A kill switch removes the links, not just the pages.** Turning a feature off has to take away
its nav entry, its homepage tab, its menu item and its filter option — and the "Add…" menu itself
disappears when every item under it is gone. A killed feature that still shows its buttons has not
been hidden, only made to fail somewhere less useful. Neighbouring endpoints must keep working while
returning nothing for it.

**4. Visibility is a queryset filter; authority is an object-level check. You need both.** A
stranger poking at a draft gets **404**, because for them it does not exist — that is the honest
answer as well as the safe one. But a filter never runs for an action that arrives with an id in the
URL, so single-object actions must ask the rule module explicitly, before any mutation. A real scope
leak once shipped because an action returned the *unscoped* queue in its own response body.

**5. Recount, never increment.** Two `COUNT`s over an indexed FK are cheap, and a recount cannot
drift; an increment that misses one code path is wrong forever. State the honest limit where it
exists (a `QuerySet.update()` fires no signal, so it is corrected by the next save rather than never).

**6. A refusal carries its reason.** `enrollment_block_reason`, `response_block_reason`,
`can_respond` return *why*, not a boolean — "this is full" and "the organiser removed you" are the
same refusal to a boolean and completely different to a person. The frontend has a line for each.

**7. Never store the bytes that were uploaded.** Images are decoded and **re-encoded** through
`imaging.py` (byte cap → sniffed type → a decoded-pixel budget checked against the *header* before
any pixel is read → re-encode). Re-encoding is strictly stronger than sniffing, because sniffing
answers "does this look like a real image?" — which a polyglot (a valid image whose trailing bytes
are also a valid archive or script) answers "yes" to as honestly as a photograph does. Re-encoding
does not ask the question; it discards every byte that is not pixel data. EXIF goes with it, which
is a privacy fix as much as a security one. What cannot be re-encoded (a PDF) gets the sniff, the
size cap and a ClamAV scan when a daemon exists. Stored filenames are random; the uploader's own
filename is untrusted input.

**8. Sanitize on write *and* on read.** `bleach` server-side (`config/sanitize.py`), DOMPurify
client-side. The API is a second, independent entry point, and a moderator reviewing a pending
submission is already rendering untrusted HTML. Widening the allowlist means adding the refusal test
that goes with it in the same change.

**9. Public by construction, not filtered from private.** The activity log only ever gets a row for
something that was public at that instant, and has a forgetting half wired into auto-hide, removal
and tombstoning. "The audit log, filtered" makes every private thing one missing `WHERE` clause away
from public.

**10. Flag it, don't fake it.** An unreachable virus scanner returns `scanned=False`, never "clean". The
password-reset endpoint is an honest always-200 stub because there is no email backend. A setting
(`MATERIAL_SCAN_REQUIRED`) is what a real deployment flips to make the honest skip a hard refusal.

**11. Lazy-load anything heavy.** KaTeX, Leaflet, pdf.js, Ketcher/React and Tiptap are all imported
dynamically at the point of use, and their absence from the entry bundle is asserted. A reader who
never opens a map should never download one.

**12. Tombstone, don't hard-delete**, wherever a thread or a link would break — and keep the record
of a decision (a rejected submission, a revoked invite, a resolved report) rather than deleting it.
Who submitted what, when, and whether it was accepted is part of the trust model.

**13. Three strikes before extracting a shared utility**, and when you mirror a small backend enum
into `frontend/src/lib/utils/labels.ts`, say so in *both* files — that is where drift creeps in.

**14. "Left open, not built" is part of the deliverable.** Finish the whole task, then write down
honestly what you did not do and why, on the board and in `HISTORY.md`. A gap that is named gets
closed; a gap that is quietly omitted gets rediscovered by whoever trips over it.

---

## Content pipeline — the order is the whole point

Storage format is **Markdown with raw HTML passthrough and literal LaTeX delimiters** (`\( … \)`
inline, `\[ … \]` display). That is what the legacy corpus already was, so migration rewrote no
content.

`frontend/src/lib/utils/renderContent.ts` does **not** run Markdown first and typeset after:

1. Extract every `\( … \)` / `\[ … \]` segment and KaTeX-render it, stashing each result behind an
   inert placeholder.
2. Run the remaining text through `markdown-it`.
3. Splice the real KaTeX HTML back over the placeholders.
4. Sanitize.

Because CommonMark treats `\[` and `\(` as *escaped punctuation* the moment that text is parsed as
an ordinary paragraph, the obvious order silently strips the backslashes off display maths that is
not wrapped in a literal `<p>` — which is a chunk of the real corpus. Extracting first makes the two
cases identical. `npm run check:katex` re-runs the corpus-wide compatibility check (2241 rows, 0
issues); run it after any bulk import or batch edit.

A rich editor (Tiptap) exists as a **second input for the same field** — it emits HTML the sanitizer
already allows. Storage does not change.

---

## i18n — two separate axes, deliberately

- **Interface language**: a small, curated, developer-maintained catalogue. Paraglide/inlang, **`pl`
  base** (since 2026-09-23 — a first visit paints Polish with no flash; `/api/locale-hint/` offers
  English once when the IP resolves outside Poland, and a stored choice always wins) + `en`,
  `messages/{locale}.json`. Not community-editable. House rule 1 governs it.
- **Content language**: unbounded, community-submitted, moderator-reviewed rows
  (`ExerciseTranslation` and friends). A reader's interface language and the content language they
  are reading are genuinely independent — somebody may read the English UI and want the Polish
  original.

Routing these through one mechanism does not work: a message catalogue is bounded and curated;
content translations need their own review workflow.

**The content-language rule for lists:** a list shows only items with a published version in the
reader's languages and says how many it left out (`X-EdMat-Hidden-Languages`, exposed via CORS). A
**detail page never narrows**, so a shared link always resolves. `client.ts` appends
`?content_locales=` and `?audience=` to every list-shaped GET itself, so no service can forget.

---

## API conventions

```
/api/disciplines/ /api/branches/ /api/exercises/ /api/materials/     taxonomy + content
/api/exercises/{id}/{translations,reviews,comments,claims}/          nested community surfaces
/api/exercise-submissions/ /api/edit-suggestions/ /api/moderation/…  the queues
/api/courses/ /api/events/ /api/services/ /api/bookings/             user-run surfaces
/api/material-projects/ /api/material-versions/ /api/project-invites/ co-authoring (COAUTHORING-BRIEF.md)
/api/concepts/ /api/concept-articles/ /api/concept-revisions/ /api/concept-links/  concepts (CONCEPTS-BRIEF.md)
/api/sketches/ /api/chem-drawings/ /api/inline-images/                 pictures embedded in content
/api/locale-hint/                                                     first-visit language (pl unless the IP is abroad)
/api/auth/{register,login,logout,me,password-reset}/                 DRF TokenAuthentication
```

- **Public GET, owner-scoped writes.** Reads are open where the content is public; writes are scoped
  in `get_queryset`, so a non-owner's write attempt is a 404 rather than a 403.
- **No global pagination.** Every list this frontend calls is bounded by construction; the envelope
  would have been inconsistent with the custom `@action`s that bypass it anyway.
- **Ids:** Discipline and Branch are the backend slug; everything else is the numeric pk as a string,
  opaque outside `lib/api/`.
- **409 means the world moved** (already reviewed, already booked, already decided); 400 means the
  request was malformed. Do not conflate them.
- **A status claim is one WHERE-anchored `update()`**, not `select_for_update()` — see
  `backend/CLAUDE.md` for why, and for what SQLite does to the alternative.

---

## Frontend routes

```
/                     home — five content tabs + activity, ?tab= in the URL
/disciplines /disciplines/[discipline] /branches/[branch]     taxonomy browse
/exercises/[id] /materials/[id]                               content detail
/courses … /events … /services … /bookings                    user-run surfaces
/material-projects … /project-invites/[token]                 co-authoring a material
/concepts /concepts/[slug] … /articles/[id]/{edit,history}     concept wiki, articles per audience
/messages … /notifications /activity /posts/[id]              inbox + feed
/my-set /sets/[id] /submit /submit-material /search           study + contribute
/settings /settings/profile /users/[id] /login /register      account
/moderation /legal/queue /issues                              staff + reports
/privacy /legal /levels                                       standing pages
```

URL segments are neutral English (`/branches/`, not `/przedmioty/`) — the app is bilingual from day
one, so its URLs should not encode one language as more native than the other.

---

## Running, testing, environment

```bash
./setup.sh          # Ubuntu, from nothing: Python, Node 24, deps, corpus, database
./run.sh            # starts both halves, keeps CORS origin + frontend/.env in step with the ports
```

- **One shared venv at the repo root**, `.venv/` (Python 3.12). From `backend/`:
  `../.venv/bin/python3 manage.py test`, `manage.py check`,
  `manage.py makemigrations --check --dry-run`.
- **`backend/requirements.txt` is canonical**; the root one is a one-line include. They drifted once
  and a clean clone could not boot (`No module named 'postman'`). Do not let them drift again.
- **Node 24+** — `ketcher-react` refuses older under this project's `engine-strict` npm setting.
- Frontend: `npm run check` (0 errors, 0 warnings is the bar), `npm run lint`, `npm run build`,
  `npm run check:a11y`, `npm run check:katex`.
- **Redis is optional.** `EDMAT_REDIS_URL` unset is a supported configuration: file cache, SSE by
  polling. Set, it gives shared throttle counters, the anonymous-read response cache and pub/sub
  push. A bare clone must never require a daemon.
- **No CI runs any of this.** Run it yourself, and say in the board entry what you actually ran.
- Changing a port by hand (rather than through `run.sh`) silently breaks CORS.
- `db.sqlite3.bak-*` snapshots beside the database are deliberate; do not clean them up.
- **`grant/` is a separate repository and is gitignored here.** The ING kit carries budget and
  salary figures; it is its own repo at `grant/.git`, pushing to the private
  `tryingtodosth/prezentacje` (`FINANCES.md` §2), and this repository cannot see it. Do not
  `git add -f` it back, and run its git commands as `git -C grant …`.
- **`main` still diverges from `origin/main` permanently, and must never be force-pushed.** Even
  though the tip no longer tracks `grant/`, the nine ING commits remain in local `main`'s *history*,
  so pushing the branch as-is would publish the kit anyway. `deploy/` changes are also held back by
  choice. **Publishing is a replay, not a push**: branch a scratch worktree from `origin/main`,
  cherry-pick the commits you mean to publish minus the `grant/` and `deploy/` paths, and push that
  — as on 2026-09-19. Ask before any push.

---

## Known engineering gaps

Long-standing, still true. Feature-level gaps live in each `HISTORY.md` section's own "Left open".

- **No email backend.** This blocks password reset (an honest stub), any notify-by-email preference,
  an anonymous DSA filer's follow-up, and a guardian resetting a child's password. One
  `EMAIL_BACKEND` unblocks all of them.
- **No CI**, and nothing exercises a clean-clone install — which is exactly how the requirements
  files drifted unnoticed.
- **No frontend unit test suite.** Verification is `npm run check` plus the browser scripts in
  `frontend/e2e/`; there is no Vitest layer and no test gate on push.
- **SQLite, single-writer.** Fine for this deployment, and the reason for several concurrency
  workarounds that PostgreSQL would not need. See `backend/CLAUDE.md`.
- **No people search**, so granting a role or messaging someone new needs their numeric account id.
- **No per-account timezone.** Availability is interpreted in `settings.TIME_ZONE`; the display
  preferences (24h/12h, week start) say how a time is *drawn*, not which clock it is drawn from.
- **Accessibility is axe-only** (about a third of WCAG by axe's own account) — no screen-reader or
  keyboard-only walkthrough has been done.
- **Locales beyond en/pl** are not a structural blocker: `locale` is a free string, not an enum tied
  to Paraglide's list. Adding a third interface language needs a Paraglide config change and a
  catalogue, nothing schema-level.
- **Hosting/deployment beyond webek4** is undecided.

---

## Glossary (Polish domain terms ↔ EdMat's model)

| Polish | EdMat |
|---|---|
| kierunek | discipline (`taxonomy.Discipline`) |
| przedmiot | branch (`taxonomy.Branch`) — a university subject |
| kurs (prowadzony przez użytkownika) | course (`courses.Course`) — something a person runs and others join |
| wydarzenie | event (`events.Event`) — a one-off happening, neither a course nor a booking |
| aktualność | update (`events.EventPost`) — a dated note a host appends after announcing |
| dział / temat | topic |
| zadanie | exercise |
| materiał (dydaktyczny) | material |
| zestaw | set (as in "my set" / study sheet) |
| treść | statement |
| wskazówka | hint |
| odpowiedź | answer |
| rozwiązanie | solution |
| trudność: łatwe / średnie / trudne | difficulty: easy / medium / hard |
| źródło: Ćwiczenia / Kolokwium / Egzamin | source type: exercises / midterm / exam |
| zweryfikowane | verified — a reviewed solution exists (derived, not hand-toggled) |
