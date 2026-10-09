# contests/ — a staged competition somebody organises, a jury scores, and results close

Scoped context for this app. The root `CLAUDE.md` holds the cross-cutting rules; `CONTESTS-BRIEF.md`
is the design and the two-step split; `CONTESTS-LAW.md` is the research every refusal here comes
from; `HISTORY.md` §17CE records what each step built and why.

**Step B adds a "Presets and personalisation" section to this file at integration**
(`CONTESTS-BRIEF.md` §4 rule 7) — through the board, not by editing step A's text.

## Why this is not an event and not a course

A contest has one property neither has: **the participants are judged, and the judging produces a
ranking** — laureate, finalist, distinction — that outlives the contest and that Polish law attaches
real consequences to. A course has no jury; an event has no ranking. Everything a contest SHARES
with them — a roster, a venue for its final, documents, a rota of volunteers, tasks, plans, goals,
needs, polls, attachments, flashcards, a discussion, a bilingual description, an organisation behind
it — it gets by **being a node** (`config/nodes.py`, kind `contest`), never by copying any of it.

## The five rules that produce most of this code

1. **No prize ⇒ no obligations.** `has_prize=False` is the default and the whole point of the
   `challenge` preset: with no promised prize there is no *przyrzeczenie publiczne* (KC art. 919 §1
   needs one), no gambling exposure and no PIT. Turning the prize on is one deliberate toggle that
   unlocks a claim deadline, a tax decision and a named płatnik. Every prize-only field is nullable
   and every prize-only refusal is skipped when it is off.
2. **A draw is structurally impossible.** There is no `draw` advancement, no tie-break by lot — ties
   SHARE a rank and the organiser breaks them on merit in the regulamin — and
   `rules._looks_like_a_draw` refuses `chance_element` on an announce, on a stage description as it
   is typed, and on the merit criteria. Chance deciding *any* stage makes the whole thing a *gra
   losowa* needing a permit, and u.g.h. art. 89's administrative penalty stacks with KKS art. 108's
   240 *stawki dzienne*. This is the one rule it is worth being unsubtle about.
3. **The claim deadline is the single hard field.** KC art. 921 §1: a promise of a prize for the
   BEST work with no deadline within which the prize may be claimed is *bezskuteczne* — the whole
   promise, not the deadline. It is nullable in the schema (a draft may be incomplete) and refused
   by rule (`claim_deadline_missing`), so the organiser is told which field and why.
4. **Publishing a name is its own, revocable consent.** `ContestRegistration.publish_name` defaults
   False, has its own PATCH endpoint, and only the participant may change it — not the organiser,
   who is the party it is given to. `ContestResultSerializer` then shows a full name only when the
   consent AND the contest's `publication_default` both allow it. UODO's own pupil-contest regulamin
   is where that separation comes from.
5. **A minor enters only with a guardian's consent recorded on the row** (a NAME and a timestamp,
   never a bare boolean — a boolean cannot be shown to anybody later), on a preset that allows
   minors at all, and does not lodge a complaint themself. Under 16 is the line
   (`accounts/minors.py`; GDPR art. 8, which Poland did not lower).

## Where each answer lives

| Question | Module |
|---|---|
| May this person see it / where do they stand | `access.py` — asked by the node seam, every viewset and every panel |
| May this happen, and why not | `rules.py` — every refusal word, and the ONLY writer of `status`, `advanced`, `ContestResult` and `ContestScore` |
| What does a contest of this kind need | `presets.py` (DATA; step B owns it) |
| What did the preset create on the node | `personalize.py` (step B) |
| Has the organiser met their obligations | `compliance.py` — the checklist evaluated against the rows |
| Who could the founder put on the jury | `people.py` — the four rosters they already share |
| What is waiting on me | `work.py` (four kinds; step B registers it) |
| What did I achieve | `record.py` (published results only; step B registers it) |

## Traps this app has its own version of

- **Nothing stores a score.** A submission's points are the MEAN over the jurors who scored each
  problem, summed over problems, recounted on every read (`rules.submission_points`). A stored total
  drifts the moment a juror edits a cell. The honest limit is stated in that function: a problem no
  juror has scored contributes zero, so a half-scored submission reads low rather than unknown, and
  `scored_problem_count` beside it is how the matrix says which is which.
- **`ContestResult` rows exist only between `publish_results` and `unpublish_results`.** There is no
  `is_published` flag: the row's existence IS the publication. Unpublishing deletes them and is
  allowed only while the complaints window is open — after it, the ranking is the record and the
  answer to a mistake is a new version (house rule 12).
- **`advanced` is a decision, not a recomputation.** `rules.advance` is its only writer, and that is
  deliberate: a participant who was told they went through must not stop having gone through because
  a juror later changed a mark. It is idempotent, so re-scoring and advancing again is safe.
