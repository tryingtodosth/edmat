# The exercise file format

One exercise is one `.md` file: YAML front matter, then `##` sections. It is the format the original
`Database-of-Student-Exercise/content/courses/*/zadania/*.md` corpus is written in, so a file taken
from there imports unchanged.

`manage.py import_exercises <dir>` reads `<dir>` **recursively** (`*.md`), skipping `README.md` and
anything whose name starts with `_` — so notes and drafts can live beside the batch.

## Minimal

```markdown
---
title: Pochodna złożenia
difficulty: średnie
---
## Treść
Policz pochodną \(f(x)=\sin(x^2)\).
```

That is enough: the number is allocated and written back, `topics` may be empty, `audience` defaults
to `university`, `locale` to `pl`, `published` to `true`.

## Everything

```markdown
---
number: 389                 # the natural key with the branch. Omit and one is allocated + written back
title: Całka Gaussa
topics: [calki, teoria-miary]
difficulty: trudne
audience: university
locale: pl
published: true
tags: [calka-gaussa, wspolrzedne-biegunowe]
source:
  type: Egzamin
  name: Egzamin 2025, zadanie 3
  collection: Zestaw całek
  original_problem_number: 3
  pages: '12-13'
  chapter: 4
---
## Treść
Oblicz \(\int_{-\infty}^{\infty}e^{-x^2}\,dx\).

## Wskazówka
Podnieś całkę do kwadratu i użyj współrzędnych biegunowych.

## Odpowiedź
\(\sqrt\pi\)

## Rozwiązanie
\[\left(\int_{-\infty}^{\infty}e^{-x^2}\,dx\right)^2 = \pi.\]
```

## Front-matter keys

| Key | Required | Notes |
|---|---|---|
| `title` | yes | plain text; sanitized on save |
| `difficulty` | yes | `łatwe/latwe/easy`, `średnie/srednie/medium`, `trudne/hard` |
| `number` | no | integer ≥ 1. Omitted → allocated from the branch's highest, skipping numbers this batch claims, then **written into the file** |
| `topics` | no | slugs of `Topic` rows **of that branch**. Unknown → refused unless `--create-topics` |
| `audience` | no | `early_years` `primary` `secondary` `university` `adult` `senior` `all` (`config/audience.py`) |
| `locale` | no | the language the body is written in. Default `pl` |
| `published` | no | `false` imports it hidden — a staging state, not a draft workflow. `true` never *re*-publishes an existing row that is unpublished or auto-hidden: that was somebody's decision, and the run warns instead |
| `tags` | no | free slugs; created on demand, never removed by a later run |
| `source` | no | mapping. `type`: `Ćwiczenia/exercises`, `Kolokwium/midterm`, `Egzamin/exam`, anything else → `other` with a warning. Plus `name`, `collection`, `original_problem_number`, `pages` (string), `chapter` (int) |
| `id` | no | accepted and ignored — the corpus files carry one |

Any other key is an error, including `verified:` (derived — see SKILL.md §4) and a mistyped `tag:`.

## Sections

| Heading (either language) | Goes to |
|---|---|
| `## Treść` / `## Statement` | `ExerciseTranslation.statement` — **required** |
| `## Wskazówka` / `## Hint` | a pinned, published `SolutionEntry(kind='hint')` |
| `## Odpowiedź` / `## Answer` | `ExerciseTranslation.answer` |
| `## Rozwiązanie` / `## Solution` | a pinned, published `SolutionEntry(kind='solution')` → makes the row `verified` |

Accent-free spellings (`tresc`, `wskazowka`, `odpowiedz`, `rozwiazanie`) are accepted. **Any other
`## heading` is an error**, because its text would be silently dropped — that is the whole reason the
check exists. Headings inside a body: use `###` or deeper.

Body text is Markdown with raw HTML passthrough and literal LaTeX delimiters: `\( … \)` inline,
`\[ … \]` display. Not `$…$`.

## `batch.yaml` (optional, beside the files)

```yaml
branch: analiza-matematyczna     # --branch overrides this
locale: pl
audience: university
difficulty: średnie              # fallback for files that omit it
topic_names:                     # used only by --create-topics
  teoria-miary: Elementy teorii miary
```

## What validation refuses (nothing is imported if anything is)

- no front matter, invalid YAML, front matter that is not a mapping
- missing or empty `title`; missing or empty statement section
- unknown/missing `difficulty`; unknown `audience`
- unknown front-matter key; `verified:`
- a `## heading` that is not one of the four
- unbalanced `\(`/`\)` or `\[`/`\]` in title, statement, hint, answer or solution
- two files in the batch claiming the same `number:`
- a `topics:` slug the branch does not have, without `--create-topics`
- a `--branch` slug that does not exist, or a `--author` username that does not exist

Warnings (not refusals): an unrecognised `source.type`, which becomes `other` — the real corpus has
free-text types like `Materiały dodatkowe`.
