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
| `.claude/skills/import-exercises/SKILL.md` | How to import a batch of exercises (*zadania*): the file format, `manage.py import_exercises`, what it refuses; `reference/concepts.md` there for concept pages (`manage.py import_concepts`) | You are adding exercises in bulk rather than through `/submit` |
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

| Concept (Polish, as the UI says it) | Current model | Old name in the history |
|---|---|---|
| Discipline (*dziedzina*) | `taxonomy.Discipline` | `taxonomy.Field` (*kierunek*) |
| Branch (*dział*) | `taxonomy.Branch` | `taxonomy.Course` (*przedmiot*) |
| Topic (*temat*), subtopic (*podtemat*) | `taxonomy.Topic`, `taxonomy.Subtopic` | — |
| A course a user runs (*kurs*) | `courses.Course` | the `classroom` app |

**One glossary for every audience** (owner, 2026-11-02, `HISTORY.md` §17DE): *dziedzina / dział /
temat / podtemat* ↔ discipline / branch / topic / subtopic, in every message and every manual page.
*Kierunek* now means only a degree programme (USOS), *przedmiot* only a taught offering (a
`courses.Course`, a subject on a transcript). Before that day the UI used three vocabularies at once
and *dział* meant both a branch and a topic in the same form.

**Browse is audience-first** (same day, §17DE): the band chips lead `/disciplines`,
`/disciplines/<d>` and `/branches/<b>` (`BrowseLens.svelte`); every discipline and branch carries
`counts` per kind and band, DERIVED by `taxonomy/counts.py` and never stored; a node with nothing
for the reader's band folds under "For other groups". Audience stays one value per content row and
never goes on a taxonomy node — a branch is not "for" anybody, the exercises under it are.

`/api/courses/` is the **user-run** course API; `/api/disciplines/` and `/api/branches/` are the
taxonomy. An untracked `backend/classroom/` directory may still exist on disk — the live app is
`courses/`; never resurrect `classroom`.

---

## The shape of the thing

```
frontend/  SvelteKit 2 + Svelte 5 runes + TS, adapter-static (SPA fallback), Paraglide i18n
             routes/ + components  →  lib/services/*.ts  →  lib/api/client.ts  →  HTTP
                   (never fetch)         (the only seam)      (the only fetch())
backend/   Django 5.2 + DRF, SQLite, 44 local apps + config/ + testing/ + imaging.py
             views  →  <app>/services.py or a rule module  →  models
deploy/    Apache vhosts + the webek4 / edmat.net runbooks
Database-of-Student-Exercise/   the retired static site, kept only as corpus provenance
```

The 44 apps: `taxonomy` `exercises` `materials` `community` `moderation` `study` `accounts`
`notifications` `services` `messaging` `issues` `legal` `chem` `galleries` `telemetry` `identity`
`courses` `booking` `activity` `events` `coauthoring` `materials_coop` `concepts` `sketches` `venues` `documents`
`shifts` `cloakroom` `organizations` `tasks` `needs` `plans` `decisions` `work` `goals` `flashcards`
`provenance` `translations` `attachments` `contests` `mail` `analytics` `sso` `licensing`. Each has its own `CLAUDE.md`. `venues` `documents` `shifts` `cloakroom` are the conference layer
(`CONFERENCE-BRIEF.md`, 2026-09-23), each hung off `events.Event` by a row of its own so that
`events` kept its schema while seven branches were built at once. The last six — `organizations` `tasks` `needs` `plans` `decisions` `work` — are the
management layer (`MANAGEMENT-BRIEF.md`, 2026-09-24), each hanging its rows off a course, an event, a
material or an organisation through `config/nodes.py` rather than adding a field to any of them.
`flashcards` is the learning cycle's one new app (`prompts/00-DESIGN.md`, 2026-10-05): decks, cards,
a per-person SM-2 schedule, and placements on a course or an event through the same `config/nodes.py`.
The rest of that cycle lives inside existing apps — the learning record in `identity/record.py`, school
mode and completion certificates in `courses`, prerequisite paths in `concepts/paths.py`, take-home decks
in `events/takehome.py`, and the creation gate in `config/creation.py` — all briefed in `prompts/`.
**`goals`** (2026-10-08, the same afternoon) is a goal hung off a node and the ordered criteria that
say when it has been reached: the criteria ARE the definition of done, `status='met'` is DERIVED
from them and nothing else writes it, and a task or a plan points at the goal it serves. It replaces
a *convention* — `/about` has always called the twelve module plans the project's goals — and by the
owner's own call those plans did not move: goals sit above them.

