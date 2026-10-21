# A. Sub-exercises — the rules, the writes and their tests — brief for one agent

| | |
|---|---|
| **Model** | Opus (owner decision 2026-10-21: "spawn opus agents"; no Haiku — `prompts/README.md` §2) |
| **Branch** | `parts/a-backend` |
| **Worktree** | `/home/piotr/Projects/edmat/.claude/worktrees/parts-a-backend/` |
| **Ports** | API `8181`, Vite `5281` (you will rarely need Vite) |
| **Prep commit** | `39bbdef` on `fix/analytics-after-deploy` |
| **Boards** | `/home/piotr/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/piotr/.local/opt/node-v24.22.0-linux-x64/bin:$PATH` |
| **Python** | `/home/piotr/Projects/edmat/.venv/bin/python3` (symlinked into the worktree as `.venv`) |
| **Siblings** | B (`parts/b-import`) owns the importer and the kit; C (`parts/c-page`) owns everything under `frontend/`. The file table in `prompts/README.md` §12 says who edits what; you never edit theirs. |

## Read first
`prompts/README.md` §4 (the always-list) and §5 (the rules), then **`SUBEXERCISES-BRIEF.md`
whole** — it is the design; §2 is the shape, §5 the API, §6 your step 1. Then what the prep
commit already did (`git -C <worktree> show 39bbdef --stat`): `exercises/models.py`
(`ExercisePart`, `ExercisePartTranslation`, `SolutionEntry.part`), `moderation/models.py`
(`EditSuggestion.part`), `exercises/parts.py` (the rule module you extend), `exercises/serializers.py`
(`ExercisePartSerializer`, `parts` on the detail, `part` on entries and on the create serializer),
`exercises/test_parts.py` (two tests you extend). Then `backend/CLAUDE.md`, `backend/exercises/CLAUDE.md`,
`backend/moderation/CLAUDE.md`, `backend/licensing/CLAUDE.md`, `exercises/editing.py`,
`exercises/signals.py: recount_verified`, `licensing/rules.py: _carry_to_own_text`,
`moderation/serializers.py` + `views.py` (`EditSuggestion` create and apply), `exercises/entries.py`.

## The task
Make parts REAL on the write side and in every derived rule, so that step C's page and step B's
importer have a backend that keeps its promises:

1. **`verified` for a set.** `recount_verified` gains the brief's clause: an exercise is verified
   when a passed solution (the existing definition, AI-assisted exclusion included) exists for the
   WHOLE (`part IS NULL`), **or** when every part has at least one passed solution of its own. An
   exercise with parts (a)–(d) where only (a)–(c) have passed solutions is NOT verified. Put the
   clause in `exercises/parts.py` (`verified_by_parts(exercise_id) -> bool` or similar) and have
   `recount_verified` ask it. `ExercisePart` save/delete must recount too (a part added to a verified
   set makes it unverified until that part is solved; a part deleted may make it verified).
2. **Licence carry.** `licensing/rules._carry_to_own_text` moves `ExercisePartTranslation` rows the
   same way it moves `ExerciseTranslation` rows: the original-locale rows and the author's own
   translations. A part's translation table has no `licence` column by design (a part is the
   exercise's own text) — so "carry" here means: nothing to do for the parts themselves, BUT the
   relicense command (`licensing/management/commands/relicense_content.py`) and `change_licence`
   must not break on exercises with parts. Verify by test; if you find a part really needs a
   licence column, STOP and write it on the board — do not add one.
3. **`PATCH /api/exercises/{id}/` takes `parts`.** `ExerciseEditSerializer` gains
   `parts: [{id?, label, statement, answer}]` (`ExercisePartEditSerializer`, every item's
   `label` and `statement` required, `answer` optional blank). Semantics, fixed by the brief and
   by C's form: a missing `id` creates; a known `id` updates label/text; a known part NOT in the
   list is deleted together with its entries (CASCADE) — and its edit-suggestions. `order` is the
   list position (1-based), rewritten on every save. Text goes onto the part's ORIGINAL-locale
   `published` translation row (create it if missing). Each changed part text is recorded as an
   approved `EditSuggestion` with `part=<part>`, `field='statement'|'answer'`, `locale` the
   original, `submitted_by=reviewed_by=user` — the same record the shared statement already gets.
   Refusals: an `id` that is not this exercise's part → 400 `part_not_of_exercise`; two items with
   the same label → 400 `part_label_duplicate`; more than 26 parts → 400 `parts_too_many`. An
   empty list `parts: []` deletes every part (the form says so before it sends it).
4. **`POST /api/edit-suggestions/` takes `part`.** A reader suggests an edit to one part's
   statement or answer: `part` must belong to `exercise` (400 `part_not_of_exercise`), never
   together with `entry` (400 `part_and_entry`), `field` must be `statement` or `answer`
   (`title` has no part meaning → 400 `part_field_invalid`). Applying an approved suggestion writes
   the part's translation row for `locale` (published), creating it if missing, exactly as the
   exercise-level apply writes `ExerciseTranslation`. The queue's serializer shows `part` and the
   part's label so a moderator can tell "(b) statement" from "statement".
