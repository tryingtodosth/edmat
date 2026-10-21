---
name: import-exercises
description: Import exercises (zadania) into EdMat in bulk — the file format, the idempotent management command, what it refuses and what to check afterwards. Use when adding exercises from a problem sheet, a PDF, a TA's set, another database or a generated batch, instead of the one-at-a-time /submit form; also use before writing any ad-hoc ORM script that creates Exercise rows.
---

# Importing exercises (zadania)

You are putting exercises into a live database that readers browse. One exercise is **not one row**,
`verified` is **not yours to set**, and the same import has to be runnable twice. This file is the
whole procedure; the files under `reference/` are the details — `format.md` (what a file may contain),
`alternatives.md`, and `writing-a-kit.md` (the rules for whoever writes the next kit: decide each
problem's shape from the sheet before writing it, labels as the sheet labels, nothing lost, `--author`
on every run, the AI-assisted step — a draft awaiting the owner's word, 2026-10-21).

Read `backend/exercises/CLAUDE.md` as well — it owns the invariants this import has to respect.

**Concept (wiki) pages** have their own command, `manage.py import_concepts` (2026-10-21) — same
CLI shape, same validate-everything-then-write discipline: `reference/concepts.md`.

## 1. What one exercise actually becomes

```
Exercise                  structure only: branch, number, topics, difficulty, audience, licence,
                          tags, published, original_locale, submitted_by (never `verified` — derived)
 └─ ExerciseTranslation    title + statement + answer, one row per (locale, status);
                           the ORIGINAL is a row too (locale='pl', status='published')
 └─ SolutionEntry ×0..2    the hint and the solution, as pinned published entries in the peer pool
 └─ ExercisePart ×0..n     only for a SET (`## Podpunkt a` sections): order + label
     └─ ExercisePartTranslation   the part's sub-statement + answer, one published row per locale
     └─ SolutionEntry(part=…)     the part's own hint and solution, pinned and published
 └─ ExerciseSource         where it came from: exam/midterm/exercises/other, collection, pages
 └─ topics[]  tags[]       m2m into taxonomy.Topic (must exist) and exercises.Tag (created freely)
```

`(branch, number)` is the exercise's natural key and its `unique_together`. That pair is what makes
an import idempotent, which is why the importer insists on having it.

## 2. The command

```bash
cd backend
../.venv/bin/python3 manage.py import_exercises <dir> --branch <branch-slug> --dry-run   # always first
../.venv/bin/python3 manage.py import_exercises <dir> --branch <branch-slug>
```

| Flag | Meaning |
|---|---|
| `--branch <slug>` | target branch; or put `branch:` in `<dir>/batch.yaml`. A missing branch is an error that lists the real ones — **never create a branch to make an import fit** |
| `--dry-run` | parse, validate, write, roll back. Changes nothing, prints exactly what a real run would do |
| `--create-topics` | create the topic rows the files reference and the branch lacks (approved, named from `batch.yaml`'s `topic_names:`) |
| `--locale`, `--audience` | defaults for files that do not say; `pl` and `university` |
| `--licence <key>` | default licence for files that do not say; **`unknown`** if nothing says (see §4) |
| `--author <username>` | credit a real account as submitter and solution author. Omit for corpus-style content nobody here wrote |
| `--no-write-back` | do not write allocated `number:` values back into the source files (then a re-run duplicates — see §4) |

It is **idempotent by `(branch, number)`**: a file carrying `number:` only ever updates its row —
and a part by `(exercise, order)`. Every run ends with `N created, M updated, …` for exercises and
`parts: N created, M updated, K removed.` for parts; the parts line counts real changes, so a re-run
of an unchanged batch says `parts: 0 created, 0 updated, 0 removed.`

## 3. Procedure

1. **Find the branch.** `GET /api/branches/` or `Branch.objects.values_list('slug', flat=True)`.
   A branch is subject matter (`analiza-matematyczna`), never a university's course — that is
   `courses.Course`. If the right branch does not exist, stop and ask; proposing taxonomy is a
   separate, reviewed act.
2. **Map the topics.** Every `topics:` slug must be a `Topic` of that branch. Prefer existing slugs;
   only reach for `--create-topics` when the topic genuinely is missing, and give it a Polish name
   — in `batch.yaml`'s `topic_names:`, **in teaching order**, which is the order they are created in
   and therefore the order the branch page's filter lists them.
3. **Write one `.md` file per exercise** in the format in `reference/format.md`. Polish or English
   section headings both work. Keep the maths exactly as `\( … \)` / `\[ … \]`.
4. **`--dry-run` until it is silent.** One bad file aborts the whole batch on purpose; the report
   names every problem in every file, so fix them in one pass.
5. **Run it for real**, then look at what it printed: created vs updated, and whether it wrote any
   `number:` back. To rehearse the whole thing — including the pages — against a database you are
   not allowed to change, copy it and point one run at the copy; nothing in `backend/` needs
   editing:

   ```bash
   cp backend/db.sqlite3 /tmp/copy.sqlite3
   printf 'from config.settings import *\nDATABASES["default"] = dict(DATABASES["default"], NAME="/tmp/copy.sqlite3")\n' > /tmp/copy_settings.py
   cd backend && PYTHONPATH=/tmp DJANGO_SETTINGS_MODULE=copy_settings ../.venv/bin/python3 manage.py import_exercises <dir> --branch <slug>
   ```

   The same two env vars run `runserver` against the copy, so `npm run dev` with
   `PUBLIC_API_BASE_URL` pointed at it shows the imported pages without the dev database ever
   seeing them (§17CH).
6. **Sweep the content pipeline** — this is the check that catches broken maths. It renders every
   row in the database through the real `renderContent.ts` logic and reports anything KaTeX chokes on
   or any delimiter left unprocessed:
   ```bash
   cd backend && ../.venv/bin/python3 manage.py dump_text_fields --out /tmp/edmat_text_fields.json
   cd ../frontend && npm run check:katex      # expect "Found 0 field(s) with a real rendering issue"
   ```
   It needs **Node 24+** (the system Node here is 18, which cannot run `tsx`); this machine keeps one
   at `~/.cache/edmat-tools/node24/bin`, so `PATH=~/.cache/edmat-tools/node24/bin:$PATH npm run
   check:katex` (on `/home/piotr` it is `~/.local/opt/node-v24.22.0-linux-x64/bin`). Running the script directly instead of through `npm run` drops
   `NODE_OPTIONS=--max-old-space-size=8192` and it dies of heap exhaustion on the full corpus.
7. **Look at a page.** `./run.sh`, then `/branches/<slug>` and the new exercise's own page. House
   rule 2: a passing command has shipped a blank statement before.
8. **Write it down.** The board (`/Projects/edmat-boards/`) and `HISTORY.md`: which branch, how many
   rows, where the content came from, and its licence (`LEGAL.md` — a scanned textbook is not ours
   to publish).

## 4. The rules that bite

- **`verified` is derived, never imported.** It means "a published solution that is pinned, reviewed,
  or by a verified contributor" (`exercises/signals.py:recount_verified`). A `verified:` key in front
  matter is a hard error. Want a verified row? Give it a `## Rozwiązanie`.
- **A number that is taken is an UPDATE, not a refusal.** `(branch, number)` is the natural key in
  both directions: a file numbered into an occupied slot silently rewrites whatever is there and
  reports success. Before importing a batch that carries its own numbers, check what the branch
  already holds (`/api/exercises/?branch=<slug>`) — a sheet numbered from 1, or one continuing a
  corpus whose tail has since been used by submissions, is the case that bites (§17CH).
- **A number is forever.** A file with no `number:` gets one allocated *and written back into the
  file*. If you throw that file away, or pass `--no-write-back`, the next run creates a second
  exercise with the same content — the one failure mode this format cannot detect for you.
- **One published translation per locale**, enforced by a partial unique constraint; pending and
  rejected rows for the same locale are legal and must survive. The importer upserts only the
  published row. Never delete a translation to "clean up".
- **A set's parts follow the file; an exercise without part sections keeps its parts.** For a file
  with `## Podpunkt` sections the file is the truth: parts past its last one are deleted with their
  entries, and a pinned hint/solution an earlier run wrote (same `--author`) for a section the file no
  longer has — the whole exercise's or a part's — is deleted too, so re-importing a one-solution row
  as parts does not leave the old solution beside the new ones — unless readers commented on or voted
  on it, which leaves it with a warning. Each deletion, and each refusal to delete, is named.
  A file with no part sections touches no part (`reference/format.md` "Parts").
- **Topics are replaced, tags are added.** Readers apply tags, so a file cannot remove one. Dropping
  a tag from a file does not drop it from the exercise.
- **The original locale is the language it was written in.** Importing a Polish sheet translated into
  English as `locale: en` lies about the corpus. Import the Polish, then add the translation
  (`reference/alternatives.md` §2).
- **Maths stays literal.** `\(x^2\)`, not `$x^2$`, not `\\(x^2\\)`, not KaTeX HTML. The renderer
  extracts those delimiters *before* Markdown runs (root CLAUDE.md, "Content pipeline"); `$…$` is not
  recognised and would render as dollar signs. Unbalanced delimiters are a validation error.
- **Bodies are sanitized by the models, not by the importer** (`ExerciseTranslation.save()`,
  `SolutionEntry.save()` → `config/sanitize.py`). A `<script>` in your file is dropped silently, and
  `\(p<\infty\)` survives — the sanitizer stashes maths before bleach sees it.
- **`audience` is required by meaning, not by syntax.** It defaults to `university`, which is a
  factual claim about who the exercise is for (`AUDIENCE-BRIEF.md`). A school sheet imported as
  `university` is mis-filed in every list and filter.
- **The licence is declared, never assumed.** `licence:` per file, in `batch.yaml` or `--licence`;
  with none of them the rows are `unknown` ("rights not yet clarified — shown for study only",
  `LEGAL.md` §3). Only declare a Creative Commons licence when the rights holder actually granted it —
  a TA's sheet transcribed from a course is the University's (LEGAL.md §3), not yours to license.
  Keys: `cc0-1.0` `cc-by-4.0` `cc-by-sa-4.0` `cc-by-nc-4.0` `cc-by-nc-sa-4.0` `edmat-only` `unknown`
  (`backend/licensing/licences.py`); anything else is refused. A re-run only ever **widens** a row's
  licence, and records the change; a narrower file is warned about and left (a CC grant is
  irrevocable).
- **An import never republishes.** If the row is unpublished — a moderator removed it, or reports
  auto-hid it — a re-run leaves it hidden and says so. A file *can* hide a row (`published: false`).
- **Flags are not remembered.** The file is the source of truth and `update_or_create` overwrites, so
  re-running without `--author` sets `submitted_by` back to nobody. Re-run a batch with the flags you
  ran it with.
- **No feed, no mail.** An import records no activity row and notifies no tag follower. That is
  deliberate; do not add it in a one-off script.
- **Do not touch `import_legacy_corpus`.** It is the 2026 one-time corpus migration and it no longer
  runs at all (three separate schema breakages — `reference/alternatives.md` §3). It is provenance.

## 5. Converting source material into the format

- A LaTeX sheet: `$…$` → `\(…\)`, `$$…$$` → `\[…\]`, `\begin{equation}` → `\[ … \]`, keep every other
  macro verbatim and let `check:katex` tell you what KaTeX cannot render.
- `\begin{enumerate}` of sub-problems, or "a) … b) …", or four expressions in one display: **one file,
  with parts** — the lead sentence as the shared `## Treść`, each item as `## Podpunkt a` with its own
  `## Treść`, `## Odpowiedź`, `## Rozwiązanie` and (only if it is really about that item) `## Wskazówka`
  (`reference/format.md` "Parts", worked example: `algebra` #5). Split a) b) c) into separate
  exercises only when each needs its own topic, difficulty or title — `paczka3`'s Algebra s2/4a–4j are
  ten exercises for that reason. Split a solution by reading it, never by a regex over `<b>1.</b>`.
- Figures: **not importable yet.** `SolutionEntryAttachment` and the inline-image endpoints exist for
  users, not for this command. An exercise whose statement needs a picture should wait, not ship with
  the picture silently missing.
- An answer and a solution are different things (`Odpowiedź` is the result, `Rozwiązanie` is the
  working). Do not duplicate one into the other to fill a section.

## 6. What this command does not do

Named so the next person does not rediscover it: no AI-assisted mark in the file format (declare it
afterwards with `manage.py declare_ai_assisted`), no `split_exercise_parts` that guesses an existing
row's parts from bold numerals in its solution (deliberately — a wrong cut in a solution is worse than
none; rewrite the file with part sections and re-import), no per-part difficulty or topics, no
figures or attachments, no `ExerciseMaterialLink`
(the "comes from this material" link), no `ExerciseRequirement`, no subtopics, no per-file `--author`
override, no unpublish/delete path (do that in the moderation UI), no CSV/JSON/LaTeX input, and no
chapter mapping (`mapa_rozdzialow.yaml` is corpus-only). It also will not create a branch.

## 7. Verify, and say what you ran

```bash
cd backend && ../.venv/bin/python3 manage.py test exercises      # includes the importer's own tests
../.venv/bin/python3 manage.py check
../.venv/bin/python3 manage.py makemigrations --check --dry-run   # an import needs no migration
```
