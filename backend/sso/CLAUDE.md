# sso — Sign in with Google / Apple / GitHub / Facebook (and Microsoft, built but not requested)

Built 2026-10-14. The owner asked for Google, Apple, GitHub and Facebook; Microsoft is in the code,
unconfigured and therefore invisible. Two protocols behind one flow: **OIDC** (Google, Apple,
Microsoft) — authorization-code flow, server side, PKCE (S256) where supported, `state` and `nonce`;
the id_token's signature is verified against the provider's JWKS and `iss`, `aud`,
`exp`, `iat` and `nonce` are checked before a single claim is read (`tokens.py`). **No provider
credentials exist yet**: a provider is enabled iff `EDMAT_SSO_<PROVIDER>_*` is configured AND the
`social_login` FeatureFlag is on, so until the owner fills the environment every visitor sees
exactly what they saw before — no button, no draft. Operator runbook: `deploy/SSO-SETUP.md`.

## Files

`providers.py` (the registry — protocol, endpoints, scopes, PKCE, form_post, issuer check, "is this
email verified", where a name comes from, `request_token` / `fetch_identity` for OAuth 2.0; one
entry + env vars per provider) · `tokens.py` (id_token
verification, JWKS cache with one refetch on an unknown `kid`) · `http.py` (the only two outbound
calls, stdlib `urllib`; the ONLY thing tests mock) · `services.py` (the whole flow; nothing else
creates an identity, a code or a ticket) · `views.py` · `models.py` · `management/commands/sso_purge.py`.

## OAuth 2.0 without an id_token: GitHub and Facebook

Same flow, same `state`, same single-use codes and tickets, same browser key, same never-link-by-
email; only the middle differs. `services._exchange_code` asks `provider.request_token()` for an
access token and `provider.fetch_identity()` for claims in the id_token's shape — `iss` is the
provider's own fixed issuer, so the identity key is `(github, https://github.com, <numeric id>)`
and `(facebook, https://www.facebook.com, <app-scoped id>)`. The access token is used for those
calls over TLS and dropped; nothing of it is stored.

- **GitHub** (OAuth App): PKCE S256 (supported since 2025-07-14). `/user` gives the numeric id (a
  login can be renamed, the id cannot) and the name; the address is the **primary address GitHub
  marks verified** from `/user/emails` — `/user`'s own `email` field is never read. No such address
  → `email_missing` for a new signup (an already-linked identity still signs in). A refused code
  comes back HTTP 200 with `error`, which `GitHubProvider.request_token` turns into a refusal. The
  API wants a `User-Agent` (`http.USER_AGENT`).
- **Facebook** (Facebook Login for the web, Graph API pinned at `v25.0`, override with
  `EDMAT_SSO_FACEBOOK_GRAPH_VERSION`): no PKCE relied on (confidential client, `state` binds the round
  trip); the code exchange is Facebook's documented GET; `/me?fields=id,name,email` carries an
  `appsecret_proof`. Facebook never says whether the address is verified, so it is **always
  unverified** here: the account is made and the ordinary confirmation mail goes out. The id is
  app-scoped (a different number in every app).

## The flow

