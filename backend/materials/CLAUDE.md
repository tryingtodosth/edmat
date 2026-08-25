# materials — files, coverage claims, weighted votes, requirements

`Material` (+ `MaterialTranslation`), `MaterialType` (+ translation — the type list is **data**,
not a hardcoded enum), `MaterialReview`, `MaterialRequirement` (+ vote), `MaterialView`,
`MaterialCoverage` (+ vote). `Material` carries `author` + `source_url` (provenance — genuinely
distinct: who wrote it vs. where it came from; both optional, never fabricated), optional
`price_amount`/`price_currency` (curated 4-value choices `PLN/EUR/USD/GBP`, display-only — no
payment processing exists anywhere) and `estimated_minutes`.

## Claims: one row answers one question (`MaterialCoverage.kind`)

- `kind='covers'` — how thoroughly the material treats a topic; `kind='requires'` — how much of
  it a reader should already know first. They used to be ONE row read both ways (the popover
  showed the same number under both labels — a real reported bug). Unique per
  `(material, kind, topic, subtopic)`, so both kinds may coexist on one topic. Browse filters
  (`topic_id`/`min_level`), `sort=level`, `_best_coverage_level` and the recommender's overlap
  term read **`covers` only**.
- Any authenticated user may propose either kind (`POST /materials/{id}/coverage/`, body
  `kind` defaults to `covers`); the community corrects it. Not moderation-gated.
- **Two votes per claim, different questions**: `MaterialCoverageVote` (agree/disagree — is the
  level right, `vote_summary`) and `MaterialCoverageImportanceVote` (+1/-1 — show it higher/lower,
  `importance_summary`, `POST|DELETE /material-coverage/{id}/importance/`). The frontend lists
  claims by importance net weight, then accuracy net weight (`lib/utils/coverage.ts sortClaims`).
  Both weigh `is_verified_contributor` **double**; both prefetch via
  `coverage__(importance_)votes__voter__profile` everywhere materials are listed.
- Claim threads are the generic `community.Comment`; comments carry up/down votes (see
  community/CLAUDE.md).
- **`ClaimBase` (abstract) + `claims.py`** are what `courses.CourseClaim` builds on — the same
  fields, the same `resolve_claim_input` / `vote_response` / `thread_response`. Change claim
  semantics there, not in one owner's viewset.

## Legacy free-text requirements (`MaterialRequirement`)

Still in the schema and API (governor `PUT /materials/{id}/requirements/`, `propose_requirement`,
per-row votes, reportable), but the UI no longer offers new ones — a requirement is a `requires`
claim now. The detail page renders legacy rows only when a material still has some (none did at
the time of the switch). Governor-only edit, full ordered replace inside a small
`transaction.atomic()` (two fast statements, one table — the safe shape; see backend/CLAUDE.md
SQLite rules). Case-insensitive duplicate labels are **rejected** (400 naming the duplicate) —
shared guard in `services.py` (`clean_requirement_labels` / `find_duplicate_requirement_label`),
used by BOTH write paths (governor PUT and submission-time validate).

## Upload safety (`validators.py`, `materialfile.py`)

Sniff real content via libmagic against a per-extension whitelist — never filename/browser
Content-Type (`.docx` legitimately sniffs as zip, `.doc` as OLE2; a PE renamed `.pdf` is
rejected). 25MB cap. Stored name = random UUID hex + validated extension. `scan_for_malware`
returns a `ScanOutcome` dataclass, never a bare bool — `scanned=False` is the honest dev outcome
(no ClamAV daemon here); `MATERIAL_SCAN_REQUIRED=True` makes "couldn't scan" a hard reject on a
real deployment. Scan status is surfaced to the reviewing moderator, not hidden.

## Notes

- `MaterialViewSet` is read-only for ordinary CRUD — creation happens ONLY via
  `moderation.MaterialSubmission` approval (or the corpus importer). Tags attach only via the
  tag-apply endpoint, requirements via the governor PUT.
- Coverage-claim comments: validate a submitted `parent` belongs to the SAME coverage row's
  thread (checked in the view — content_type/object_id aren't client data at serializer time).
  The identical check exists in `ExerciseViewSet.comments`; keep them in step.
- Material has **no** top-level comment thread and no star-rating tied to `community.Review`
  (that model is Exercise-only) — `MaterialReview` is its own thing.

## Verify

`manage.py test materials` (+ submission/approval paths in `moderation`). E2E:
`material-claims.mjs`, `material-claims-rework.mjs` (kind split, importance vote, comment votes),
`material-types.mjs`.
