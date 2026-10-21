# Sub-exercises — one statement, several parts, each with its own answer, hints and solutions

**Status: a design, not built (2026-10-21).** Owner: *"analyze exercises that are small sets of
exercises — e.g. edmat.net/exercises/964 — let's design a way to have this exercise with one
Statement, and multiple examples split into 4 subsets each with own sub-statement, solution, and
hints, so hints can be both statement- or sub-statement-specific."* This file is the design the
owner asked for; the "Build order" at the end is what saying yes commits to.

## 1. What 964 looks like today, and why the shape is wrong

Exercise 964 (`algebra` #5, from `paczka3`) is four problems wearing one statement:

- **Statement:** "Przedstawić w postaci \(a+bi\) następujące liczby zespolone:" followed by ONE
  display block holding four expressions separated by `\qquad`.
- **Answer:** one display block with the four results.
- **Hint:** one paragraph that is really about parts 3 and 4 (the quotient) and part 2 (the cube).
- **Solution:** one pinned entry whose body is `<p><b>1.</b> …</p> … <p><b>4.</b> …</p>` — the
  parts exist, as bold numerals inside prose.

Everything a reader might want per part — "show me the answer to (c) only", "a hint for the cube",
a second solution for (d) by somebody else — is impossible, because the data model has one
statement, one answer and a flat pool of entries per exercise. 23 of the 64 `paczka3` files and a
large share of the corpus are this shape (every `4a–4j`-style sheet problem that was NOT split into
separate files, see `paczka3/README.md` "Podział").

The same split exists in `paczka3` the other way round: Algebra s2/4a–4j became TEN exercises
because each sub-point needed its own reasoning. That was right for those and wrong for 964, and
the author had no third option. Parts are that third option.

## 2. The shape

```
Exercise                      unchanged: branch, number, topics, difficulty, …
 └─ ExerciseTranslation       unchanged: the SHARED statement (and an optional shared answer)
 └─ ExercisePart              NEW: order, label ("a", "1", "ii" — free text, shown as written)
     └─ ExercisePartTranslation   NEW: (part, locale, status) → statement, answer
 └─ SolutionEntry             + nullable `part` FK: a hint/solution FOR ONE PART; null = whole
```

- **The shared statement stays where it is.** An exercise with no parts is exactly today's
  exercise — no migration touches a row, every page renders as before. A part is additive.
- **Part text lives in a translation table including the original** (root CLAUDE.md, "Text lives
  in a translation table"): one `published` row per (part, locale), the same partial unique
  constraint as `ExerciseTranslation`. A translation of the exercise then carries its parts, and
  a part with no row in the reader's language falls back to the original like the statement does.
- **A hint or a solution points at a part or at the whole.** `SolutionEntry.part` nullable, FK
  with `on_delete=CASCADE`. The pool's every rule (`exercises/entries.py`: who publishes without
  review, who reviews, visibility, ordering) is untouched — the part is an attribute, not a new
  kind. A whole-exercise hint ("use the conjugate") and a part hint ("for (b), square first") are
  the same model with a different `part`, which is the owner's "hints can be both".
- **`verified` stays derived**, with one more clause: an exercise is verified when a passed
  solution covers the whole, OR every part has a passed solution. A set with (a)–(c) solved and
  (d) not is honestly unverified.
- **Licence:** a part is the exercise's own text and carries no licence of its own — it moves with
  the exercise (`licensing/rules._carry_to_own_text` gains the part rows). Entries keep theirs.
- **`EditSuggestion` gains `part`** (nullable) so "suggest an edit" can target a part's statement
  or answer; `field` stays `statement | answer`.

## 3. What the reader sees

On `/exercises/[id]`:

1. The shared statement, as now.
2. Whole-exercise hints (the existing Hints stage), labelled "for the whole exercise" only when
   parts exist.
3. **One block per part**, in order: the label and its sub-statement; then its own three stages
   — Hints, Answer, Solutions — each collapsible exactly like today's, each listing only that
   part's entries, each with its own "Add a hint / solution" that pre-selects the part.
4. The whole-exercise Answer and Solutions stages after the parts (an author may still write one
   solution for all four; 964's current pinned solution lands here untouched on the day parts
   arrive, and can be split later).

The entry composer gets one control: "For: the whole exercise / (a) / (b) / …". The card shows
"for (b)" as a small label. Lists, cards, sets, flashcards, contests and the random picker see no
change — a part is never a thing on its own outside its exercise's page (a contest problem or a
flashcard built from one part is left open on purpose; it is a different feature).

## 4. Getting parts in

- **Import format** (`.claude/skills/import-exercises/reference/format.md`): a labelled section.
  `## Treść` stays the shared statement; `## Podpunkt a` / `## Part a` opens part "a" and the
  sections that follow until the next part or an unlabelled section belong to it:
  `## Wskazówka`, `## Odpowiedź`, `## Rozwiązanie` inside a part are that part's. Labels are
  free text after the keyword. Unlabelled sections before the first part are whole-exercise ones.
  Idempotent by `(exercise, order)`: a re-run updates a part's text, never duplicates it.
- **The edit page** (`/exercises/[id]/edit`, 2026-10-21) gets a "Parts" section: add, remove,
  reorder, a label and two editors per part. Saving sends `parts: [{id?, label, statement,
  answer}]`; a missing id creates, a known id updates, an absent known part is deleted together
  with its entries — which the form says before it saves.
- **964 and its siblings**: the honest path is the files, not a regex over `<b>1.</b>`. The
  `paczka3` sources are regenerated with part sections (the deck has the per-item solutions) and
  re-imported — the importer is idempotent by number, so the 23 affected rows are updated in
  place, and `--author todoonet` keeps the credit. A `split_exercise_parts` command that guesses
  boundaries from bold numerals is explicitly NOT proposed: a wrong cut in a solution is worse
  than no cut.

## 5. API

- Detail: `parts: [{id, label, order, statement, answer}]` (resolved for `?lang=` like the
  statement; `[]` for an exercise without parts). Entries carry `part: <id>|null`.
- `POST /exercises/{id}/entries/` takes `part` (must belong to the exercise →
  `part_not_of_exercise`).
- `PATCH /exercises/{id}/` takes `parts` as above.
- `POST /edit-suggestions/` takes `part`.
- Nothing new is gated: parts are content on surfaces that already exist.

## 6. Build order (one branch, roughly a day)

1. `exercises`: `ExercisePart`, `ExercisePartTranslation`, `SolutionEntry.part` — one migration;
   `moderation`: `EditSuggestion.part` — one migration. `recount_verified`'s parts clause; the
   licence carry; serializers (`parts` on detail, `part` on entries); `entries` POST validation;
   the edit serializer's `parts`. Tests for each rule.
2. The importer's labelled sections + its tests; `format.md`.
3. The page: part blocks, the composer's "For:" control, the card label. The edit page's Parts
   section. Keys in both catalogues. A browser script that imports a three-part exercise, reads
   it, adds a part hint, edits a part.
4. Regenerate the 23 `paczka3` set-shaped files with part sections; re-import on a copy; KaTeX
   sweep; ship as a kit the way `paczka3` shipped.

## 7. Left open by this design

- A part as a flashcard or a contest problem.
- Per-part difficulty or topics (a sheet's (d) is often harder than its (a)); the design keeps
  those on the exercise, which is what the corpus has.
- Translating parts through the translation form (`TranslateForm` edits title/statement/answer;
  parts would need rows of their own in it).
