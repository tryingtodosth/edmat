# Writing a kit (a *paczka*) — the rules the first four batches taught

**Status: a draft for the owner (2026-10-21), written at the end of the sub-exercise integration
(`HISTORY.md` §17CV).** It is addressed to whoever — a person or an agent — turns a problem sheet
into the next `Database-of-Student-Exercise/paczkaN/prepared/` kit. `format.md` says what a file
may contain; `SKILL.md` says how the command runs. This file says what paczka3 got wrong and paczka4
had to redo, so that paczka5 is written right the first time. Every rule below cost a second kit,
a refusal, or a reader seeing less than the sheet said.

## 1. Decide the shape of every problem BEFORE writing it

Read the whole sheet first. For each problem, one of three shapes, and the sheet decides which:

| The sheet shows | Write it as | Example |
|---|---|---|
| one question, one result — even if the sentence asks several things without enumerating them | **one exercise**, no parts | fale 0013, 0016, 0035; algebra 0001 |
| one lead sentence and an enumerated list of items each with its own result — `a) … b) …`, `1. … 2. …`, an `<ol>`, four expressions in one `\[ … \]` separated by `\qquad` | **one exercise with parts** (`## Podpunkt a` sections) | algebra #5 = exercise 964, fale 0034 |
| sub-points that each need their own reasoning, their own title, their own topics or difficulty | **several exercises**, one file each | Algebra s2/4a–4j → ten files |

**Never the fourth shape**, the one paczka3 used for fifteen files: one statement holding the whole
list, one answer block holding every result, one solution with `<b>1.</b>` … `<b>4.</b>` paragraphs.
It reads fine on paper and is wrong in the database — nobody can reveal (c)'s answer alone, hint
(b) alone, or write a second solution for (d) — and undoing it meant rewriting all fifteen files by
hand (paczka4). No tool will split a stored solution for you; the brief refused to build one,
because a wrong cut in a solution is worse than none. Decide the shape when you have the sheet in
front of you, not after.

When in doubt between "parts" and "several exercises": parts share the lead sentence, the topics
and the difficulty; if (d) is a different topic or two levels harder than (a), it is its own
exercise.

## 2. Labels, and how many

- **Label as the sheet does.** `a`, `b`, `c` for (a)–(c); `1`…`4` for items the sheet did not label
  but the solution numbered; `i`, `ii` if the sheet used those. The label is shown to readers as
  written ("Podpunkt b", "for (b)"); do not invent a scheme the sheet does not have.
- At most **20 characters**, unique within the file, at most **26 parts** in one file
  (`exercises/parts.py: MAX_PARTS`, the same cap the edit form has). A set with more items than the
  alphabet is a sheet, and is several exercises.
- The order of the `## Podpunkt` sections is the order on the page and the importer's key
  (`(exercise, order)`); do not reorder parts of an already-imported exercise without saying so in
  the README, because a reorder is an update of every part's text, not a move.

## 3. What goes where inside a set

