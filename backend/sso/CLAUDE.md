# sso — Sign in with Google / Apple / Microsoft

Built 2026-10-14. OpenID Connect authorization-code flow, server side, with PKCE (S256), `state`
and `nonce`; the id_token's signature is verified against the provider's JWKS and `iss`, `aud`,
`exp`, `iat` and `nonce` are checked before a single claim is read (`tokens.py`). **No provider
credentials exist yet**: a provider is enabled iff `EDMAT_SSO_<PROVIDER>_*` is configured AND the
`social_login` FeatureFlag is on, so until the owner fills the environment every visitor sees
exactly what they saw before — no button, no draft. Operator runbook: `deploy/SSO-SETUP.md`.

## Files

`providers.py` (the registry — endpoints, scopes, PKCE, form_post, issuer check, "is this email
verified", where a name comes from; one entry + env vars per provider) · `tokens.py` (id_token
verification, JWKS cache with one refetch on an unknown `kid`) · `http.py` (the only two outbound
calls, stdlib `urllib`; the ONLY thing tests mock) · `services.py` (the whole flow; nothing else
creates an identity, a code or a ticket) · `views.py` · `models.py` · `management/commands/sso_purge.py`.

## The flow

```
POST /api/auth/sso/<p>/start/ {intent: login|link, next}  → {authorization_url, browser_key}
   … the provider …
GET  /api/auth/sso/<p>/callback/   (POST for Apple: response_mode=form_post)   → 302 to the SPA:
   known (provider, issuer, sub)          → /auth/sso/done?code=…        (2 min, single use)
   intent=link                            → /auth/sso/done?code=…        (attached on redemption)
   unknown, an account has that email     → /auth/sso/done?error=email_in_use
   unknown, new email                     → /auth/sso/complete?ticket=…  (30 min, single use)
   anything wrong                         → /auth/sso/done?error=<word>&provider=<p>
POST /api/auth/sso/exchange/ {code, browser_key}           → {kind:'login', token, profile, next}
                                                             | {kind:'link', identity, next}
POST /api/auth/sso/ticket/   {ticket, browser_key}         → what /auth/sso/complete pre-fills
POST /api/auth/sso/complete/ {ticket, browser_key, username, display_name, birth_year,
                              accept_terms, preferred_locale}  → 201 {token, profile, next}
GET  /api/auth/sso/providers/                              → the buttons (empty when off)
GET  /api/auth/sso/identities/ · DELETE …/identities/<id>/ → Settings → Sign-in methods
```

## The security properties, and where each lives

1. **Never a token in a URL.** The callback hands the SPA a two-minute single-use code or a
   thirty-minute ticket; the DRF token comes back only in a POST body, exactly like LoginView's.
2. **The browser key is the login-CSRF defence.** `start` returns a random key the tab keeps in
   sessionStorage; the attempt stores its SHA-256; the code/ticket inherit it and are redeemable
   only with it. A callback URL forwarded to somebody else (sign the victim into the attacker's
   account; attach the victim's Google account to the attacker's EdMat account) dies in a tab
   that lacks the key. A cookie would not work here: the SPA and API are separate origins in
   development and Apple's callback is a cross-site POST, which a SameSite=Lax cookie never sees.
3. **The identity key is `(provider, issuer, subject)`, never the email** (`ANALYTICS-LAW.md` §7.2).
   For Microsoft multi-tenant, `iss` names the person's tenant and `sub` is pairwise per app, so
   the pair is the documented stable key; `tid` and `oid` are stored too. Google's two issuer
   spellings are normalised to one (`GoogleProvider.identity_key`).
4. **Never auto-link by email** — not even a verified one. An unknown identity whose email an
   account already uses is refused with `email_in_use`: sign in with the password, then link from
   Settings, which proves holding both. A `link` is attached only on redemption by the SAME
   signed-in account that pressed Link (`wrong_account` otherwise).
5. **Single use is one WHERE-anchored `update()`** — status + expiry (+ browser key) in the WHERE —
   for attempts, codes and tickets (`backend/CLAUDE.md`, SQLite rule 1). A wrong-method callback
   (GET for Apple) is refused WITHOUT consuming the attempt.
6. **The algorithm comes from the registry, never from the token** (`alg: none` and the
   HS256-with-the-public-key confusion are both refused before a key is touched).
7. **Bearer secrets are stored hashed** (code, ticket, browser key). `state` is stored as sent.
8. **No provider access or refresh token is stored.** The token response is read once for its
   id_token and dropped.
