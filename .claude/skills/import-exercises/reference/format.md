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
to `university`, `locale` to `pl`, `published` to `true`, `licence` to `unknown`.

## Everything

```markdown
---
number: 389                 # the natural key with the branch. Omit and one is allocated + written back
title: Całka Gaussa
topics: [calki, teoria-miary]
difficulty: trudne
audience: university
licence: cc-by-sa-4.0       # only if the rights holder granted it; omit → unknown
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
| `licence` | no | `cc0-1.0` `cc-by-4.0` `cc-by-sa-4.0` `cc-by-nc-4.0` `cc-by-nc-sa-4.0` `edmat-only` `unknown` (`backend/licensing/licences.py`). Default `unknown`. Covers the statement, answer, hint and solution in the file. A re-run only widens an existing row's licence |
| `locale` | no | the language the body is written in. Default `pl` |
| `published` | no | `false` imports it hidden — a staging state, not a draft workflow. `true` never *re*-publishes an existing row that is unpublished or auto-hidden: that was somebody's decision, and the run warns instead |
| `tags` | no | free slugs; created on demand, never removed by a later run |
| `source` | no | mapping. `type`: `Ćwiczenia/exercises`, `Kolokwium/midterm`, `Egzamin/exam`, anything else → `other` with a warning. Plus `name`, `collection`, `original_problem_number` (int), `pages` (string), `chapter` (int). A sub-problem letter (`11a`) is not an integer: put the number in `original_problem_number` and the letter in `name` ("…, zadanie 11a"), which is free text and is what a reader sees. Any other sub-key is carried in the file and ignored — there is no column for it |
| `id` | no | accepted and ignored — the corpus files carry one |

Any other key is an error, including `verified:` (derived — see SKILL.md §4) and a mistyped `tag:`.

## Sections

| Heading (either language) | Goes to |
|---|---|
| `## Treść` / `## Statement` | `ExerciseTranslation.statement` — **required** |
| `## Wskazówka` / `## Hint` | a pinned, published `SolutionEntry(kind='hint')` |
| `## Odpowiedź` / `## Answer` | `ExerciseTranslation.answer` |
| `## Rozwiązanie` / `## Solution` | a pinned, published `SolutionEntry(kind='solution')` → makes the row `verified` |

`## Podpunkt <label>` / `## Part <label>` opens a part of a set-shaped exercise — see "Parts" below.

Accent-free spellings (`tresc`, `wskazowka`, `odpowiedz`, `rozwiazanie`) are accepted. **Any other
`## heading` is an error**, because its text would be silently dropped — that is the whole reason the
check exists. Headings inside a body: use `###` or deeper.

Body text is Markdown with raw HTML passthrough and literal LaTeX delimiters: `\( … \)` inline,
`\[ … \]` display. Not `$…$`.

## Parts — a set-shaped exercise

