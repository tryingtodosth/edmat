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

## Verify

`manage.py test accounts` + `test_avatar.py`, `test_throttling.py`, `test_profile_extras.py`.
Password reset is an honest always-200 stub (console EMAIL_BACKEND, no real mail anywhere).
