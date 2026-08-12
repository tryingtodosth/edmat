# materials — files, coverage claims, weighted votes, requirements

`Material` (+ `MaterialTranslation`), `MaterialType` (+ translation — the type list is **data**,
not a hardcoded enum), `MaterialReview`, `MaterialRequirement` (+ vote), `MaterialView`,
`MaterialCoverage` (+ vote). `Material` carries `author` + `source_url` (provenance — genuinely
distinct: who wrote it vs. where it came from; both optional, never fabricated), optional
`price_amount`/`price_currency` (curated 4-value choices `PLN/EUR/USD/GBP`, display-only — no
payment processing exists anywhere) and `estimated_minutes`.

## The trust split (deliberate, don't flatten it)

- **Coverage claims**: any authenticated user may claim "covers topic X at level Y"; community
  votes correct it, `is_verified_contributor` votes count **double**. Not moderation-gated —
  additive, reversible, low-stakes metadata.
- **Requirements**: governor-only to edit (`PUT /materials/{id}/requirements/`, staff or
  `moderation.services.is_governor_of_course` — pre-rename name, takes a Branch) — they read as
  structural claims about the material. Full ordered
  replace inside a small `transaction.atomic()` (two fast statements, one table — the safe shape;
  see backend/CLAUDE.md SQLite rules). Case-insensitive duplicate labels are **rejected** (400
  naming the duplicate), never silently deduped — shared guard in `services.py`
  (`clean_requirement_labels` / `find_duplicate_requirement_label`), used by BOTH write paths
  (governor PUT and submission-time validate).

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
`material-claims.mjs`, `material-types.mjs`.
