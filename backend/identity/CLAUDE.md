# identity — sign-in provider drafts and the USOS ground

Models: `School` (23 seeded institutions: `email_domains`, grade scale, `usos_base_url` — a
**blank URL is a statement** "this school runs no USOS", not missing data), `GradeScale`,
`Verification`, `StudentStatus`, `EducationProfile`, `Diploma`, `CourseGrade`. Files:
`providers.py`, `usos.py`, `standing.py`, `services.py`.

## The drafts are honest — keep them that way

- **No mock handshake exists anywhere**; a test pins that no provider endpoint can authenticate
  anybody. The four providers (School/SAML, Google/OIDC, Apple, GitHub) carry REAL endpoints,
  scopes, and each one's integration-breaking quirk (Apple form_posts and sends the name exactly
  once; GitHub needs `/user/emails` and only verified entries; Google's id_token wants
  verification, not a userinfo call; School is SAML, not OAuth).
- `blockers_for()` computes draft-vs-live from `settings.EDMAT_OAUTH_CLIENTS` — configuring a
  real client id/secret is what stops the UI calling a provider a draft. **No hardcoded copy to
  edit**; a test pins that the state is computed, not asserted.

## USOS (`usos.py`)

- What blocks a real connection is not code: credentials are issued **per institution, by that
  institution, after a human approves** — `UsosCredentials` is keyed by school slug, capabilities
  probed per installation. It's OAuth **1.0a** (three legs, HMAC-SHA1 — OAuth 2 libraries don't
  apply); scopes are granular and requested up front (`studies` does not include `grades`).
- `active_connector()` is THE one seam a real client replaces. Default
  `UnconfiguredUsosConnector` verifies nobody; `MockUsosConnector` (behind `EDMAT_USOS_MOCK`,
  never default-on) exists so tests exercise the same interface — it respects granted scopes and
  capabilities, and there is **no `if mock` branch in any UI**.
- **Deliberately no access-token column** — a long-lived token to someone's academic record does
  not belong in an unencrypted SQLite file. Don't add one.
- Grades need their **own, separate, user-initiated authorization** (LAUNCHCHECKLIST §3a: never
  requested by default); an import without the scope is refused naming the scope.

## Standing (`standing.py`)

Implements exactly ONE term of the LAUNCHCHECKLIST §3 formula — the verification **ceiling** on
capability, never authority (mod level is never granted by identity). Fully itemised (`reasons`
IS the computation, rendered line by line). Unearnable by typing: a self-declared school is one
step; an institutional email counts for NOTHING (no confirmation flow exists). Capability never
depends on publishing. `EducationSharing` = three consent flags all starting False — importing
publishes nothing; gating lives server-side in `standing.public_view`. `weighted_average` is
ECTS-weighted and **refuses to mix grade scales** (returns None) rather than inventing a
mapping. Changing declared school drops claims it backed; disconnecting USOS falls back to
school-email verification (never USOS's to grant). `CourseGrade.matched_course` matching is
conservative — unmatched results are kept but never placed.

## Verify

`manage.py test identity`. E2E: `education-auth.mjs` (reads `E2E_API`; historically hardcoded a
port — keep it env-driven).
