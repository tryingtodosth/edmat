# concepts — wiki pages for what exercises and materials are *about*

`Concept` (a slug, some branches, some tags — no text of its own) → `ConceptArticle` (one written
take, for one `(audience, locale)`; several people may write their own for the same pair) →
`ConceptRevision` (immutable, numbered, one `published` head per article). Plus `ConceptAsset` (a
picture or PDF placed as a block) and `ConceptLink` (to an exercise, a material or another concept).
Rules live in `access.py` and `resolve.py`, writes and side effects in `services.py`, what a block
may be in `blocks.py`, views are thin. `CONCEPTS-BRIEF.md` is the spec this was built from; where the
two disagree, the code wins. `coauthoring/` is the app this one is modelled on — where both describe
the same machine (numbered immutable versions, head vs published, 409 on a stale save, one `decide/`
endpoint), the shapes are deliberately identical.

## Invariants

- **A concept has no title.** The title of "quantum mechanics" for a nine-year-old and for a
  third-year physicist are different sentences; a column on `Concept` would have forced one of them
  to be the real one. Every title, summary and body lives on a revision, and a list row's title comes
  from the page `resolve.resolve_page` picked for that reader — never "the first article".
- **Articles for one `(audience, locale)` are a POOL of peers**, the `SolutionEntry` shape, not one
  page two people take turns overwriting. Order is pinned-first (staff/governor) then newest head;
  `?article=` picks another, and doing so moves the page with it rather than showing the switcher one
  page and the body another.
- **A detail never narrows; a list does.** `resolve_page` always answers while any article is
  published, and carries `audience_exact` / `locale_exact` so the page can say in words which article
  this is. The list applies the content-language rule and reports `X-EdMat-Hidden-Languages`. The
  locale filter is written out in `views.list` rather than through
  `config.content_locale.apply_content_locale_filter`, because the locale is on the article and the
  status is on its revision — one hop further than that helper can express.
- **Publishing supersedes FIRST, then claims.** `one_published_revision_per_article` is a real
  partial index; the other order is a deterministic 500 (`moderation/views.py _publish_translation`
  records the same bug in the same shape). If anything after the claim fails, both writes are
  reverted. No `select_for_update()` anywhere — every state change is ONE WHERE-anchored `update()`.
- **`publish_revision` accepts a `draft` or a `pending` row**, because "this text should be the page
  now" is one act whether its author earned it or a reviewer granted it. One function owns the
  sequence so the two paths cannot drift.
- **Stale is checked at SUBMIT, not at save.** A draft written against an older head is fine to keep
  writing; offering it as the next version is 409 `{'detail':'stale','head':{…}}` carrying the real
  head. `decide` deliberately has no stale refusal — the reviewer saw the diff against the head in
  the queue row (`based_on_is_current` is what that row carries).