```
POST /api/auth/sso/<p>/start/ {intent: login|link, next}  → {authorization_url, browser_key}
   … the provider …
GET  /api/auth/sso/<p>/callback/   (POST for Apple: response_mode=form_post)   → 302 to the SPA:
   known (provider, issuer, sub)          → /auth/sso/done?code=…        (2 min, single use)
   intent=link                            → /auth/sso/done?code=…        (attached on redemption)
   unknown, an account has that email     → /auth/sso/link?ticket=…      (prove it — see below)
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
4. **Never silently link by email** — not even a verified one. An unknown identity whose email an
   account already uses gets **confirm-and-link** (below): the match only PROPOSES; the person proves
   the account. A Settings `link` is attached only on redemption by the SAME signed-in account that
   pressed Link (`wrong_account` otherwise).
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

## Confirm-and-link (owner's "A", 2026-10-14; `LINKING-AND-ERRORS.md` §2.4)

The callback finds exactly one account with the provider's address → an `SsoLinkTicket` (target
account fixed, provider identity, 30 min, single use, browser-key bound, stored hashed) →
`/auth/sso/link?ticket=…`. Two proofs, each offered only when it can work:

- **(a) the account's password** — `POST /api/auth/sso/link/password/`, throttled like /login
  (`LoginRateThrottle`, per IP) and five wrong passwords kill the ticket (`too_many_attempts`).
  Not offered to an account with no usable password.
- **(b) a link to the account's address** — `POST /api/auth/sso/link/email/` (throttle
  `mail_resend`), **only when that address is confirmed** (`mail.ConfirmedEmail`): an unconfirmed
  address was never proven by anybody (pre-hijack attack 1). The mail (`OutboundEmail.KIND_SSO_LINK`)
  is logged with `[[link]]`; `mail.build_link` asks `mail_link_token(user)` at send time for a token
  SIGNED with the server key over `{ticket pk, nonce}` — a fresh nonce per press, so only the newest
  link works. Redeemed at `POST …/link/email/confirm/ {token, browser_key}` and **only in the browser
  that started** (`link_other_browser`): otherwise somebody signing in with a provider identity that
  carries YOUR address could get you to click the confirmation and own a way into your account. The
  SPA copies the round trip's key to localStorage when the mail is requested, because a mail client
  opens a new tab (new sessionStorage); it is removed once used.

Neither proof → the old `email_in_use` (the done page points at "Forgotten your password?"). Two
accounts sharing the address (legacy) → `email_in_use`, no proposal. A child's or any
guardian-managed account (`guardian_managed`: `is_minor` or an unrevoked `Guardianship` as child) →
`minor`, checked at the callback AND again at the proof. Inactive → `account_inactive`. **A provider
that did not verify the address may still link with a proof** — the proof is about the EdMat
account; the provider's say-so adds nothing to it. Success: `SsoIdentity` created (keyed as always on
provider + issuer + subject), audit row, the same `{token, profile, next}` as login in the POST body,
and **rule 5: every link — here or from Settings — mails the account** (`KIND_SSO_LINKED`, only to a
confirmed address) naming the provider and how to disconnect. What the page reveals: which proofs
exist (whether the account has a password, whether its address is confirmed) — the price of offering
them; never the username or display name.

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
- **Retention**: attempts 10 min, codes 2 min, signup and link tickets 30 min; `purge()` deletes rows an hour past
  expiry, run on every `start` and by `manage.py sso_purge` (put it in cron beside `mail_cron`).
  A ticket holds an email and a name for somebody who may never finish — that is why it is short.
- **Throttles**: `sso_start` 30/h, `sso_callback` 60/h, `sso_exchange` 60/h (exchange + ticket),
  complete uses `register` (10/h) — it is the same act.

## Settings → Password (`accounts/password.py`)

`GET/POST /api/auth/me/password/`: an account with no usable password (signs in only through a
provider) SETS one without a current password; an account with one must give it to change it
(`current_password_required` / `current_password_wrong`; Django's validators under
`new_password`). Throttle `password_change` 10/h; audited as `password_change`. The token is kept.
This is what lets an SSO-only person unlink their last provider; the reset mail remains the other way.

## The development stub — guarded twice

`EDMAT_SSO_DEV_STUB_URL` points every provider's endpoints and issuer at `frontend/e2e/sso-stub.mjs`
(it signs a token for anybody). `config/settings.py` **refuses to start** with it set and DEBUG off,
and `providers.dev_stub_url()` returns '' unless `settings.DEBUG` at every call.
`DevStubGuardTests` pins both (the settings refusal in a subprocess).

## Left open

- Apple server-to-server notifications (`email-disabled`, `consent-revoked`, `account-delete`) and
  token revocation on account deletion — there is no self-service account deletion yet either.
- Facebook's deauthorize / data-deletion **callbacks** are not built; the app uses the data-deletion
  *instructions URL* (`/settings/account`, the GDPR work) instead.
- No re-acceptance prompt when the terms change (`legal/terms.py` says so).
- Throttle counters are per-process without Redis (as everywhere).
- No avatar is fetched from a provider (data minimisation; ask first if ever wanted).

## Verify

`manage.py test sso` (the count is in `test.md`: state/expiry/reuse, nonce, aud, iss, exp, iat age, alg none, HS256
confusion, foreign key, key rotation, email collision, link/unlink rules, flag off, unconfigured,
Microsoft tenants and verified-email rules, Apple form_post + ES256 secret, GitHub (primary-verified address
only, HTTP-200 errors, numeric ids, PKCE) and Facebook (GET exchange, appsecret_proof, always
unverified, version guard), the stub guard, purge, SSO-only password reset) ·
`accounts/test_password.py` · `e2e/sso.mjs` against `e2e/sso-stub.mjs` (`test.md`).
