# flashcards — decks, cards, a per-person review schedule, and where a deck is placed

The thirty-fifth app (learning cycle step A, `prompts/02-flashcards.md`, `prompts/00-DESIGN.md` §2).
Five models, one pure algorithm, one rule module, and two hooks another step registers.

A **deck** is somebody's own pile of **cards**. A card is the front/back of an exercise, a concept
or free text. A **review state** is one person's SM-2 schedule for one card, a **review log** the
append-only record of every grade pressed, and a **placement** is "this deck is on that course or
that event" — which is also how a deck is shared in this cycle.

## The four decisions everything else follows from

**1. Placement is the sharing mechanism; `is_public` is the later one.** `00-DESIGN.md` §4.1 said
decks are private only. Read literally that would have made step C's "make a deck from this lesson"
and step E's "take this home" produce decks nobody but their maker could open, so the integrator
decided on 2026-10-05 (`prompts/README.md` §9) that **a deck placed on a node is studyable by
everybody who can view that node**. `is_public` — world-readable — exists, defaults off, and a
minor may not turn it on (`rules.public_block_reason` → `minor`). A public deck *library* is the
next step, not this one.

**2. `can_study` is wider than `can_edit`, and the gap is load-bearing.** The owner edits; everyone
who can view a node the deck sits on may study it. A participant who tries to rename the deck their
lecturer placed gets **404**, not 403 — for them an editable deck does not exist (house rule 4).
The honest answer to "can I change this" is `POST /api/decks/{id}/copy/`: a private copy they own.
A placement is a course's decision to *point at* somebody's deck, never a transfer of it.

**3. A deck is a membership SNAPSHOT, never a live link.** `courses.LessonExerciseSet` already
documents this shape at length and the reasoning carries over unchanged: the list of cards is copied
once, each card's exercise or concept is a live FK (so a corrected statement reaches the deck), and
a later edit to the source set does not rewrite somebody's deck. `Deck.source_set` is `SET_NULL`
for the same reason that model's is — a deleted set must leave the deck standing.

**4. The schedule is the first *measurement* this site holds about a learner** (`00-DESIGN.md` §1
rule 3). So `ReviewState` is unique per `(user, card)` and no endpoint anywhere answers with
somebody else's row; `ReviewLog` is read back only in aggregate, per `taxonomy.Branch`, through
`record.py`, behind step B's `share_activity` consent.

## Shapes

- **`Card` is exercise XOR concept XOR free text**, one `CheckConstraint`
  (`card_exactly_one_face`) written as three explicit branches — the
  `courses.CourseItem.course_item_exactly_one_target` idiom, for the reason that constraint states:
  it is what somebody adding a fourth kind will read. DRF derives validators from
  `unique_together` but **not** from `Meta.constraints` (`backend/CLAUDE.md`), so
  `CardDraftSerializer.validate` refuses the same thing at **400** — without it a malformed request
  becomes an `IntegrityError` 500.
- **An exercise card does not store or inline its statement.** The review screen loads a deck's
  exercises in one request through `GET /api/exercises/bulk/?ids=`, which already asks
  `exercises/entries.py: visible_entries` for the hint and solution pool. A second resolve here
  would be the two-surfaces-disagree failure the rule-module boundary exists to prevent, and a
  50-card response would carry fifty statements for a screen that shows one.
- **A concept card's faces are resolved, not stored**: `concepts/resolve.py: resolve_page` answers
  which revision this reader gets (audience ladder, locale pools, `all` as an exact answer), and its
  title and summary are the two faces. Short enough to inline, unlike a statement.
- **`DeckPlacement` is a `GenericForeignKey` through `config/nodes.py`**, never an FK to `Course` or
  `Event` and never a sixth `CourseItem` kind (no migration outside this app —
  `prompts/README.md` §5 rule 1). Its kind allowlist, `PLACEABLE_NODE_KINDS = ('course', 'event')`,
  is deliberately **shorter** than `config.nodes.NODE_KINDS`: the registries on this site are
  different lengths on purpose, and a deck on a material or an organisation answers no question
  anybody asked.