- **Three circles, and they are not the same.** Writing: anybody signed in. Publishing without
  waiting: staff, a verified contributor, or a governor of any of the concept's branches — and
  **never a minor**, checked first. Reviewing: staff, a governor, **or the article's own author**
  (`exercises.entries.can_decide_entry_suggestion`'s precedent). A concept attached to NO branch is
  reviewed by staff and the author alone, and reaches only staff in the queue — the honest answer,
  since there is no governor who could claim it.
- **Decisions go through `POST /api/concept-revisions/{id}/decide/` — never a new `_KIND_MODELS`
  kind** (the solution-entry and material-version precedent, `moderation/CLAUDE.md`).
- **Body links are derived, manual links are filed.** `harvest_body_links` recomputes `origin='body'`
  rows from the `[[slug]]` mentions in the head of every visible article on every publish — a
  recount, never an increment (house rule 5) — and never touches a `manual` row. Removing a body
  link by hand is refused with `body_origin`: the sentence is what says it.
- **A concept is not a governable node.** Scope flows from `Concept.branches`; there is no
  `GOVERNABLE_NODE_MODELS` entry and no `NodeGovernor` target here.
- **The prerequisite closure is a pure walk, and visibility is asked afterwards.** `paths.py`
  (§17BR.D) walks `ConceptLink(relation='prerequisite')` breadth-first to depth ≤ 4 and ≤ 20
  concepts, cutting cycles by never revisiting and by starting with the seeds already "seen". It
  takes no user: the walk is one fact about the graph, and *who may see each rung* is
  `access.visible_concepts`, applied by `views._closure_payload` over the result. The cost of that
  split is stated rather than hidden — an invisible concept can be a HOP while being dropped from
  the answer, so two readers of one page are told the same distances. Order is `(distance, slug)`,
  because a concept has no title to sort by; the title is resolved per reader afterwards and the
  order is NOT recomputed from it.
- **Sanitize in `save()`, validate in the serializer.** `ConceptRevision.save()` runs
  `blocks.sanitize_blocks` (no queries, never raises) and derives `search_text` from the result;
  `blocks.clean_blocks` does the full validation — unknown kind, lengths, referenced rows, asset kind
  — and the serializer turns its Django `ValidationError` into a 400 with a `blocks` key.
- **`expand_blocks` is two queries for any number of blocks**, and a test pins the count. Resolving
  per block is the N+1 this app's busiest endpoint would otherwise ship with.
- **Never the bytes that were uploaded.** `ConceptAsset` goes through
  `community.attachments.process_attachment` — reused, not copied — and counts against the shared
  allowance via that module's `used_upload_bytes`. There is no DELETE: a block inside a published
  revision must keep resolving (the `InlineImage` / `ChemDrawing` reasoning).
- **The kill switch removes the surface, and the chip row survives it.** `concepts` gates every
  endpoint (staff bypass), except `GET /api/concept-links/?target_type=…` **and
  `GET /api/concept-links/learn-first/`**, which answer `[]` — both are read by an exercise's and a
  material's own page, and house rule 3 requires those to keep working while returning nothing. The
  two must keep the SAME posture: they sit two lines apart on one page, and one refusing while the
  other answers is how a reader gets half a row. `/api/concepts/{slug}/{prerequisites,exercises}/`
  are NOT in the carve-out — they are read by the concept's own page, which the switch takes away
  whole, so there is nothing left to keep working.
- **The feed gets `concept` for the FIRST publication anywhere under a concept and
  `concept_revision` for every later one**, never for a draft and never for a queued revision.
  `ConceptArticle` and `ConceptRevision` are registered for `post_delete` in this app's own
  `signals.py` rather than in `activity/signals.py`'s list — that file's convention would need
  `activity` to import `concepts`, which imports `moderation`, which imports `activity`.

## Traps

- `ActivityEvent.concept` is **SET_NULL** while every other link FK in that block is CASCADE. A
  concept is never hard-deleted in normal operation, so CASCADE would only cover the case this app
  does not have; the field's own comment there says so.
- DRF derives uniqueness validators from `unique_together` but **not** from `Meta.constraints`, and
  every constraint here is a `constraints` entry. Nothing relies on DRF to refuse a duplicate.
- `access.governed_branch_ids_for` returns **None for staff** and a real, possibly EMPTY set for a
  governor. Never collapse the two.
- The slug is allocated once and is immutable through the API. Renaming and merging are left open
  (CONCEPTS-BRIEF.md §9).
- **`serializers._resolved_head` is the one way to name a concept**, and `_target_title` went
  through a whole release naming a concept TARGET by "the first published revision" instead. It
  showed on one screen in §17BR.D: a prerequisite chip said "Pochodna — po ludzku" two lines above a
  prerequisite path saying "Derivative". Anything that renders a concept's name asks that function.
- `notify_tag_followers` is deliberately NOT widened to concepts — it builds its row with
  `exercise=`/`material=`, and a notification a reader cannot click is worse than none.
- Tests declare `databases = set(all_log_shards()) | {'default'}`: every publish and decision writes
  an `AuditEvent` to its own SQLite file.

## Verify

`manage.py test concepts`, plus `manage.py test moderation` (the queue section, the report kind) and
`manage.py test community exercises notifications activity` (the cross-cutting rows).
`manage.py seed_concepts` twice — it is idempotent by slug and seeds every block kind.
E2E: `frontend/e2e/concepts.mjs`, and `frontend/e2e/concept-paths.mjs` for the closure, the
"before this, know…" row and the deck button.

**A worktree needs its LOG SHARDS migrated too**, not just `default`: a copied `db.sqlite3` leaves
`logdata/logs_*.sqlite3` empty, and every write that records an `AuditEvent` — adding a link,
removing one — then answers **500 after creating the row**. The symptom is maximally misleading: the
data is right and the UI shows an error. `for a in logs_0 … logs_anon; do manage.py migrate
--database=$a; done`.

## Licence (2026-10-14, `licensing/CLAUDE.md`)

This app's content carries a per-item `licence` (`licensing/licences.py`, default `edmat-only`, the
corpus `unknown`). It is set at creation and changed ONLY through `licensing.rules.change_licence`
(`/api/licences/<kind>/<id>/`) — only ever widened, recorded, read-only in the admin. Which rows here
carry their own and which contribute under their parent's is the table in `licensing/CLAUDE.md`.
