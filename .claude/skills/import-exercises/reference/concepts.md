# Importing concept pages — `manage.py import_concepts`

The bulk-import counterpart of `import_exercises` for concept (wiki) pages (2026-10-21). One `.md`
file is one concept page; the command writes it through the concepts app's own services
(`create_concept` → `publish_revision`, `add_link`, `harvest_body_links`), so what lands is exactly
what the editor would have produced. Read `backend/concepts/CLAUDE.md` for the model (a concept has
no title; articles are a pool of peers; revisions are immutable).

## Running it

```bash
cd backend
../.venv/bin/python3 manage.py import_concepts <dir> --author <username> --dry-run   # always first
../.venv/bin/python3 manage.py import_concepts <dir> --author <username> [--ai-assisted "<note>"]
```

| Flag | Meaning |
|---|---|
| `<dir>` | read recursively; `README.md` and `_*.md` skipped. Point it at `<kit>/<branch>/pojecia/` (or a kit root that holds only concept pages — every other `.md` would be read as one) |
| `--author <username>` | **required.** Writes, owns and publishes every article; re-runs only ever touch this account's articles. A minor is refused |
| `--dry-run` | parse, validate, write everything, roll back. Prints exactly what a real run would do |
| `--licence`, `--locale`, `--audience` | defaults for files that do not say (`unknown`, `pl`, `university`). Precedence: file > flag > `batch.yaml` > default |
| `--skip-missing-exercises` | an `exercises:` entry that is missing or unpublished becomes a warning and is skipped, instead of refusing the batch |
| `--ai-assisted ["<note>"]` | make the author's own AI-assisted mark (`provenance.AuthorMark`, kind `concept_article`) on every article in the batch. Same row `declare_ai_assisted --kinds concept_article` writes |

`batch.yaml` — the nearest one from a file's directory up to `<dir>` — may give `branches`,
`audience`, `locale`, `licence`; any other key is refused.

The report ends with three fixed lines: `N created, M revised, K unchanged, A new article(s) on
existing concepts, S skipped.`, `links: N added, M re-filed, K already there.` and, with
`--ai-assisted`, `AI-assisted: N marked, K already marked.` A re-run of an unchanged batch says
`0 created, 0 revised, <all> unchanged` and `links: 0 added, 0 re-filed`.

## The file

```markdown
---
slug: kula-jednostkowa           # required; [a-z0-9-], the natural key and what [[…]] links to
title: Kula jednostkowa normy    # required; plain text, no < >, ≤ 300
summary: Zbiór wektorów …        # required; plain text, ≤ 500
branches: [analiza-matematyczna] # required (here or in batch.yaml); must exist
tags: [norma, kula]              # added, created on demand; ≤ 50 chars each
audience: university
locale: pl
licence: cc-by-nc-4.0            # omit everywhere → unknown
prerequisites: [norma]           # concept slugs, in this batch or already published
related: [rownowaznosc-norm]
exercises: [analiza-matematyczna/4]   # branch-slug/number, must exist and be published
---
Body: Markdown + allowed raw HTML (inline SVG within the sanitizer whitelist), maths only as
\( … \) and \[ … \], [[slug]] / [[slug|tekst]] links.

### Każdy taki nagłówek otwiera nowy blok markdown
```

The body is split at every `### ` line outside a code fence; each block keeps its heading.

## Idempotency — what a re-run does

- **Unchanged file → nothing.** Title, summary and blocks are normalised exactly as
  `ConceptRevision.save()` stores them and compared with the head of the author's article.
- **Changed file → a new revision on the SAME article**, published by the author; the old head
  becomes `superseded` history. `change_note` is `import_concepts: <file>`.
- **Same slug, different `(audience, locale)`** → a second article (a different page key).
- **The concept exists but somebody else made it** → the author's article is added beside theirs
  (a peer); their article is never touched, and the file's branches are ADDED, not replaced.
- **Branches** are replaced on the author's own concept (the structural claim, like `topics`);
  **tags** are only ever added; **links** are only ever added.
- **Licence** only widens, through `licensing.rules.change_licence` as the author (recorded as a
  `LicenceChange`; refused once somebody else's revision is in the article); narrower → warned, left.

## Links

Filed in a second pass, after every concept in the batch exists — file order does not matter.
One row per (concept, target): an existing row with the same relation is left; a `body` row
harvested from `[[slug]]` for a target the file lists under `prerequisites:` is re-filed as a manual
prerequisite (otherwise mentioning a prerequisite in the text would erase the relation); a manual row
the author filed takes the file's relation; somebody else's manual row is left and named. Then
`harvest_body_links` recounts every batch concept. Exercises are linked as `related`.

## What it refuses (the whole batch, every problem named)

Unknown front-matter or `batch.yaml` keys; missing `slug`/`title`/`summary`/`branches`/body; a slug
outside `[a-z0-9-]` or over 120; `<`/`>` in the title; a summary the stored form would cut (a `<…>`
pair — HTML, or `\(a<b\) … \(c>d\)` — is stripped as a tag); unbalanced `\(`/`\)` or `\[`/`\]` in
the title, summary or any block (`\\` stepped over, as in `import_exercises`; per block, so a `###`
inside a display formula is caught); a `#` or `##` heading in the body; more than 200 blocks or a
block over 100 000 characters; an unknown branch; a moderator-removed tag; a link to the concept
itself, or one slug in both `prerequisites` and `related`; a prerequisite/related slug that is
neither in the batch nor a published concept; an `exercises:` entry that is malformed, missing or
unpublished (unless `--skip-missing-exercises`); two files with one slug; a prerequisite cycle
(the batch's edges plus every prerequisite already in the database).

## What it skips, with a warning (the rest of the batch imports)

An article whose head is somebody else's published revision and the file differs from it (merge by
hand; never published over); an article the author has an open draft on (finish or delete it); a
removed or auto-hidden article (an import is not an appeal).

## What it does not do

- **Announce.** `publish_revision(..., announce=False)`: no feed row, no notification. No audit row
  either (no request — house rule 10).
- Delete anything: no article, revision, link or tag is removed. The one thing a file can take away
  is a branch of a concept the author created (branches are replaced there).
- Check the AI footer line or any writing rule (length, structure) — those are the kit's.
- Upload pictures or PDFs, or produce `latex`/`chem`/`image`/`pdf` blocks: markdown blocks only.
- Report what the sanitizer dropped: disallowed HTML/SVG is removed silently on save, exactly as
  in `import_exercises`. Run the sweep below and look at the page.
- Render the AI-assisted mark: `--ai-assisted` stores it, but no chip draws `concept_article` yet
  (`provenance/CLAUDE.md`) — the footer line is the reader-visible disclosure until one does.

## Verify

```bash
../.venv/bin/python3 manage.py dump_text_fields --out /tmp/edmat_text_fields.json  # now includes concept heads
cd ../frontend && npm run check:katex -- /tmp/edmat_text_fields.json              # Node 24, see SKILL.md §3.6
```

Tests: `manage.py test concepts.test_import`. Rehearse on a copy of the database exactly as SKILL.md
§3.5 shows (add `EDMAT_LOG_DIR=<copy dir>/logdata` and migrate its shards if anything will audit).