5. **Entries.** The prep made `POST /exercises/{id}/entries/` take `part`. Make sure the
   `partial_update` of an entry cannot MOVE it to another part (the prep left `part` writable on
   the create serializer; on PATCH, a `part` in the body is refused 400 `part_immutable` — or
   silently ignored; pick one, test it, say which in the CLAUDE.md). `entries.py` ordering and
   visibility are untouched — assert that in a test (a pending part-entry is visible to its author
   and to a reviewer like any other).
6. **The admin.** `ExercisePart` with an inline of its translations, and the parts as an inline on
   `ExerciseAdmin` (read `backend/CLAUDE.md` "The Django admin" — `raw_id_fields` on every
   person FK). Open the two changelists in a test as a superuser and assert 200.
7. **Tests.** Extend `exercises/test_parts.py` (refusals first, then the happy path) for every rule
   above; a `moderation/test_part_suggestions.py` for item 4; a licensing test for item 2 in a new
   file `licensing/test_parts.py`. Every class that reaches an endpoint declares the log shards the
   way the existing files do; `testing/check_databases_declared.py` must print zero.
8. **Docs.** `backend/exercises/CLAUDE.md` gets a "Parts" section (the shape, the verified clause,
   the PATCH semantics, the refusal words); `backend/moderation/CLAUDE.md` one paragraph on
   `EditSuggestion.part`; `HISTORY.md` `## 17CV.A` at the very end (what, why, Verified with numbers,
   Left open); one paragraph in `test.md`.

## What "finished" means
- [ ] No new migration (the prep made both). `makemigrations --check --dry-run` clean.
- [ ] `recount_verified` with the parts clause; `ExercisePart` signals; tests for the three states
      (whole solved / every part solved / one part short).
- [ ] `PATCH /api/exercises/{id}/` with `parts`: create, update, reorder, delete-with-entries, the
      three refusals, the `EditSuggestion` record, the stranger still 403 `exercise_not_editor`.
- [ ] `POST /api/edit-suggestions/` with `part` + apply; the queue shows the label.
- [ ] Entry `part` immutable on PATCH; visibility/order untouched (tested).
- [ ] The relicense command and `change_licence` run over an exercise with parts (tested).
- [ ] Admin pages open (tested).
- [ ] `manage.py test exercises moderation licensing --parallel 4 --keepdb` green;
      `check`, `makemigrations --check`, `check_databases_declared` = 0.
- [ ] Refusal words listed in `exercises/CLAUDE.md` so C can mirror them in `labels.ts`
      (C's brief already names: `part_not_of_exercise`, `part_label_duplicate`, `parts_too_many`,
      `part_and_entry`, `part_field_invalid`, `part_immutable` — keep to these).
- [ ] `HISTORY.md` §17CV.A, `test.md` paragraph, the board entry moved to `done.md` with numbers.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| The design | `SUBEXERCISES-BRIEF.md` §2, §5, §6 | the shape you are completing |
| What the prep fixed | `git show 39bbdef` | models, migrations, read serializers, the rule module stub, two tests |
| The edit path | `exercises/editing.py`, `ExerciseEditSerializer.apply` | `parts` goes in the same transaction, after the text |
| The derived flag | `exercises/signals.py`, `provenance/signals.py` | every writer of `verified` already goes through `recount_verified` |
| Edit suggestions | `moderation/serializers.py: EditSuggestionSerializer.validate`, `moderation/views.py: EditSuggestionViewSet.decide`, `_apply_*` | the entry-targeted case is the worked example for the part-targeted one |
| Licence | `licensing/rules.py`, `licensing/management/commands/relicense_content.py`, `licensing/tests.py: RelicenseCommandTests` | item 2 |
| Factories | `testing/factories.py` | `make_branch`, `make_exercise`, `make_user`, `make_viewer` |
| The test rules | `backend/CLAUDE.md` "Testing", `test.md` §1 | the `databases` declaration, `--keepdb` |

## Shapes fixed in advance (C and B build against these — do not rename)
- `GET /api/exercises/{id}/` → `parts: [{id, label, order, statement, answer, resolved_locale}]`.
- Entries carry `part: <int>|null`; `POST …/entries/` takes `part`.
- `PATCH /api/exercises/{id}/` takes `parts: [{id?, label, statement, answer}]` with the
  semantics in item 3 and the three refusal words.
- `POST /api/edit-suggestions/` takes `part` with the refusal words in item 4.
- `exercises/parts.py` keeps `parts_of`, `part_text`, `part_refusal` with their signatures.

## Left open, by design
A part as a flashcard or a contest problem; per-part difficulty/topics; parts in the translation
form (`TranslateForm`, C may or may not reach it — say on the board which). Name each in
`HISTORY.md` and `todo.md` under "Sub-exercises step A".

## Verify
```bash
W=/home/piotr/Projects/edmat/.claude/worktrees/parts-a-backend
cd $W/backend
../.venv/bin/python3 manage.py test exercises moderation licensing --parallel 4 --keepdb
../.venv/bin/python3 manage.py check
../.venv/bin/python3 manage.py makemigrations --check --dry-run
../.venv/bin/python3 testing/check_databases_declared.py
```
Numbers in the board entry. Commit on your branch; never push, never merge, never rebase.