The other two are the owner's list of 2026-10-08: **`provenance`** is the "AI-assisted" mark (the
author's own disclosure, one confidence vote per reader per piece of content, a moderator's lock)
and **`translations`** is the management layer's text in every language somebody has written it in —
one table behind `tasks`, `plans`, `needs`, `decisions` and an organisation's description, and
deliberately NOT `ExerciseTranslation`'s shape, which carries a review workflow this does not need.

**`contests`** (2026-10-09, `CONTESTS-BRIEF.md`, `CONTESTS-LAW.md`) is a *konkurs*: stages with
problems drawn from the corpus, registrations with a guardian's consent, a jury's scores, published
results with a complaints window, a versioned regulamin, and ten presets derived from Polish law
(the prize-free `challenge` is the default; a prize unlocks KC art. 919–921, the gambling act and PIT;
no draw is representable anywhere). A contest is a **node**, so tasks, plans, goals, needs, polls,
attachments, decks and a discussion hang off it; `contests/personalize.py` turns a preset into those
rows through the other apps' own paths. Founding one is the fifth `config/creation.py` kind.

**`mail`** (2026-10-14) is `no-reply@edmat.net` on OVH's MX Plan: every outgoing message is a row
(`OutboundEmail` — the queue AND the log, sent after the commit in a thread, retried by a five-minute
cron), the inbox is copied read-only over IMAP (`InboundEmail`, text only), and on top of that sit
email confirmation, the real password reset and an opt-in hourly notification digest. The superuser —
not staff — reads both lists in `/moderation` → Mail. **The log never holds a working link**: a
confirmation or reset body is stored with `[[link]]` and the link is built at send time.

**`analytics`** and **`sso`** (2026-10-14, `HISTORY.md` §17CJ, `ANALYTICS-LAW.md`). `analytics` is the
consent-free usage statistics behind `/moderation` → Analytics → `/moderation/analytics`: a nightly
`rollup_analytics` RECOUNTS the request-log shards into aggregate tables that hold no IP, UA string or
user id, people-counts under 10 read "<10", minors are excluded, `Sec-GPC`/`DNT` requests are skipped
(an art. 21 objection), aggregates die at 25 months. **Nothing is ever collected in the browser** — a
beacon or a visitor id would need consent under PKE art. 399; read `ANALYTICS-LAW.md` §3 before adding
any metric. `sso` is sign-in with Google / Apple / Microsoft (OIDC + PKCE, identity keyed on provider +
issuer + subject, **never linked by email**, the age gate shared with registration through
`accounts/minors.py: self_registration_refusal`); a provider shows only when configured in the
environment AND the `social_login` flag is on. Every door into an account records the terms through
`legal/terms.py` (`legal.TermsAcceptance`, append-only).

**Who runs it, legally** (owner, 2026-10-14; `LEGAL.md` §1): the service provider and GDPR controller is
"grupa studentów Uniwersytetu Warszawskiego", anonymous for now; Ośrodek Komputerowy WF UW provides and
oversees the servers. So the basis for security and statistics is art. 6(1)(f), not a university's
public task. **Account deletion and data export are self-service** (`accounts/erasure.py`, a registry of
what happens to every model that points at a user, with a completeness test that fails on a new FK; a
deleted account becomes a scrubbed tombstone after a 14-day grace). **`licensing`** (same day) gives
every exercise, solution, material and concept article its own licence (`edmat-only` default; the
seeded corpus is `unknown` and that is never offered to a user), changeable only towards more open,
every change a `LicenceChange` row.

**Two boundaries are load-bearing and everything else follows from them:**

1. **No component or route contains fetch logic, ever.** `lib/services/*.ts` is the only seam;
   `lib/api/client.ts` is the only `fetch()`. This is what let the entire mocked Phase-1 frontend be
   pointed at a real backend without touching a single route file, and it still pays off.