9. **The age gate runs for provider sign-ups** — `accounts/minors.py: self_registration_refusal`,
   the same function `RegisterSerializer` asks; while `age_verification` is on the year is REQUIRED
   here (a signup that skipped it would be a way round it), and it is never stored. A child account
   (`is_minor`) cannot start a link (403 `minor`), and has no email to sign up with.
10. **Terms**: `accept_terms` must be `true` (`terms_required`, the word /register uses), and
    `legal.terms.record_acceptance(user, via='sso:<provider>')` writes the row.

## Email: verified or not

- Google: `email_verified`. Apple: `email_verified` (the string "true"), and the address may be a
  `@privaterelay.appleid.com` relay — mail to it bounces unless edmat.net is registered with Apple's
  Private Email Relay (`deploy/SSO-SETUP.md`). Microsoft: the `email` claim is NOT trusted as
  verified (nOAuth) — only `xms_edov` true or a match in `verified_primary_email`, both optional
  claims the app registration must switch on.
- **A verified address** is marked confirmed (`mail.ConfirmedEmail`, the same row a confirmation
  link writes). **An unverified one** is accepted — the same trust as a password registration — and
  the ordinary confirmation mail is queued. No address at all → `email_missing`.

## Decisions worth knowing

- **Apple: no PKCE** (`pkce=False`): Apple does not document `code_challenge`; it is a confidential
  client and `state` + `nonce` still bind the round trip. **Apple's client secret is generated per
  token request** (ES256, `exp` = 5 min), so there is nothing to rotate except the `.p8` key itself.
- **The kill switch** is read with plain `is_feature_enabled()` (anonymous endpoints, like
  `age_verification`). Off: providers `[]`, start/exchange/ticket/complete 404, a callback in flight
  → `flag_off`. Listing and unlinking stay open. An SSO-only person cannot sign in while it is off —
  "Forgotten your password?" is their way back, which is why `mail/services.py:
  request_password_reset` now mails accounts with an unusable password **when they have an
  `SsoIdentity`** (and still skips every other unusable-password account).
- **Unlink** is refused (`409 set_password_first`) when it would leave no usable password and no
  other identity. The identity row is deleted (it is a credential, not a decision); the fact is an
  `AuditEvent` with `action='password_change'`, `target_type='sso_identity'` — the nearest existing
  action (a credential change); adding `sso_link`/`sso_unlink` choices means a telemetry migration.
  A link writes the same audit row.
- **The `identity/` draft cards step aside** for any provider enabled here
  (`identity/providers.py: all_states`), so /login never shows a working Google button and a draft
  one side by side.
- **Retention**: attempts 10 min, codes 2 min, tickets 30 min; `purge()` deletes rows an hour past
  expiry, run on every `start` and by `manage.py sso_purge` (put it in cron beside `mail_cron`).
  A ticket holds an email and a name for somebody who may never finish — that is why it is short.
- **Throttles**: `sso_start` 30/h, `sso_callback` 60/h, `sso_exchange` 60/h (exchange + ticket),
  complete uses `register` (10/h) — it is the same act.

## The development stub — guarded twice

`EDMAT_SSO_DEV_STUB_URL` points every provider's endpoints and issuer at `frontend/e2e/sso-stub.mjs`
(it signs a token for anybody). `config/settings.py` **refuses to start** with it set and DEBUG off,
and `providers.dev_stub_url()` returns '' unless `settings.DEBUG` at every call.
`DevStubGuardTests` pins both (the settings refusal in a subprocess).

## Left open

- Apple server-to-server notifications (`email-disabled`, `consent-revoked`, `account-delete`) and
  token revocation on account deletion — there is no self-service account deletion yet either.
- No "set a password" form in Settings for an SSO-only account: the reset mail is the way.
- No re-acceptance prompt when the terms change (`legal/terms.py` says so).
- GitHub / Facebook: not OIDC (no id_token) — each needs a `fetch_identity` hook beside the
  id_token path; the registry is ready for the entry, the flow is not.
- Throttle counters are per-process without Redis (as everywhere).
- No avatar is fetched from a provider (data minimisation; ask first if ever wanted).

## Verify

`manage.py test sso` (94 tests: state/expiry/reuse, nonce, aud, iss, exp, iat age, alg none, HS256
confusion, foreign key, key rotation, email collision, link/unlink rules, flag off, unconfigured,
Microsoft tenants and verified-email rules, Apple form_post + ES256 secret, the stub guard, purge,
SSO-only password reset) · `e2e/sso.mjs` against `e2e/sso-stub.mjs` (`test.md`).