- **A stage's problems are 404 before it opens**, to everybody but its staff. An exercise's statement
  is public content already — that is what the corpus is — but WHICH exercises a stage uses is the
  contest itself. 404 rather than 403, because for an entrant they genuinely do not exist yet.
- **The stage payload carries the statement only.** `ContestProblemSerializer` resolves the
  exercise's translation for the reader's `?lang=` and sends `title` + `statement`. No `answer`, no
  hint, no solution pool — enforced in the serializer that builds the payload, not in a frontend
  that chooses not to draw them.
- **Catching an `IntegrityError` needs its own savepoint.** Two inserts here can collide with a
  unique constraint (`contests_one_role_per_person`, `contests_one_problem_per_exercise`), and
  catching the error without `with transaction.atomic():` around the insert leaves the surrounding
  transaction broken — the next query then answers `TransactionManagementError`, a 500 on a request
  whose honest answer is 409. `backend/CLAUDE.md` SQLite rule 3; found by this app's own test on the
  first run of `test_api.py`.
- **A registration's displayed NUMBER is recounted, not stored.** It is the row's position among the
  contest's registrations ordered by arrival (`serializers._registration_numbers`), which is what the
  jury's anonymised matrix shows. Registrations are never deleted — every terminal status keeps its
  row — so the position is stable, and a stored sequence under SQLite's single writer would be a
  retry loop for something two queries answer.

## Testing

- `tests.py` — the prep's seven assertions (the draft-404 rule, the roles, the node seam, the flag,
  the creation kind). No endpoint, so plain `APITestCase` with the log-shard declaration it already
  carries.
- `test_rules.py` — every refusal word in `rules.py`, refusals first and the happy path last. These
  classes reach **no endpoint**, so they stay on plain `TestCase` and deliberately do not declare the
  log shards: leaving them bare is what keeps `testing/check_databases_declared.py` meaningful.
- `test_api.py` — the endpoints. One base class makes the log-shard declaration for the whole file
  (`backend/CLAUDE.md`, "Testing").

`manage.py seed_contest_demo` builds two lived-in contests on the dev accounts and is idempotent —
run it twice; that is the check. It deliberately does NOT flip `Profile.is_minor` on a shared dev
account (a site-wide flag that would close messaging and lock profiles), and says so; `--minors`
does it for anybody who wants to see the guardian refusal in a browser.

## Presets and personalisation (step B, `CONTESTS-BRIEF.md` §3.B)

`presets.py` is DATA and `personalize.py` is MECHANISM, and the split is the reason both languages
of every sentence sit on one line where a reviewer can see that the Polish still says what the
English does. A preset says which stages a contest of its kind has, who the *przyrzekający* is,
whether a prize is promised, which regulamin sections and checklist items it owes, what its goal's
definition of done is, and which roles the wizard asks the founder to fill. `LAW` is the citations
with their verification markers and `LAW_PL` is the same citations in Polish — a separate table,
not a third tuple element, so that `law_as_api()` could gain `citation_pl` without changing a shape
step A reads. `checklist_for` and `goal_criteria_for` take an optional `has_prize` override,
because the one fact a preset cannot know is whether THIS contest promises a prize: turning it off
drops the prize-only rows, and turning it on does not invent rows the preset never named.

`personalize.apply_preset(contest, actor)` turns that into rows on the contest **node**: one
`plans.Plan` with the timeline (`PLAN_PHASES`, plus two steps per stage, with due dates worked out
from the contest's own four datetimes), one `goals.Goal` whose criteria are the definition of done,
one `tasks.Task` per checklist item assigned to the organiser or the secretary by `role` and
carrying `citation_block()` — the articles, their markers and "this is not legal advice" — one
`needs.Need` per `needs` entry, and one draft `decisions.Poll` for the jury. Three rules hold it
together. **Every row goes through its own app's write serializer** after that app's own rule
module has said yes (`tasks.rules.can_create`; `config.nodes.can_manage_node` for the other four),
so their validation and their sanitizer run and nothing here is a second copy of "may this
person". **A module that is switched off or not installed is a word in `skipped`, never an
exception** — `ContestViewSet.create` calls this, so a kill switch must not be a 500 on founding a
contest. **It is idempotent row by row, keyed by title on the node**, and answers
`already_personalised` when nothing new was made; switching a flag back on and re-running
therefore fills in what the switch cost, which a single "already done" marker could never do. Text
is written in both languages in ONE `translations.services.write_versions` submission, Polish the
original, so a row this created never tells a reader the Polish is four minutes newer. `has_prize`
and `complaint_window_days` are read with `getattr` and fall back to the preset — written that way
so the two contest branches could be built at once, and correct afterwards because the preset is
the right default for a field nobody has touched.
