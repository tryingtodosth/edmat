# B. Sub-exercises — the importer's part sections and the regenerated kit — brief for one agent

| | |
|---|---|
| **Model** | Opus (owner decision 2026-10-21: "spawn opus agents"; no Haiku) |
| **Branch** | `parts/b-import` |
| **Worktree** | `/home/piotr/Projects/edmat/.claude/worktrees/parts-b-import/` |
| **Ports** | API `8182`, Vite `5282` (only to LOOK at an imported set on the page; nothing you build is a page) |
| **Prep commit** | the tip of `fix/analytics-after-deploy` your branch was cut from — `git -C <worktree> log -2 --stat` shows it (the prep itself, then the hash-stamping commit) |
| **Boards** | `/home/piotr/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/piotr/.local/opt/node-v24.22.0-linux-x64/bin:$PATH` |
| **Python** | `/home/piotr/Projects/edmat/.venv/bin/python3` (symlinked into the worktree as `.venv`) |
| **Siblings** | A (`parts/a-backend`) owns every other backend file in `exercises/`, `moderation/`, `licensing/`; C (`parts/c-page`) owns `frontend/`. You own ONLY `backend/exercises/management/commands/import_exercises.py`, a new `backend/exercises/test_import_parts.py`, `.claude/skills/import-exercises/**`, and the kit directories named below. |

## Read first
`prompts/README.md` §4 and §5, then **`SUBEXERCISES-BRIEF.md`** (§1 is the problem — exercise 964
— §4 is your step, §6 steps 2 and 4), then `.claude/skills/import-exercises/SKILL.md` and
`reference/format.md` whole, `backend/exercises/management/commands/import_exercises.py` whole
(the parser `split_file`, `Parsed`, the apply step `_apply`/`update_or_create` block, `_relicense`),
the existing importer tests (`grep -n import_exercises backend/exercises/tests.py`), the prep's
`exercises/models.py` (`ExercisePart`, `ExercisePartTranslation`, `SolutionEntry.part`) and
`exercises/parts.py`. Then the kit: `Database-of-Student-Exercise/paczka3/prepared/README.md`
("Podział" — which sheet problems were kept together and why), `PRODUCTION.md`, `preflight.py`,
and the files themselves. The sources of truth for the kit files are the owner's presentation
repo: `/home/piotr/Projects/presentations/algebra/edmat/` and `/home/piotr/Projects/presentations/fizyka_3/edmat/`
(the kit is a copy of those; `deck/rozwiazania/*.py` are the solution slides the files were
written from, when you need to check a per-item solution).

## The task
1. **Labelled part sections in the file format.** `## Podpunkt a` / `## Part a` (accent-free
   `podpunkt` too; the label is the free text after the keyword, trimmed, max 20 chars) opens
   part "a"; the sections that follow until the next part heading belong to it: `## Treść`
   (its sub-statement — REQUIRED inside a part), `## Wskazówka`, `## Odpowiedź`, `## Rozwiązanie`.
   Sections BEFORE the first part heading are the whole-exercise ones, exactly as today. A
   `## Treść` at the top is still required (the shared statement). Any other heading is still an
   error. `Parsed` grows `parts: list[ParsedPart]` with `(label, statement, hint, answer,
   solution)`; `check_math` runs over every part text; two parts with the same label in one file
   is a refusal; a part with an empty statement is a refusal; a part heading after an unlabelled
   section that followed a part (i.e. a whole-exercise section in the middle) is a refusal — the
   order is "whole first, then parts", so the file reads like the page.
