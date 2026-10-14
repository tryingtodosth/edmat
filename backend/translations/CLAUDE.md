# translations/ — the management layer's text, in every language somebody has written it in

A task, a plan, a plan step, a need, a poll, a poll option and an organisation's description, each
stored once per language, resolved for the reader and with a reading that says whether a newer
version is waiting in another language. Built 2026-10-08 on the owner's instruction:

> *"all of the tasks and other project management stuff should be bilingual: User sees the version
> in their UI language by default, if there's a newer version in a different language it says how
> much newer. mods/admins can edit and submit edit/new stuff also using translate interface you need
> to make now: side by side original and the translation (up and bottom for mobiles), so that if a
> user translates and edit/update/new content, there's no sth like 'newer in PL by 4 minutes'"*

## What was wrong before

Each of those models had ONE `title` and ONE `description`, so being bilingual was something you did
by hand, in the field. `work/edmat_project.py: _pl_en()` is what that looked like: it glued the
Polish and the English together with a `/` and a `---` rule, and every reader of `/about` got both
languages at once whichever one they had chosen. That is the **content** axis of the root
CLAUDE.md's i18n rule ("two separate axes, deliberately") being done by hand in a single column.

## The plain edit form, and the bug it had until 2026-10-10

`resolve` reads a `TextVersion` whenever the row has one and consults the row's own column **only
when it has none at all**. That fallback is what made this app additive — and it is also why every
management write serializer was quietly broken: each wrote `title`/`description` straight onto the
column, so on any row somebody had translated (which is every row on `/about`, because the seed
splits its bilingual text into versions) an edit **returned 200 with the new text in it and changed
nothing a reader would ever see**.

Two pieces fix it, and a new write path needs the second:

- **`services.write_original_text(obj, heading=, body=, user=)`** — one language's edit, routed
  through `write_versions`. `False` means "this row has no versions, your column write is the whole
  truth" and is not a failure; `None` for a half means "leave it alone", read back from the VERSION
  and not from the column, which is the thing that may have drifted.
- **`serializers.PlainTextWriteMixin`** — the other half of `TranslatedTextMixin`. That one makes
  the READ answer in the reader's language; this one makes the WRITE land where that read looks.
  Add it to any write serializer of a registered kind. It is on `TaskWriteSerializer`,
  `NeedSerializer`, `PlanStepUpdateSerializer`, `GoalSerializer`, `GoalCriterionSerializer`,
  `PollUpdateSerializer`, `OrganizationWriteSerializer` and `ContestSerializer`;
  `PlanViewSet.partial_update` writes its three fields by hand and so asks the service by hand.

**Only the original language is touched**, and the others keep their own `updated_at` — so a reader
of a translation is told the original is newer, which is true. `PUT /api/text-versions/<kind>/<pk>/`
is still how somebody writes every language at once, and that is still the better moment.

**The trap: drop `_prefetched_objects_cache['text_versions']` after the write.** Every management
view prefetches that relation so `resolve` answers in memory for a board of fifty rows, and the
cache predates the write — so the response renders the OLD text from a save that worked. Found in a
browser (the page showed the previous title until a reload), not by any test; DRF's own
`UpdateModelMixin` drops the same cache for the same reason. `PlainEditTests` pins both halves.

## Why this is NOT `ExerciseTranslation`'s shape

`ExerciseTranslation` is a per-model table with a `status`, because a stranger's translation of a
corpus exercise is a **submission a moderator decides on**. Management text is not: the people
writing it are the people who already run the thing, and `tasks.rules.can_edit` (and its siblings)
is already the right answer to "may you write this". So there is no review queue here, no `status`,
and one table serves seven models through a `GenericForeignKey` plus a registry, rather than seven
near-identical tables in five apps.

## The six decisions worth knowing

1. **The model's own column survives, holding the original.** `Task.title` is not dropped and not
   emptied; `services.write_versions` mirrors the original language back onto it on every write. That
   is what keeps every existing reader of it correct and untouched — the work dashboard, notification
   bodies, the activity feed, an export, a `__str__`, Django admin. A target with **no rows here
   behaves exactly as it did before this app existed**, which is why nothing had to be migrated and
   nothing had to guess what language a task written in 2026-09 was in.
2. **`updated_at` is not `auto_now`.** `write_versions` stamps every language it writes with ONE
   timestamp, so two languages written together are exactly equal and `resolve` has nothing to
   report. Under `auto_now` the rows would save microseconds apart and the page would say "newer by
   0 minutes" about content that had just been written in one go — the exact thing the owner asked
   to be rid of.
3. **One endpoint, and it writes every language at once.** `PUT /api/text-versions/<kind>/<pk>/`.
   There is deliberately no per-language write: an editor that saved one language at a time would
   *manufacture* the staleness it exists to avoid.
4. **No read endpoint.** Every version a client needs arrives embedded in the row it belongs to
   (`language` and `text_versions` on each serializer), through a queryset that has already applied
   that row's own visibility. A standalone read would have needed its own copy of five different
   visibility answers; `authority.py`'s tail says so from its side.