2. **A rule that more than one endpoint needs lives in one module, and the endpoints ask it.**
   `accounts/minors.py`, `exercises/entries.py`, `config/audience.py`, `config/creation.py`, `config/blocks.py`, `community/anchors.py`, `contests/access.py`, `galleries/visibility.py`,
   `moderation/services.py`, `booking/availability.py` are all this shape. An endpoint that
   re-implements the rule is how two surfaces start disagreeing.

`adapter-static` is a **deliberate non-change**, not an oversight: every request originates
client-side against a separate-origin API, so nothing needs SSR. The hub and standing pages, the fourteen
`/about/<feature>` showcase pages and the thirteen manual pages are prerendered for first paint, and
`deploy/fuw/pack.sh` refuses a build that is missing one.

---

## Shapes that repeat across the data model

Learn these six and most of the schema reads itself.

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
- **Written content may be a NOTEBOOK** (2026-11-04, §17DI): `blocks`, an ordered list of
  paragraph / formula / code / chemistry / sketch / picture blocks shaped by `config/blocks.py`, on
  `Comment`, `SolutionEntry`, `activity.Post` and (as its own profile) `ConceptRevision`. Every block
  has a stable `id`; the owner's `body` is DERIVED from the blocks in `save()`, so every reader of
  `body` keeps working; a one-paragraph notebook is stored as a plain body. A comment may be about
  ONE block or a quoted passage in it (`Comment.anchor`, validated only in `community/anchors.py`):
  a reply's anchor names its parent's block, a top-level one the target's; plain text answers to
  implicit ids (`body`, `statement`, `answer`, `part-<id>`). Never key anything on a block's position.
- **A claim is a `ClaimBase` subclass** (`materials.ClaimBase` → material / course / exercise
  claims), with shared vote, importance and thread handling in `materials/claims.py`.
- **A lifecycle is one `status` field, never two booleans.** Two booleans make an illegal state
  representable — finished but never published — that every read site then has to defend against.
  Where the terminal state is a *fact about other rows* rather than a decision, it is **derived and
  nothing else writes it**: `needs.rules.recount` for `fulfilled`, `goals.rules.recount` for `met`
  (and a request for it comes back 400 with the reason — house rule 10). A status people can set by
  hand is a status that stops meaning anything.