Some exercises are a small set: one shared statement ("Przedstawić w postaci \(a+bi\) następujące
liczby zespolone:") and several items, each with its own answer, its own solution and sometimes its
own hint. Write each item as a **part** (`SUBEXERCISES-BRIEF.md`, 2026-10-21) — it shows on the
exercise page as its own block with its own Hints / Answer / Solutions stages, and readers can add a
hint or a solution for one part.

| Heading | Meaning |
|---|---|
| `## Podpunkt <label>` / `## Part <label>` | opens a part; either language, any case (`## podpunkt a` works too) |
| `## Treść` inside a part | the part's sub-statement → `ExercisePartTranslation.statement` — **required** in every part |
| `## Odpowiedź` inside a part | the part's answer → `ExercisePartTranslation.answer` |
| `## Wskazówka` / `## Rozwiązanie` inside a part | a pinned, published `SolutionEntry` with `part=` that part |

The rules:

- **Whole first, then parts.** Everything before the first part heading is the whole exercise's —
  the shared `## Treść` (still required), and a hint, answer or solution that is about every item.
  Every section after a part heading belongs to that part until the next part heading; there is no
  way back to the whole exercise, so the file reads like the page.
- **The label** is the free text after the keyword, trimmed, at most 20 characters, shown to readers
  as written (the page wraps it: "for (b)"). Use the labelling the sheet uses — `a`, `b`, `c` for a
  sheet's (a)–(c); `1`…`4` for unlabelled items that the solution numbered. Two parts in one file
  may not share a label.
- **Order is the key.** Parts are stored by `(exercise, order)`, order = position in the file from 1.
  A re-run updates each part's label, text and entries in place and never duplicates one; reordering
  the parts in the file therefore rewrites them in their new places.
- **The file is the truth for a set.** Parts beyond the file's count are deleted with their hints
  and solutions, and the run names them. A pinned hint or solution an earlier import wrote (same
  `--author`, same locale) for a section the file no longer has — the whole exercise's or a part's —
  is deleted too: that is what turns an old one-solution-for-everything row into parts without the
  old solution standing beside the new ones. A pinned entry somebody else wrote (staff may pin any
  reader's solution) is never deleted, nor is one readers have commented on or voted on (house rule
  12 — a thread must not break); the run warns and leaves it for a moderator.
- **A file WITHOUT part headings leaves an exercise's existing parts alone** — additive, like tags.
- A hint that is about some items but not others goes into each part it is about (it may appear in
  two parts); a hint about all of them stays before the parts. Do not split a set's solution by
  guessing — read it, and give each part the paragraph that is really about it.
- `verified` is still derived: a pinned solution for the whole exercise, or (since step A of the
  build) a passed solution for every part.

The run prints `parts: N created, M updated, K removed.` on every run, `--dry-run` included. "Updated"
counts CHANGES — a part whose label, text or entries differ from what is stored — so a second run of
an unchanged batch prints `parts: 0 created, 0 updated, 0 removed.`

### The worked example — `algebra` #5 (exercise 964 on edmat.net)

The shared statement keeps the lead sentence; each expression is a part with its own statement,
answer and solution; the old hint was about items 2, 3 and 4, so it is split — the "square first"
sentence goes to 2, the conjugate sentence to both quotients.

```markdown
---
number: 5
title: "Postać algebraiczna potęg i ilorazów liczb zespolonych"
topics:
  - liczby-zespolone-dzialania
difficulty: latwe
source:
  type: Ćwiczenia
  name: Algebra I R – seria 1, zadanie 5
  collection: Algebra I R – zadania na ćwiczenia
  chapter: 1
  original_problem_number: 5
  pages: "1"
tags:
  - liczby-zespolone
  - postac-algebraiczna
  - dzielenie-liczb-zespolonych
  - algebra-i-r
published: true
---
## Treść

<p>Przedstawić w postaci \(a+bi\) następujące liczby zespolone:</p>

## Podpunkt 1

## Treść

\[
(1-i)^2
\]

## Odpowiedź

\[
(1-i)^2=-2i
\]

## Rozwiązanie

<p>\((1-i)^2=1-2i+i^2=-2i\).</p>

## Podpunkt 2

## Treść

\[
\Bigl(-\frac12+\frac{\sqrt3}{2}i\Bigr)^3
\]

## Wskazówka

<p>Przy trzeciej potędze najpierw policz kwadrat.</p>

## Odpowiedź

\[
\Bigl(-\frac12+\frac{\sqrt3}{2}i\Bigr)^3=1
\]

## Rozwiązanie

<p>Niech \(w=-\frac12+\frac{\sqrt3}{2}i\). Wtedy</p>

\[
w^2=\frac14-\frac{\sqrt3}{2}i+\frac34 i^2=-\frac12-\frac{\sqrt3}{2}i=\bar w,\qquad w^3=w\cdot\bar w=\frac14+\frac34=1.
\]

<p>(Geometrycznie: \(w=\cos\frac{2\pi}{3}+i\sin\frac{2\pi}{3}\), więc \(w^3=\cos2\pi+i\sin2\pi=1\).)</p>

## Podpunkt 3

## Treść

\[
\frac{2-i}{3+4i}
\]

## Wskazówka

<p>Iloraz sprowadza się do postaci \(a+bi\), mnożąc licznik i mianownik przez sprzężenie mianownika: \((c+di)(c-di)=c^2+d^2\).</p>

## Odpowiedź

\[
\frac{2-i}{3+4i}=\frac{2}{25}-\frac{11}{25}i
\]

## Rozwiązanie

<p>Mnożymy licznik i mianownik przez \(3-4i\):</p>

\[
\frac{2-i}{3+4i}=\frac{(2-i)(3-4i)}{3^2+4^2}=\frac{6-8i-3i+4i^2}{25}=\frac{2-11i}{25}=\frac{2}{25}-\frac{11}{25}i.
\]

## Podpunkt 4

## Treść

\[
\frac{(1+3i)(8-i)}{(2+i)^2}
\]

## Wskazówka

<p>Iloraz sprowadza się do postaci \(a+bi\), mnożąc licznik i mianownik przez sprzężenie mianownika: \((c+di)(c-di)=c^2+d^2\).</p>

## Odpowiedź

\[
\frac{(1+3i)(8-i)}{(2+i)^2}=5+i
\]

## Rozwiązanie

<p>Licznik: \((1+3i)(8-i)=8-i+24i-3i^2=11+23i\). Mianownik: \((2+i)^2=4+4i+i^2=3+4i\). Zatem</p>

\[
\frac{11+23i}{3+4i}=\frac{(11+23i)(3-4i)}{25}=\frac{33-44i+69i-92i^2}{25}=\frac{125+25i}{25}=5+i.
\]
```

## `batch.yaml` (optional, beside the files)

```yaml
branch: analiza-matematyczna     # --branch overrides this
locale: pl
audience: university
licence: unknown                 # fallback for files that omit it; --licence overrides this
difficulty: średnie              # fallback for files that omit it
topic_names:                     # used only by --create-topics — and this ORDER is the order the
  teoria-miary: Elementy teorii miary   # created topics get, which is how /branches/<slug> sorts
                                        # its topic filter. List them the way the course teaches
                                        # them; anything not listed falls in after, alphabetically.
```

## What validation refuses (nothing is imported if anything is)

- no front matter, invalid YAML, front matter that is not a mapping
- missing or empty `title`; missing or empty statement section
- unknown/missing `difficulty`; unknown `audience`; unknown `licence`
- unknown front-matter key; `verified:`
- a `## heading` that is not one of the four, or `Podpunkt <label>` / `Part <label>`
- a section named twice in one scope (twice before the parts, or twice inside one part — the shape of
  a whole-exercise section written after the parts)
- a part heading with no label, or a label over 20 characters; two parts with the same label
- a part with no `## Treść`, or an empty one; text directly under a part heading, outside any section
- unbalanced `\(`/`\)` or `\[`/`\]` in title, statement, hint, answer or solution (a part's too) — counted with
  `\\` stepped over, because `\\[3mm]` (a line break inside `cases`/`aligned`) is punctuation, not
  display maths, and 73 files of the real corpus use it
- `source.original_problem_number` or `source.chapter` that is not an integer
- two files in the batch claiming the same `number:`
- a `topics:` slug the branch does not have, without `--create-topics`
- a `--branch` slug that does not exist, or a `--author` username that does not exist

Warnings (not refusals): an unrecognised `source.type`, which becomes `other` — the real corpus has
free-text types like `Materiały dodatkowe`.