- **Two placement serializers**, and that is not duplication: `DeckPlacementSerializer` embeds the
  **node** (read from inside a deck — "where is my deck?"), `NodeDeckPlacementSerializer` embeds the
  **deck** (read from a course page — "what is on this page?"). One carrying both would be a cycle.
- **Counts are recounted on every read** (house rule 5). `due_count` could not be stored on the row
  even if somebody wanted it: it is per reader, and thirty people studying one placed deck have
  thirty different answers. `due_count` is **due plus new**, because both are ready now; the split
  is in the review endpoint's `counts`.

## `scheduling.py` — one pure function

`review(state, grade, now) -> state`. Plain dicts in and out, no queries, no models, no clock of its
own. That shape is the point: it is tested as a **table of grade sequences against expected
intervals** (`SchedulingTests.TABLE`), which is the only honest way to test an algorithm.

Four grades (1 again, 2 hard, 3 good, 4 easy) mapped onto SM-2, with two deliberate departures from
the paper, both in the module docstring: **a lapse is due again immediately** (interval 0,
`due_at = now`), because a person pressing "again" means "show me again", not "tomorrow"; and the
**ease factor is clamped to [1.3, 3.0]**, because a run of "easy" on an unclamped ease schedules a
card years out, which is a deletion with extra steps. "Due" is read on the **server's day** — there
is no per-account timezone on this site (root `CLAUDE.md`, known gaps).

`rules.apply_grade` is the only writer: one `update_or_create` and one insert inside a short
`atomic()`, and **no `select_for_update`** (`backend/CLAUDE.md` rule 1 — SQLite has no row locking).
There is nothing to lock against anyway: the row is unique per person per card, so its only writer
is that person.

## Rules live in `rules.py`, and the endpoints ask

`can_study`, `can_edit`, `visible_decks`, `own_decks`, `my_study_decks`, `visible_cards`,
`review_queue`, `due_count`, `apply_grade`, `copy_for`, `place`, `place_block_reason`,
`public_block_reason`, `node_placements`, `can_remove_placement`.

Every refusal is a word (house rule 6): `not_owner`, `kind`, `cannot_manage`, `already_placed`
(`place_block_reason`); `minor` (`public_block_reason`). All five have a sentence in
`frontend/src/lib/utils/labels.ts`.

**409 vs 403 vs 400** (root `CLAUDE.md`): `already_placed` is the world having moved → **409**;
`not_owner` / `kind` / `cannot_manage` are about who is asking → **403**; a malformed body, a card
with none or two faces, a grade outside 1–4 → **400**.

**`visible_cards` skips an exercise that is no longer visible to readers**, and keeps showing it to
the deck's OWNER — `courses.LessonExerciseSet.visible_exercises`'s rule, for its reason: a curator
who cannot see the gap cannot fill it. The card row is never deleted for this; it comes back when
the exercise is restored.

**`my_study_decks` is narrower than `visible_decks`** on purpose. The due list is work waiting for
*me*: my own decks, decks placed where I study, and any deck I have already graded a card in. A
world-readable deck somebody has never opened owes them nothing.

## API

```
GET    /api/decks/                        the caller's own decks (?placed_on=<kind>:<id> → decks placed there)
POST   /api/decks/                        {name, audience?, exercise_ids?, source?, placement?} → Deck + `skipped`, 201
GET|PATCH|PUT|DELETE /api/decks/{id}/     retrieve: can_study else 404; writes: can_edit else 404
GET|POST /api/decks/{id}/cards/           POST {exercise?|concept?|front?, back?, include_*} → Card, 201
PATCH|PUT|DELETE /api/cards/{id}/         can_edit through the deck, else 404
GET    /api/decks/{id}/review/            {cards: [...], counts: {due, new, learned, total}}
POST   /api/cards/{id}/grade/  {grade}    → the new ReviewState; 404 unless can_study; 400 unless 1..4
POST   /api/decks/{id}/copy/              a private copy of a deck the caller can study → Deck, 201
GET    /api/flashcards/due/               {decks: [{id, name, due}], total}
GET    /api/nodes/{kind}/{pk}/decks/      placements on a node, each {id, deck, order, added_by}; 404 unless can_view_node
POST   /api/decks/{id}/placements/        {kind, id} → placement, 201; refusal word from place_block_reason
DELETE /api/deck-placements/{id}/         the placer, the deck's owner or the node's manager; else 404
```