- **A feature surface gets a `FeatureFlag` kill switch**, checked through `feature_gate('<key>')`
  with an `is_staff` bypass. Forty exist today (counted with `FeatureFlag.objects.count()` on a copy of the dev
  database, 2026-10-22, after `exercise_bulk_upload`, moderation 0057; thirty-nine since `client_errors`, moderation 0055, 2026-10-14 — this number had drifted twice before, so count it rather than increment it,
  which is how the "thirty-three" that preceded "thirty-four" turned out to be two short rather than one) — `exercise_submissions` `material_submissions`
  `tutoring` `messaging` `courses` `events` `posts` `issues` `galleries` `chemistry`
  `age_verification` `coauthoring` `concepts` `sketches` and the six conference switches
  `venues` `event_documents` `tickets` `shifts` `cloakroom` `role_preview` (seeded together by
  moderation migration 0043, so that seven parallel branches never each added one) and the six
  management switches `organizations` `tasks` `needs` `plans` `decisions` `work_dashboard`
  (migration 0044, for the same reason — `MANAGEMENT-BRIEF.md` §0), plus `school_demo` (0045) and
  `volunteering` (0046, the offers board — its own switch and not a second use of `needs`, because
  the two boards answer two questions) and the learning cycle's three (0047, `prompts/01-prep.md`):
  `flashcards`, `learning_record`, and `creation_requires_verification`, which is INVERTED like
  `material_uploads_verified_only` (on = founding a course, an event, a listing or an organisation
  needs a verified contributor; `config/creation.py`) and seeded ON by owner decision, plus
  `ai_assisted` (0050, the "AI-assisted" mark — `provenance/`; off, the chip leaves every statement,
  hint, solution, comment and review and the two menu items it owns leave the content menu, while
  reply, report and the moderator's remove stay, because those belong to other features) and `goals`
  (0051, goals and their definitions of done — `goals/`; off, the Goals panel leaves every node page
  and `/about`, the "Serves: …" line leaves every task and plan, and the thread under a goal closes
  with it) and `attachments` (0052, attachments on anything — `attachments/`; off, every
  `/api/<kind>/<id>/attachments/` closes for a non-staff caller, the panel leaves every page it is
  mounted on, and "Attach something" goes with it) and `social_login` (0054, sign-in with an external provider — `sso/`; with no credentials configured
it shows nothing anyway) and `client_errors` (0055, the first-party browser error reporter —
  `analytics/client_errors.py`; off, the server drops every report and the dashboard section goes) and
  `exercise_bulk_upload` (0057, a person's bulk upload of exercise files — `exercises/bulk.py`; off, or
  with `exercise_submissions` off, `/api/exercise-imports/` closes for a non-staff caller and
  `/submit/bulk`, its link on `/submit` and its Add… entry go) and `contests` (0053, contests — `contests/`;
  off, every `/api/contests/…` and `/api/contest-presets/` closes for a non-staff caller, the hub,
  the Add… entry, the account-menu item, the work-dashboard sections and the feed rows go with it,
  while a contest node's tasks, plans and goals stay reachable by id for its staff, because those
  belong to other features) — and the `legal` notice channel is the one deliberate exception
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
cases identical. `npm run check:katex` re-runs the corpus-wide compatibility check (2259 rows incl. part text, 0
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
- **Management text is a THIRD case, and it has its own table** (`translations/`, 2026-10-08): a
  task, a plan, a need, a poll, a poll option and an organisation's description, one row per
  language, resolved for the reader's INTERFACE language (`?lang=`) with a reading that says which
  language they actually got and whether a newer version is waiting in another one. It is not
  `ExerciseTranslation`'s shape because there is no review queue — the people writing it are the
  people who already run the thing — and the editor writes every language in ONE submission, which
  is what keeps the "the Polish is 4 minutes newer" note from ever appearing on content somebody
  just wrote. Before it, `work/edmat_project.py: _pl_en()` glued both languages into one field and
  every reader of `/about` got both at once.

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
/api/exercises/{id}/  (PATCH)                                          the author's or staff's in-place edit (`exercises/editing.py`); no PUT, no DELETE
/api/exercises/{id}/  (PATCH `parts`) /api/exercises/{id}/entries/ (`part`)  a set-shaped exercise's parts (`exercises/parts.py`, SUBEXERCISES-BRIEF.md): the whole list in order; a hint or solution for one part
/api/exercise-submissions/ /api/edit-suggestions/ /api/moderation/…  the queues
/api/exercise-imports/?mode=preview|commit /api/moderation/batches/{batch}/approve/  a person's bulk upload of exercise files, and a moderator deciding one upload (`exercises/bulk.py`)
/api/courses/ /api/events/ /api/services/ /api/bookings/             user-run surfaces
/api/material-projects/ /api/material-versions/ /api/project-invites/ co-authoring (COAUTHORING-BRIEF.md)
/api/concepts/ /api/concept-articles/ /api/concept-revisions/ /api/concept-links/  concepts (CONCEPTS-BRIEF.md)
/api/needs/ /api/volunteering-offers/                                 help wanted, and who is offering
/api/goals/ /api/goal-criteria/ /api/nodes/{kind}/{id}/goals/          a goal and its definition of done
/api/decks/ /api/cards/ /api/flashcards/due/ /api/nodes/{kind}/{id}/decks/  flashcards (prompts/02-flashcards.md)
/api/creation/ /api/users/{id}/learning-record/ /api/courses/{id}/completions/  the creation gate, the learning record, certificates
/api/ai-assistance/ /api/ai-assistance/{kind}/{id}/{vote,author-mark,lock}/   the "AI-assisted" mark (provenance/)
/api/text-versions/{kind}/{id}/                                       one management row's text in every language at once
/api/{kind}/{id}/attachments/ /api/attachments/{id}/{file,acknowledge,replace,withdraw,receipts}/  attachments on any of twelve kinds (a poll joined 2026-10-10, a board post 2026-10-21)
/api/contests/ /api/contest-presets/ /api/contests/{id}/{announce,stages,registrations,results,complaints,rules,compliance}/  contests (CONTESTS-BRIEF.md)
/api/contest-stages/{id}/{problems,submission,submit,submissions,ranking,open,close,advance}/  a stage, from both sides of the desk
/api/sketches/ /api/chem-drawings/ /api/inline-images/                 pictures embedded in content
/api/posts/?tag=<slug> /api/posts/?course=<id>                        one tag's questions and posts (the tag page; WP15); a course's board — its posts and its subcourses' (2026-10-21)
/api/discussions/ /api/discussions/thread/ /api/discussion-locations/  talk under a standing page — or under a task, a plan, a need or a poll (`tasks/17` as the page; `?keys=` for a whole board)
/api/locale-hint/                                                     first-visit language (pl unless the IP is abroad)
/api/people/suggestions/                                              the people this account shares a roster with — every "add a person" picker (no people search, by design)
/api/auth/{register,login,logout,me,password-reset}/                 DRF TokenAuthentication
/api/auth/{confirm-email,confirm-email/resend,password-reset/confirm,me/mail}/   mail (backend/mail/)
/api/mail/{status,outbound,outbound/{id}/retry,test,inbound,inbound/fetch}/  the Mail tab, SUPERUSER only
/api/analytics/{overview,traffic,content,community,moderation,coverage,cohorts,health,…}/  usage statistics, STAFF only
/api/client-errors/                                                   a browser error report (sendBeacon, no cookie; analytics/)
/api/courses/{id}/materials/ /api/courses/?parent=<id>                 a course's materials, its whole subtree's included; one course's versions AND subcourses (`parent_relation` tells them apart)
/api/auth/sso/{providers,<p>/start,<p>/callback,exchange,ticket,complete,identities,link/…}/  sign-in with Google / Apple / GitHub / Facebook / Microsoft
/api/auth/me/{export,erasure,password}/ /api/auth/erasure/cancel/   GDPR self-service and the password form
/api/licences/{kind}/{id}/ /api/licences/mine/ /api/licences/bulk/   one item's licence; everything the caller posted, and widening many at once (`licensing/bulk.py`)
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
/courses … /events … /tutoring … /bookings                    user-run surfaces
/needs … /volunteering …                                      help wanted, and who is offering
/goals/[id]                                                   one goal and its definition of done
/contests /contests/new /contests/[id]/{rules,stages/[s],judge,results,manage,certificate/[r]}  contests (konkursy)
/flashcards /flashcards/[id] /flashcards/[id]/review            decks and spaced review
/courses/[id]/certificate/[completionId]                       a completion certificate, printed by the browser
/material-projects … /project-invites/[token]                 co-authoring a material
/concepts /concepts/[slug] … /articles/[id]/{edit,history}     concept wiki, articles per audience
/messages … /notifications /activity /posts/[id]              inbox + feed
/ask /tags/[slug]                                             ask a question in a tag, and the tag's own page (WP15)
/my-set /sets/[id] /submit /submit/mine /submit/bulk /submit-material /search   study + contribute (`/submit/mine`: what you sent, and what became of it; `/submit/bulk`: many exercise files at once)
/settings /settings/profile /users/[id] /login /register      account
/forgot-password /reset-password /confirm-email                 the links in the mail (query-string tokens)
/moderation /legal/queue /issues                              staff + reports
/privacy /terms /legal /levels                                standing pages
/moderation/analytics                                         usage statistics (staff)
/auth/sso/done /auth/sso/complete /auth/sso/link                the provider sign-in's return, signup and confirm-and-link pages
/settings/account /cancel-deletion                             download my data, delete my account, change my mind
/settings/licences                                            the licence of everything you posted, widened many at a time
/about                                                        what EdMat is: the promo reel (real pages on phones), the feature grid, the manual and the showcase index
/coop                                                         the project itself: the EdMat organisation's page (goals, needs, the open board and its polls) — `/about` until 2026-11-02
/about/<feature> /about/guide /about/guide/[chapter]          the showcase (sample data + real screenshots, fourteen pages) and the manual
```

URL segments are neutral English (`/branches/`, not `/przedmioty/`) — the app is bilingual from day
one, so its URLs should not encode one language as more native than the other.

**Two deliberate exceptions, 2026-10-01, by owner decision:** `/tutoring` is `/korki` for a Polish
reader and `/materials` is `/materialy`, because those are the words Polish readers search for and
an address is the first thing they read. Everything else keeps the rule. The mechanism is
Paraglide `urlPatterns` + the existing `hooks.ts` reroute + `lib/utils/localizedPath.ts` at the
call site, and `frontend/CLAUDE.md` has the three things that must stay in step. **The backend is
not renamed**: the Django app is still `services` and the API is still `/api/services/`.

**`/volunteering` is the offers board; `/volunteering/hours` is the shifts rota's own page.** Two
features that share a word and answer to two different flags (`volunteering` and `shifts`).

---

## Running, testing, environment

```bash
./setup.sh          # Ubuntu, from nothing: Python, Node 24, deps, corpus, database
./run.sh            # starts both halves, keeps CORS origin + frontend/.env in step with the ports
```

- **One shared venv at the repo root**, `.venv/` (Python 3.12). From `backend/`:
  `../.venv/bin/python3 manage.py test --parallel 4 --keepdb` (2718 tests, **13 min** with the test databases kept, **21–23 min** when they are rebuilt, on this six-core
  machine on 2026-10-07 — nine of them building the ten in-memory databases, which `--keepdb` cannot
  keep; serial is ~52 min), `manage.py check`, `manage.py makemigrations --check --dry-run`. Every
  test class that reaches an endpoint declares `databases = set(all_log_shards()) | {'default'}`, and
  `testing/check_databases_declared.py` must print zero (`test.md` §1, `HISTORY.md` §17BT.A).
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

- **Email exists since 2026-10-14** (`mail/`), and password reset, confirmation and the notification
  digest use it. Still not built on it: an anonymous DSA filer's follow-up, a guardian resetting a
  child's password by mail (a child has no address), bounce handling, a change-of-address flow.
- **No CI**, and nothing exercises a clean-clone install — which is exactly how the requirements
  files drifted unnoticed.
- **No frontend unit test suite.** Verification is `npm run check` plus the browser scripts in
  `frontend/e2e/`; there is no Vitest layer and no test gate on push.
- **SQLite, single-writer.** Fine for this deployment, and the reason for several concurrency
  workarounds that PostgreSQL would not need. See `backend/CLAUDE.md`.
- **No people search**, by design. Since 2026-10-21 every "add a person" form offers the people
  the caller already shares a course, an event, an organisation or a material project with
  (`/api/people/suggestions/`, `PersonPicker.svelte`); anybody else still needs their numeric
  account id, and messaging someone new does too.
- **No per-account timezone.** Every wall-clock value is read in `settings.TIME_ZONE`, which is
  **`Europe/Warsaw`** (owner, 2026-10-15: "stays poland"); the display preferences (24h/12h, week
  start) say how a time is *drawn*, not which clock it is drawn from. That one setting is a tutor's
  weekly "14:00" (`booking/availability.py`), a minor's night 22:00–06:00 (`shifts/rules.py`), the
  day a flashcard falls due (`flashcards/rules.py`), the day an analytics row counts under
  (`analytics/rollup.py: day_bounds`) and the offset every API datetime is written with (DRF
  answers `+02:00`/`+01:00`, no longer `Z`). The browser draws instants in ITS zone, so a reader in
  Poland sees the tutor's own 14:00 and a reader in London sees 13:00 — the honest limit, said on
  `/about/tutoring` and in the manual. Until that day the setting was `'UTC'` and every Polish
  reader was offered each slot one or two hours later than the tutor set it (WP11 found it;
  `HISTORY.md` §17CP fixed it). **Two traps if you touch time:** turn a wall-clock time into an
  instant ONCE and do arithmetic in UTC (Python adds a `timedelta` to, and subtracts two datetimes
  sharing, a zoneinfo tz on the WALL CLOCK — a 25-hour October day measures 24); and never build a
  day bound with `tzinfo=dt.timezone.utc` — use the project zone's midnight.
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
| dziedzina | discipline (`taxonomy.Discipline`) — matematyka |
| dział | branch (`taxonomy.Branch`) — analiza matematyczna, geometria |
| temat / podtemat | topic / subtopic (`taxonomy.Topic` / `Subtopic`) |
| kierunek | a degree programme (USOS) — NOT a taxonomy level any more (§17DE) |
| przedmiot | a taught offering — a `courses.Course`, a subject on a transcript; NOT a taxonomy level |
| kurs (prowadzony przez użytkownika) | course (`courses.Course`) — something a person runs and others join |
| wydarzenie | event (`events.Event`) — a one-off happening, neither a course nor a booking |
| aktualność | update (`events.EventPost`) — a dated note a host appends after announcing |
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
