# accounts — identity, profile, avatars, throttles

`Profile` (display name, avatar, `preferred_locale`, `is_verified_contributor`,
`show_profile_publicly`, `notify_on_*` coarse categories + `muted_notification_types` list,
`time_format`/`week_starts_on`, tutoring opt-in), `DonationLink`, and profile extras
(`profile_extras.py`): `ExperienceEntry` (self-declared, labelled as such), `SkillEntry`,
`Certificate`.

## Invariants

- **Role/trust fields are never self-service**: `is_staff`, `is_verified_contributor`, and
  `SkillEntry.evidence='registry'` (the serializer downgrades it — a value anybody can type is
  worth what typing costs). `ProfileUpdateSerializer` scopes what PATCH /auth/me/ can touch;
  `avatar` is deliberately absent from it (own endpoint).
- **`PublicProfileSerializer` is its own serializer, not an exclude-list** — a stranger's
  notification/display prefs must never appear in its `Meta.fields` at all.
  `show_profile_publicly=False` withholds join date/role badges but NEVER basic attribution
  (display_name/avatar back every byline in the app) and never donation links (adding one is
  itself the opt-in).
- Login accepts an **email**, resolved server-side to the username before `authenticate()`.
- User ids in every API response are **User** pks, never Profile pks (they only aligned by
  accident of insertion order — a real bug once).

## Avatars (`avatar.py` + shared `backend/imaging.py`)

Uploaded bytes are **never stored**. Order matters: 5MB byte cap → libmagic sniff (kept only for
a better error message) → **declared-dimensions pixel cap BEFORE any decode** (a 140KB PNG
declaring 12000×12000 is a real decompression bomb that passes a byte cap) → decode,
EXIF-transpose (honor orientation, THEN strip — phones store sideways), centre-crop square,
512×512 WebP, alpha preserved (dark theme). Re-encoding defeats polyglots; EXIF strip removes
GPS. Endpoint `POST/DELETE /api/auth/me/avatar/` translates Django `ValidationError` into a DRF
400 explicitly (uncaught it's a 500) and deletes the previous file (FileField doesn't).
`accounts/migrations/0006` imports `validate_avatar_file` by path — don't move/rename it.

## The age gate, and what its kill switch may not touch

`RegisterSerializer.birth_year` is asked to BRANCH and never stored — under 16 the answer is "ask a
guardian", and the year goes no further. The `age_verification` FeatureFlag turns that question off;
`validate_birth_year` reads it with a plain `is_feature_enabled()`, deliberately not `feature_gate`
(registration is anonymous — a permission gate would 403 the people it serves; see
`moderation/CLAUDE.md`).

**Off means the site stops asking, never that it stops protecting.** `minors.py` still governs every
`is_minor` account and Settings → Children still works. That separation is safe only because
self-registration never sets `is_minor` at all — `create()` pops the year, and `ChildrenView.post` is
the one code path that marks an account a minor's. If that ever stops being true, this flag becomes a
GDPR Article 8 decision and needs re-thinking, not a wider `if`.
`RegistrationAgeGateFlagTests` (`test_minors.py`) pins the scope; `e2e/age-gate-flag.mjs` drives it.

## Throttles (`throttles.py`)

Login is throttled **twice** — per-IP AND per-submitted-identifier (normalized, SHA-256'd so the
cache holds digests). Neither subsumes the other; the per-identifier rate is deliberately looser
(it's itself a DoS lever). Scoped rates on register/password-reset/avatar/geocode. DRF counts
requests, not failures — no real lockout exists. Counters live in Django's cache: per-process
unless Redis is configured. **Testing trap**: `SimpleRateThrottle` binds `THROTTLE_RATES` at
import time — `override_settings` doesn't reach it; use `patch.dict` on the shared dict and
clear the cache between tests. **E2e trap**: register ≈10/hour/IP — a long e2e session exhausts
it and later scripts fail looking like regressions; restart the backend (kill by the PID holding
the port, NOT `pkill -f`, which kills its own shell match).

## Deleting an account and downloading its data (`erasure.py`, `export.py`, `erasure_views.py`, 2026-10-14)

- **`erasure.REGISTRY` is the rule**: one `Rule(model, field, action, group)` per foreign key to a
  person (and per FK to `Profile`). Actions: `delete` (private), `anonymise` (a public contribution —
  stays under the tombstone), `keep` (a record others rely on), `end` (live with somebody else —
  cancelled/left, they are told). `split` partitions one model's rows by action; `handlers` override
  what an action does; `scrub` blanks personal columns on rows that stay. **Adding a model with an FK
  to the user fails `test_erasure.RegistryCompletenessTests` until you add a rule** — it caught
  `licensing.LicenceChange` the day it was written. The export (`export.py`) reads the same registry.
- **The `User` row is never deleted — it is scrubbed into a tombstone** (`deleted-<pk>`, blank email
  and names, unusable password, inactive, profile fields reset, `display_name = DELETED_LABEL`).
  A hard delete cascades through other people's conversations/threads/tasks and `Contest.organiser`
  is PROTECT. `frontend/src/lib/api/client.ts` swaps `[deleted account]` for the reader's language
  in every JSON response; a living account may not take that display name, nor a `deleted-` username.
- **Lifecycle** `AccountErasure.status`: `pending` → `cancelled` | `erasing` → `done`; the row is
  kept. Asking deactivates at once (tokens, sessions); `erase_due_accounts` erases after 14 days;
  claim and cancel are each one WHERE-anchored update, so a cancel cannot land mid-erasure. `erase()`
  is idempotent and NOT one atomic block (SQLite rule 2) — a run that died is finished by the next.
- **Who may ask**: self with password + typed username (`self_refusal`: `guardian_managed` for a
  minor, `password_required` for an SSO-only account); a guardian via `ChildDetailView.delete`
  (same module, same grace; PATCH `is_active: true` cancels). `blockers()` refuses (409, listed)
  while the person runs a live course / upcoming event / running contest / organisation or material
  project with others and no other owner. Erasing a guardian erases sole-guardian children.
- **The one question asked** (owner, 2026-10-14): published content under `edmat-only` or `unknown`
  is kept under the tombstone or removed (hidden: `published=False` / `is_removed`), per
  `AccountErasure.withdrawable_content`; no default when there is any (`choice_required`). CC content
  always stays (irrevocable); co-authored items (`licensing.targets` contributors) and translations
  stay either way. A guardian's delete answers `remove`. `WITHDRAW_TARGETS` in `erasure.py`.
- **During the grace period** login answers 403 `erasure_pending` (right password only) and
  `/api/auth/erasure/cancel/` takes it back (password, or the mailed signed token); the public
  profile is WITHHELD, not 404 — every byline resolves it.
- `retention.py` + `enforce_data_retention`: view history and mail 12 months, anon IP hash 30 days.
  Both commands run from `deploy/cron/edmat-retention`.

## Verify

`manage.py test accounts` (incl. `test_erasure.py`, 51 tests) + `test_avatar.py`, `test_throttling.py`, `test_profile_extras.py`.
Password reset is real since 2026-10-14: `PasswordResetView` hands the address to
`mail/services.py: request_password_reset` (always 202, enumeration-safe) and `RegisterView` queues the
confirmation message. The rules and the link handling live in `mail/`, not here.