All behind `feature_gate('flashcards')`, **reads included**. The node-nested route and
`/api/flashcards/due/` are this app's own paths in `flashcards/urls.py` — nothing in `courses` or
`events` moves.

`POST /api/decks/` is **the one call steps C, D and E make**
(`frontend/src/lib/services/flashcards.ts: createDeckFromExercises`, whose signature the prep commit
fixed before this app existed). Four guarantees to them: one card per id **in the order the ids
arrived**; ids the caller may not see are **skipped, not refused**, with the count in `skipped`;
**a refused placement does not lose the deck** — it is created first and returned in the 403 body;
and **a name past `NAME_MAX_LENGTH` is cut to fit, not refused**. That last one was a 400 until
2026-10-07 (`HISTORY.md` §17BU.D): none of the three buttons asks anybody for a name, each builds
one from a lesson, session or concept title whose own `max_length` is 200, so a long heading gave
a person "The deck could not be made" about a name they never typed. `DeckSerializer` (the edit
path) had truncated all along; the two halves of one endpoint now agree. Both inputs where a name
IS typed are `maxlength="120"` in the browser, so this only ever fires on a generated name.

## `record.py` and `work.py` — the two hooks

Neither is imported anywhere on this branch, and neither imports `identity/` or `work/`
(`prompts/README.md` §5 rule 13). The integrator registers them:

- `identity.record.register_activity_provider(flashcards.record.activity_by_branch)` —
  `{branch_id: {'cards_reviewed': n}}`, exercise cards only (`Exercise.branch` is the only route
  from a card to a Branch).
- `register('cards_due', 'flashcards', flashcards.work.work_items)` — one row per deck with cards
  ready, carrying the **count**, never a row per card. `urgency` is 1 or 2 and never 3: cards being
  due is not a deadline anybody can miss.

## Verify

`../.venv/bin/python3 manage.py test flashcards config --keepdb`. Frontend:
`lib/types/flashcards.ts`, `lib/services/flashcards.ts`, `/flashcards`, `/flashcards/[id]`,
`/flashcards/[id]/review`, `DeckPlacementsPanel` at the two `learning: deck placements (A)` markers.
Browser: `frontend/e2e/flashcards.mjs`.

## Left open

- **No shared or public deck library.** `is_public` exists and works; nothing lists public decks,
  and there is no per-Branch browse. That is the next step (`00-DESIGN.md` §5).
- **SM-2, not FSRS.** The scheduler is one pure function with one call site, so swapping it is a
  one-file change plus a migration for whatever extra state FSRS wants.
- **No notification for cards due.** A three-file change — `notifications/services.py`'s
  `_PREFERENCE_FIELD_FOR_TYPE`, the `NOTIFICATION_TYPES` it derives, and
  `frontend/src/lib/utils/labels.ts` — which eight parallel branches would have collided on
  (`prompts/README.md` §5 rule 12).
- **No offline grading.** Every grade is a round trip; the ticket scanner's batch-sync shape would
  fit a queued one.
- **A concept card is never frozen.** It keeps the live reference, so it follows the concept's
  current revision; a "frozen at this revision" card is not offered (`00-DESIGN.md` §5).
- **Concept and free-text cards contribute nothing to the learning record.** `Concept.branches` is a
  many-to-many, so one review would have to be counted once per branch or split between them, and
  neither is a number anybody asked for.
- **No per-account timezone**, so "due" is the server's day for everybody (a site-wide gap).
- **Cards cannot be reordered through the UI.** `PATCH /api/cards/{id}/ {order}` exists and works;
  the deck page has no drag handle.