2. **Apply.** For a file WITH parts: `ExercisePart.update_or_create(exercise, order=i+1,
   defaults={label})`; its `ExercisePartTranslation.update_or_create(part, locale,
   status='published', defaults={statement, answer, translated_by=None})`; its hint and solution as
   pinned published `SolutionEntry` rows with `part=<part>` (the existing `update_or_create` keyed
   on `(exercise, kind, locale, pinned=True)` must gain `part` in the key, or a part's solution
   overwrites the whole's — test exactly this). Parts beyond the file's count are DELETED with their
   entries (the file is the truth for a set), and the run says so per file. A file WITHOUT part
   sections leaves existing parts alone (additive, like tags). `--dry-run` reports
   `parts: N created, M updated, K removed`. The licence re-run path (`_relicense`) moves part
   entries too (`SolutionEntry.filter(exercise=…, pinned=True)` already covers them — assert it).
   `recount_verified(exercise.pk)` is already called at the end; A's clause makes it right for a set.
3. **`format.md` and `SKILL.md`**: the part sections, the rules above, a worked example (964's
   file is the example), what is refused. Keep both files' existing structure.
4. **Tests**: `backend/exercises/test_import_parts.py` — the parser (labels, order, refusals), the
   apply (create, re-run updates in place, extra part removed with its entries, a whole-exercise
   solution untouched beside part solutions, `--dry-run` writes nothing, the `pinned` key
   including `part`). Declare the log shards the way `exercises/tests.py` does if any test reaches
   an endpoint (the importer tests probably do not).
5. **The kit — `paczka4`.** Read every file in `paczka3/prepared/{algebra,fale}/zadania/` and decide
   which are set-shaped: one statement that is a list of items (`\qquad`-separated expressions,
   "a)/b)" lists, `<b>1.</b>` paragraphs in the solution). The brief guessed 23; find the real
   number and say it. For each one, rewrite the file BY HAND (reading it, not a regex): the shared
   statement keeps the lead sentence ("Przedstawić w postaci \(a+bi\) następujące liczby zespolone:"),
   each item becomes `## Podpunkt 1` (or `a` — use the labelling the sheet uses) with its own
   `## Treść` (the expression), `## Odpowiedź` (its result), `## Rozwiązanie` (its paragraph), and
   `## Wskazówka` only where the old hint was really about that item (964's hint is about 2, 3 and
   4 — split it). A hint that applies to all stays before the parts. Nothing is lost: every
   sentence of the old file is in the new one or you say why not. Numbers, titles, topics, tags,
   source blocks unchanged. Put the rewritten files at
   `Database-of-Student-Exercise/paczka4/prepared/{algebra,fale}/zadania/NNNN.md` (same numbers,
   each `batch.yaml` copied from paczka3), with a `README.md` (which files, why, the count),
   `PRODUCTION.md` (Polish runbook: the SAME command as paczka3 — `import_exercises <dir> --branch
   <slug> --author todoonet` — this time with `0 created, N updated`), and `preflight.py`
   (checks the exercises EXIST this time — adapt paczka3's). **Also write the rewritten files back
   into `/home/piotr/Projects/presentations/{algebra,fizyka_3}/edmat/<branch>/zadania/`** so the
   source of truth has them (the owner's repo; do not commit there, do not touch anything else in
   it, say on the board that you wrote there).
6. **Rehearse on a copy.** Copy `backend/db.sqlite3` to your scratchpad, run the importer on the
   copy with `--dry-run` then for real (`copy_settings.py` overriding `DATABASES["default"]["NAME"]`,
   `PYTHONPATH=<scratch> DJANGO_SETTINGS_MODULE=copy_settings`), re-run it (0 created, 0 updated
   parts the second time), then `manage.py dump_text_fields` and `npm run check:katex` against the
   copy (ask the frontend's `check:katex` script where it reads the dump from). Start the servers
   on your ports against the copy and LOOK at 964 (`/exercises/964` on the copy — the number may
   differ on dev; find the algebra #5 row) — the page will show the parts only once C's work is
   merged, so what you look at is that nothing is broken and the API's `parts` array is right
   (`curl :8182/api/exercises/<id>/ | python3 -m json.tool`).
7. **Docs**: `HISTORY.md` `## 17CV.B` at the very end (Verified with numbers; the set-shaped count
   and the list; Left open); one paragraph in `test.md`; `backend/exercises/CLAUDE.md` is A's — put
   one sentence about the importer's parts in the SKILL.md instead.

## What "finished" means
- [ ] The parser accepts the labelled sections and refuses the cases above (tests).
- [ ] The apply creates/updates/removes parts and their entries idempotently (tests, and a
      twice-run on the DB copy with second-run counts of zero).
- [ ] The pinned `update_or_create` key includes `part` (a test that a whole solution and a part
      solution coexist).
- [ ] `format.md` + `SKILL.md` updated; the example file imports.
- [ ] `paczka4/prepared/` complete with README, PRODUCTION.md, preflight.py, batch.yaml per branch,
      N rewritten files; the same N files written back to the presentations repo.
- [ ] KaTeX sweep on the copy: 0 issues; the count of rows checked in the board entry.
- [ ] `manage.py test exercises.test_import_parts exercises --keepdb` green (the whole `exercises`
      suite — A is editing it in parallel, so run what exists at your prep commit plus yours).
- [ ] `HISTORY.md` §17CV.B, `test.md`, the board entry in `done.md` with numbers.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| The format and the command | `.claude/skills/import-exercises/SKILL.md`, `reference/format.md`, the command | what you extend |
| The kit shape | `Database-of-Student-Exercise/paczka3/prepared/` (`README.md`, `PRODUCTION.md`, `preflight.py`, `IMPORTED`) | paczka4 mirrors it |
| The DB-copy rehearsal | `HISTORY.md` §17CU (grep "copy_settings") | the pattern, already used twice |
| KaTeX sweep | `frontend/package.json: check:katex`, `backend/exercises/management/commands/dump_text_fields.py` | run after any bulk content change |
| Sources | `/home/piotr/Projects/presentations/*/edmat/`, `deck/rozwiazania/*.py` | the per-item solutions when a paragraph is ambiguous |

## Shapes fixed in advance
- Headings: `## Podpunkt <label>` / `## Part <label>`; inside a part the four known section names.
- Models and `exercises/parts.py` as the prep wrote them; `SolutionEntry.part`.
- `paczka4/prepared/<branch>/zadania/NNNN.md`, same numbers as paczka3.
- The `--dry-run` line: `parts: N created, M updated, K removed`.

## Left open, by design
The AI-assisted mark is still not in the file format (unchanged). A `split_exercise_parts`
command that guesses from bold numerals is NOT built, on purpose (the brief §4). Say both.

## Verify
```bash
W=/home/piotr/Projects/edmat/.claude/worktrees/parts-b-import
cd $W/backend
../.venv/bin/python3 manage.py test exercises --parallel 4 --keepdb
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
# the rehearsal on a COPY (never the worktree's db.sqlite3 for the real run, never the main checkout's)
```
Numbers in the board entry. Commit on your branch (the kit directories under
`Database-of-Student-Exercise/` are gitignored or untracked — check `git status`; if untracked, do
NOT add them, they ship through `deploy/fuw/pack.sh` which the integrator extends). Never push,
never merge, never rebase.