- **The top `## Treść` is the lead sentence only** ("Przedstawić w postaci \(a+bi\) następujące
  liczby zespolone:"). Every item is the `## Treść` of its own part. A part without `## Treść` is
  refused.
- **Every part has its own `## Odpowiedź` and `## Rozwiązanie`.** A set whose (d) has no solution
  is honestly unverified on the page (`verified` needs a passed solution for every part), so do not
  leave one out because it was short.
- **A hint goes to the part it is about.** Put a hint under the whole exercise only when it applies
  to every part ("multiply by the conjugate" for four quotients). When one sentence of the sheet's
  hint is about (b) and another about (c), split it; when one hint applies to (c) and (d), repeat
  it under both — a reader opening (d) alone must see it.
- **A section is named once per scope**: once at the top, once inside each part. A second
  `## Wskazówka` inside the same part is refused, not glued.
- **Nothing before the first `## Podpunkt` belongs to a part, and there is no way back.** The file
  reads top to bottom like the page: shared sections, then part a with its sections, then part b.

## 4. No lost sentences

Every sentence of the source — statement, hint, answer, solution — lands somewhere: under the whole
or under a part. Before calling a file done, read the sheet's text once more beside the file and
tick each sentence off. The paczka4 rewrite found answers that applied to every part hidden in one
part's block and hints that mentioned a part the file had not labelled; both are the same mistake.

- Keep the sheet's wording and notation. Fix a typo, do not paraphrase.
- A figure is described in words in the statement (the format carries no pictures), and the README
  says which problems had one.
- A problem that only points at a copyrighted collection ("zbiór Cieciury, zad. 7") is **left out
  and listed** in the README with the reason (LEGAL.md §3), never reworded into the kit.

## 5. Maths

Literal `\( … \)` inline and `\[ … \]` display, balanced — the importer refuses a file with an
unbalanced delimiter and names the section. Use `\qquad` inside one display block only when the
items are NOT separate parts (if they are, they are separate `## Treść`s). After any import, run
`manage.py dump_text_fields` and `npm run check:katex` and put the count in the report.

## 6. Front matter — the honest fields

- `number` is the idempotent key with the branch; **never renumber** an imported exercise. A kit
  that updates earlier files keeps their numbers and titles exactly (paczka4's dry run had to say
  `0 created, 15 updated`, and the README's table says which number is which).
- `licence: unknown` for a lecturer's sheet unless the rights are cleared in writing (LEGAL.md §3).
  Never write a licence the source did not grant; the platform never offers `unknown` to a user, and
  `relicense_content` exists for the day the rights are cleared.
- `audience`, `locale`, `difficulty`, `topics` (created with `--create-topics` once, in the sheet's
  teaching order), the `source:` block with the real sheet name and problem number. An unknown key is
  refused as a typo — do not invent keys.

## 7. The command — every run the same way

- **`--author todoonet` on every run**, dry and real. The pinned hint/solution rows carry the author
  as part of their key: a run without it writes a second set of pinned rows and cannot remove the
  stale ones later.
- `--dry-run` first; the real run only when the dry run says exactly the numbers the README
  predicts; then a **second real run**, which must say `0 created, N updated` and
  `parts: 0 created, 0 updated, 0 removed`. Put all three outputs in `PRODUCTION.md`.
- For a kit that rewrites earlier files with parts: the file is the truth. The old whole-exercise
  pinned rows the earlier import wrote are removed (the importer names each one); a row with a
  comment or a vote is kept and reported. The README says how many go.

## 8. The AI-assisted mark

The file format has no field for it. Content written with an assistant is marked **after import**
with `manage.py declare_ai_assisted` (the `provenance` app), and a solution so marked counts as
verified only once a reviewer accepts it. Say in `PRODUCTION.md` whether the kit needs that step,
and make it the step after the import, not a remark at the end.

## 9. The kit's layout

```
paczkaN/prepared/
  README.md          what, from which sheet, which numbers; the split table (file / parts / labels /
                     where the labels come from); what was deliberately NOT split and why; what is
                     missing (figures, copyrighted references) and why
  PRODUCTION.md      the runbook: order of steps, the exact expected numbers of every dry run, real
                     run and second run, the AI-assisted step, the IMPORTED marker
  preflight.py       GET-only checks against edmat.net: numbers free (or existing with the same
                     title, for an update), topics present, the backend knows parts if the kit has any
  <branch>/batch.yaml
  <branch>/zadania/NNNN.md
```

- No pictures, no presentations, no PDFs in the kit (the owner's word: the presentations stay out of
  the bundles). If the presentations repo is the source of truth, write the same files there and say
  so in the README.
- After the server applied it, write the `IMPORTED` marker so `pack.sh` stops carrying the kit.

## 10. Report the way the boards expect

Numbers, not adjectives: files, exercises, parts, the dry-run lines verbatim, the second run's
zeros, the KaTeX count, how many exercises are verified afterwards and why the others are not. Then
"left open": what you did not write and why — a figure you could not describe, a sheet problem that
needs a decision, a part whose answer the sheet did not give. A gap that is named gets closed.