5. **`keep_edited=True` means a person's words win permanently.** `write_versions` takes it, only
   `seed_edmat_project` passes it, and it skips every language whose row has a `written_by` — a
   human's — leaving `updated_at` alone and mirroring the row's own column from the PERSON's row
   rather than from the caller's payload. Without it, "re-run the seed after every bundle" (which
   the deployment runbook has to say, because the seed is what splits the glued text) would have
   meant "throw away the owner's production edits after every bundle". The owner caught that before
   it shipped. It is per LANGUAGE, not per row: rewrite the Polish of a task and the seed keeps your
   Polish and goes on maintaining the English. The only way back to the seeded wording is to delete
   the rows.
6. **No kill switch of its own.** A flag guards a feature *surface*; this is a property of five
   surfaces that each already have one. With `tasks` off, a task's text cannot be reached to be
   translated because the task cannot be reached.

## Traps

1. **`heading`/`body` are named for their shape, not for any model's field.** The seven targets call
   them four different things, and two are mirror images: a **poll option** has a heading and no
   body; an **organisation** has a body and no heading (its `name` is a registered name, the same in
   every language). `targets.py` is the only place that mapping exists, and `services.write_versions`
   branches on it for the "say something in the language you wrote it in" rule — a heading-less kind
   is judged on its body (`original_body_empty`, not `original_heading_empty`).
2. **The partial unique index is immediate, not deferred.** `one_original_text_version` means a
   previous original in a different language has to stop being one **before** the new one is written.
   An earlier draft of `write_versions` did that cleanup afterwards and failed inside its own
   transaction; there is a test named for it.
3. **A heading is NOT sanitized; a body is.** `bleach` entity-escapes rather than strips, so
   `i18n & content` became `i18n &amp; content` — which a reader sees literally, and which broke the
   EdMat seed's by-title lookup so that a second run duplicated every plan step with an `&` in its
   heading (ten of them, found by running the seed twice). A heading is plain text everywhere it is
   read and mirrors onto `Task.title` and friends, none of which has ever been sanitized in this
   codebase; `MathTitle` sanitizes titles on read. The body really is HTML and keeps house rule 8.
4. **The seed does not own a field the editor exposes.** `seed_edmat_project`'s own
   `Organization.objects.update_or_create(defaults={**ORGANIZATION})` used to refresh `description`
   behind `keep_edited`'s back — the `TextVersion` rows survived a seed run and the column did not.
   `description` is out of those defaults now. Anything else the editor ever exposes has to come out
   of a seed default too.
5. **The mirror copies the SAVED row, not the incoming payload.** `TextVersion.save()` runs the
   BODY through `config.sanitize` (house rule 8; the heading is plain text — trap 3). Copying the
   payload onto the model's column instead would leave that column holding the one unsanitized copy
   on the platform — and on `Task`, which sanitizes in its *serializer* rather than in `save()`,
   that is a real gap.
6. **`tasks/views.py` passes `user` in the serializer context and did not pass `request`.** That is
   deliberate there (its serializer's docstring explains why), but `TranslatedTextMixin` reads
   `?lang=` off the request — so without it the locale fell back to `pl` and an English reader
   silently got the Polish. Fixed by adding `request` alongside `user` at all eight call sites; a
   test in this app is what caught it.
7. **Every management read has to send `?lang=`.** The four services do
   (`services/tasks.ts`, `plans.ts`, `needs.ts`, `polls.ts`, `organizations.ts`), because
   `config.i18n_utils.request_locale`'s documented backstop is `pl`. A new management read that
   forgets it works, and quietly answers in Polish.
8. **`ReviewList`-style sharing does not apply here, but `services/polls.ts` has no mapper.** It is
   the one management service that returns the API's own snake_case, so `types/poll.ts` carries
   `RawLanguageReading`/`RawTextVersion` and `PollsPanel` converts at the point of use.
9. **The seed splits, it does not store split.** `work/edmat_project.py` still writes
   `_pl_en(...)` and `'PL / EN'` — a good way to keep a bilingual source readable in one file — and
   splits it on the way in. `_find_by_title` therefore has to recognise BOTH the glued title an
   earlier run left and the Polish one this run writes, or a second run duplicates every row. There
   is a test for that too, and one asserting that every title in the file still splits into at most
   two halves.

## Left open, not built

- **Plan steps and poll options have no editor of their own yet.** Both are in the registry and both
  write correctly through the endpoint; what is missing is a `⋯` on each step row and each option
  row. The plan detail page (`/plans/[id]`) and the poll create form are where they go.
- **A third language needs nothing here.** `locale` is a free string, as the root CLAUDE.md records
  for content locales; `TranslateFields` offers whatever Paraglide's `locales` holds. So a third
  interface language brings its own management translations with it.
- **Nothing tells anybody that a translation has gone stale.** The reading says so to whoever opens
  the page; there is no notification, and a new notification type is its own change.
- **`volunteering_offers`, `events` and `courses` are not in the registry** and have the same
  single-field problem. They are not "project management stuff" in the sense the owner named, and
  each needs its own authority branch.

## Two more kinds: `goal` and `goal_criterion` (2026-10-08, `HISTORY.md` §17BZ)

`goal` is the ordinary (`title`, `description`) shape; `goal_criterion` is the `poll_option` shape
again — one text field (`text`) and no second one. Both answer to `goals.rules.can_edit` in
`authority.py`: the node's manager or the goal's own author. **Not `can_tick`**, which is wider on
purpose (node staff may record that a condition is met) and has nothing to do with rewriting what it
says — translating is editing.

`frontend/src/lib/types/translation.ts: TranslatableKind` is the other half, as always.

