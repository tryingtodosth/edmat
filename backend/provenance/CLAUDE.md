# provenance/ — where a piece of content came from

The **"AI-assisted" mark**: the author's own disclosure, one confidence vote per reader per piece of
content, and a moderator's lock on what the community reading says. Built 2026-10-08 against the
owner's own task on the EdMat organisation (`work/edmat_project.py: TASKS[0]`, written 2026-10-07,
which had stood as *"to do; nothing exists in the code yet"*).

## Why it is its own app

`moderation/` is reports and queues — a complaint about content. The author's mark is a **fact about
the work**, and it has to survive every opinion anybody else forms about it. Putting the two in one
app would have made the author's answer one more row in a queue, which is exactly the conflation the
three tables below exist to prevent.

## The three tables, and why not one

| Table | Who is speaking | Lifetime |
|---|---|---|
| `AuthorMark` | the author, about their own work | one per target; nothing anybody else does overwrites it |
| `AssistanceVote` | one reader's reading, 0–100% | one per (target, person), changeable |
| `ScoreLock` | a moderator ending the argument | one per target, with a required reason |

Conflating them is how a badge starts lying about **who** claimed what — and "the author told us"
and "readers suspect" are claims with very different standing.

## What the owner decided, and what is still open

Settled, and implemented here:

- **A vote is a confidence, not a yes/no** (owner, 2026-10-08: *"mark as AI-assisted and how % sure
  are you about that"*). So `confidence` is 0–100 and carries the whole opinion. Zero means "I am
  not at all convinced", which is a vote against on the same scale rather than a second field.
- **One chip, two marks** (owner, 2026-10-07): a three-people icon for the community and a
  single-person icon for the author, each lighting on its own. `rules.summaries_for` returns exactly
  that shape, which is why it is two booleans and a number rather than one tri-state. `AiAssistChip`
  draws **only once one of them is lit** (or a moderator has fixed the reading): a chip reading
  "80%" off one vote looks like a figure the community arrived at, which is exactly what
  `MIN_VOTES_FOR_COMMUNITY_MARK` exists to prevent. The percentage on that chip is therefore never
  unattributed.
- **The author's mark is final; votes can only add the badge, never remove it.** An author who has
  owned up reads 100 whatever the votes say. An author's *denial* does NOT pull the community
  reading down — it is recorded, it is shown, and a reader weighs the two.
- **The five surfaces** — the exercise statement, every hint, every solution, every comment, every
  review. `targets.PROVENANCE_KIND_MODELS` has four entries for them, because a hint and a solution
  are one model (`SolutionEntry`) differing by its own `kind`.
- **A sixth: `concept_article`** (2026-10-21, for `manage.py import_concepts
  --ai-assisted`, whose pages are written with AI help). The ARTICLE, not a revision — one author
  (`created_by`), the licensing unit, and what a reader sees one head of at a time. Its visibility is
  not the generic shape, so `rules.is_readable` asks `concepts.access.can_view_article` by name (an
  article whose only revision waits does not exist for a stranger, mark or no mark). `branch_of`
  answers None for it — a concept has several branches — so only staff may lock its reading. No
  migration (the kind never reaches the database). `declare_ai_assisted --kinds concept_article`
  works through the same dict. The concept page draws the chip in the article's byline line and
  replaced its bare report button with `ContentActionsMenu` (mark, report, moderator's remove).

Still open, and deliberately parked as named constants in `rules.py` rather than inlined:

- `MIN_VOTES_FOR_COMMUNITY_MARK` (3) and `COMMUNITY_MARK_THRESHOLD` (50). The owner's task lists
  "the vote weight and threshold" as undecided and the organisation's own poll is where it gets
  decided. The 3 is the same safety rail, for the same reason, as
  `moderation/services.py: MIN_REPORTS_FOR_AUTO_HIDE`: a mean over one vote is one person's opinion
  wearing the word "community".

## Traps

1. **The registry is deliberately shorter than `REPORT_KIND_MODELS`.** Everything here is a
   judgement about who wrote a piece of prose, so only things somebody wrote are in it. Do not
   "complete" it against the report registry — a tag and a venue have no prose.
2. **`ReviewList.svelte` renders three different review models** (`community.Review`,
   `materials.MaterialReview`, `services.ServiceReview`) and its `kind` prop defaults to `review`,
   so a MATERIAL review already falls through to that default. The frontend therefore gates the chip
   on a separate explicit `assistKind` prop; deriving it from `kind` would write a mark against
   whichever `community.Review` happens to share the pk. Both files say so.
3. **One batched read, not a field on four serializers.** `AssistanceSummaryView` answers for every
   chip a page has just drawn, in four queries per kind. A `SerializerMethodField` on `Exercise`,
   `SolutionEntry`, `Comment` and `Review` would have been an aggregate over a `GenericForeignKey`
   per row — the N+1 this shape exists to avoid — and would have put this app's import into three
   others.
4. **`rules.is_readable` is asked before anything is said about a target**, and a target the reader
   may not see is *omitted* from the batch rather than refused (house rule 4: for them it does not
   exist). Staff see everything, the same bypass `feature_gate` makes.
5. **A minor's mark counts; a minor's free text does not.** `AuthorMark.note` is dropped for an
   `is_minor` account rather than held, because `accounts.minors.hold_for_review` needs an
   `auto_hidden_at` this model does not have, and hiding a disclosure would hide a fact a reader
   wants. It is the same trade the owner's spec already makes for votes ("a vote carries no free
   text").
6. **The author may not vote on their own work** (`rules.can_vote`). Not tidiness: they already have
   a channel that says exactly what they mean, and letting them also move the community's number
   would let one person speak twice in two voices. A test got this wrong once and quietly counted 2.

## An AI-assisted solution is not a verified one (2026-10-21)

Owner, about the 64 exercises imported as `todoonet`: *"mark it as ai assisted … and remove the
verified solution"*. Two things, one rule:

- **`exercises/signals.py: recount_verified` excludes a solution carrying an `AuthorMark`
  with `assisted=True` unless `reviewed_by` is set.** A pin and the author's verified-contributor
  tier both say "a person stands behind this"; an author disclosing AI assistance says exactly
  that they do not fully. A reviewer's accept restores it. `signals.py` here recounts on every
  mark save/delete whose target is a `SolutionEntry`, so the badge follows the mark.
- **`manage.py declare_ai_assisted --author <username> [--note …] [--by <staff>] [--kinds …]
  [--dry-run]`** makes the author's mark on everything that account wrote — exercises and
  hints/solutions by default, comments and reviews on request — through the same table the page's
  control writes, `declared_by` the author unless `--by` names a staff member. Idempotent;
  reports marked / re-marked / already marked per kind.

## Left open, not built

- **No list filter.** The owner's task asks for "hide above X" / "only above X" on the lists with an
  `X-EdMat-Hidden-Languages`-shaped hidden count. Not built, deliberately: the threshold it would
  filter on is the number the organisation's poll has not decided, and a filter with a guessed
  threshold is worse than none. The endpoint already answers `score`, so the filter is a queryset
  change plus a header when the number exists.
- **Only `community.Comment` travels to the other pages, and that is on purpose.** All eight routes
  that render a thread now call `provideAiAssistance()`, so a comment can be marked wherever it is
  written; the MATERIAL, the concept article or the issue those comments hang under is still not a
  target, so only the comment carries the mark there. `ContentActionsMenu` hides the item where no
  holder was provided rather than opening a dialog nothing would answer, which is what makes adding
  a route one line.
- **No author mark in the composers.** The task asks for the choice to appear in `/submit`,
  `/submit-material` and the editors at write time. Today the author marks the content **after** it
  exists, from its own menu, which reaches every one of the five surfaces with one component instead
  of five forms. The write-time checkbox is the better moment to ask and is a separate change.
- **`material` and `post` are not targets yet.** They have prose and belong here; they are not on
  the surfaces the owner named on 2026-10-08, and each needs its own author field and `is_readable`
  branch. (`concept_article` is a target since 2026-10-21, chip and menu item included.)
- **Nothing notifies the author when a community mark lights on their work.** Wanted; a new
  notification type is its own change.
