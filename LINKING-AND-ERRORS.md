# Account linking and browser error reporting — research brief

Researched 2026-10-14 for the owner's question: *"let's research what's the correct way to do it
(meaning industry standard)"*, asked about two things:

- **A.** Should "Sign in with Google/Apple/GitHub/Facebook/Microsoft" automatically attach itself to
  an existing EdMat account when the provider reports the same, verified e-mail address?
- **B.** How should the site learn about JavaScript errors that happen in visitors' browsers, which
  today it does not see at all?

> **None of this has been reviewed by a lawyer, or by the University's data protection officer
> (IOD UW).** This is research for engineering. It builds on `ANALYTICS-LAW.md` (§2.1 PKE art. 399,
> §2.2 EDPB 2/2023, §3 row 8, §7) and `LEGAL.md` §1 (controller = the student group, basis
> art. 6(1)(f)), and does not repeat what they establish. Nothing here may be quoted to a user or to
> the Faculty as advice.

Markers, as in `ANALYTICS-LAW.md`:
**[VERIFIED]** — the page was opened and the statement comes from it. Pages were read through a
summarising fetcher, so a quotation is as returned, not guaranteed character for character.
**[SECONDARY]** — a reputable restatement (a vendor blog, a law-firm note, another body's practice).
**[UNVERIFIED]** — a search snippet, memory, or a page that could not be opened. Check first.
**[DISPUTED]** — the law or the practice is genuinely split.

Pages that could not be opened this time: Apple's Sign in with Apple documentation (404), Microsoft
Learn's page on migrating off the `email` claim (redirected to a hub page), the MSRC nOAuth post of
June 2023, cnil.fr (503), and the UK statute text of PECR Schedule A1.

---

## 1. Short answers

1. **Account linking: keep "never link silently", but stop dead-ending the person.** The guidance
   documents agree: OWASP, NIST SP 800-63C-4 and OpenID Connect Core say the key is
   `(issuer, subject)`, never link because e-mails match, and link only from an authenticated
   session. Auth0's guidance and Keycloak's default flow say the same. Silent auto-link of a
   verified e-mail does happen, but only in consumer auth SaaS (Firebase, Supabase, Clerk), and each
   of them adds compensating machinery that EdMat does not have. The standard way to cut friction
   is a **confirmation step inside the sign-in flow**, as in Keycloak's *first broker login*. "This
   address already has an EdMat account. Prove it is yours: enter its password, or click the link
   we just mailed to it. We then connect Google to it." That replaces today's `email_in_use`
   refusal, which sends the person to Settings. **Child accounts: never.** §2.4 has the exact rules.
2. **Error reporting: build a small first-party beacon.** No third-party SaaS. A
   `window.onerror` / `unhandledrejection` handler (in SvelteKit, `handleError` in
   `hooks.client.ts`) POSTs a fixed set of fields to EdMat's own `/api/client-errors/`. The server
   groups reports by a fingerprint of the stack and keeps them 30 days. It sends no cookie, no
   identifier, no breadcrumbs and no replay, and the privacy policy discloses it. This matches what
   EU universities that disclose error tracking do: they self-host (Bielefeld runs Sentry on its own
   servers) and rely on art. 6(1)(f) with no consent banner. Hosted Sentry, Bugsnag and Rollbar all
   **collect the IP by default** and send data to a US company. Self-hosted Sentry needs 16 GB of
   RAM. GlitchTip (256–512 MB) is the upgrade path if the home-grown table ever stops being enough.
3. **Consent for the beacon: not needed on the mainstream reading, but not settled.** It is
   "gaining access" under ePrivacy art. 5(3) and PKE art. 399 (EDPB 2/2023 paras 33, 52–53). The
   exemption, *konieczne do dostarczania usługi … żądanej*, plausibly covers reporting the
   service's own crash, provided nothing is sent beyond what fixing it needs. No EU authority has
   said so in terms. The UK statute, as amended in 2025, now names "preventing or detecting
   technical faults" as strictly necessary, which is persuasive but not binding here. This stays
   `ANALYTICS-LAW.md` §3 row 8, **class B**. Recommendation: do not send when the browser signals
   GPC/DNT.

---

## 2. Account linking

### 2.1 What the field does

| Source | Default | Conditions for linking an existing account | Safeguards / warnings |
|---|---|---|---|
| **OWASP** Authentication Cheat Sheet | No auto-link | "Do not automatically link accounts solely because their `email`, `preferred_username`, or other profile attributes match." "Require an authenticated session with the existing application account before adding or removing linked identities." Identify by "`iss` … and `sub` … not `sub` alone." [VERIFIED] <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html> | The OAuth2 cheat sheet is silent on linking [VERIFIED] <https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html> |
| **NIST SP 800-63C-4** | Linking only in-session | "A single RP subscriber account MAY be associated with more than one federated identifier"; "the RP SHALL require an authenticated session with the subscriber account for all linking functions." A federated identifier is the subject *plus* the issuer, and "SHALL be associated with a single subscriber at the RP". After unlinking, the RP "SHALL disallow access … from the removed federated identifier". [VERIFIED] <https://pages.nist.gov/800-63-4/sp800-63c.html> | Account resolution at first sign-in is allowed only if the attributes are "sufficient to uniquely resolve the subscriber". Whether 63C-4 treats an e-mail as sufficient was **not read** [UNVERIFIED]. |
| **OpenID Connect Core 1.0** §5.7, §2 | — | `iss` + `sub` is "the only guaranteed unique identifier"; e-mail, phone and username "MUST NOT be used as unique identifiers". `email_verified` true means the OP "took affirmative steps to ensure that this e-mail address was controlled by the End-User" — **at the time it was verified**, not now. [VERIFIED] <https://openid.net/specs/openid-connect-core-1_0.html> | `email_verified` is a historical statement, not a continuing one. |
| **Google** (Sign in with Google) | Key on `sub` | `sub` is "unique among all Google Accounts and never reused"; "a Google Account can have multiple email addresses at different points in time". `email_verified` may be true because Google verified the address when the account was created. No `hd` claim means not a Workspace account. [VERIFIED] <https://developers.google.com/identity/gsi/web/guides/verify-google-id-token>. "Email is not a good choice because it can be changed by the user"; an `@gmail.com` address is a Gmail account; "the domain of the email claim is insufficient" to show organisational management, so use `hd`. [VERIFIED] <https://developers.google.com/identity/sign-in/web/backend-auth> | Google is authoritative for `@gmail.com`. For any other domain, a Google account can be made with that address without owning the domain's mailbox (Truffle Security below). Cross-Account Protection (RISC) pushes hijack/revocation events [VERIFIED] <https://developers.google.com/identity/protocols/risc>. Optional. |
| **Apple** | Key on `sub` | The address is real or a `@privaterelay.appleid.com` relay; `is_private_email` says which (string or boolean, sometimes absent). Apple returns only verified addresses, and the e-mail and name only on first authorisation. [UNVERIFIED — Apple's page 404'd; developer forum <https://developer.apple.com/forums/thread/808653>] | A relay address never matches an existing EdMat account, so e-mail matching is useless for "Hide My Email" users anyway. Lesson of the 2020 bug: Apple's endpoint issued validly signed tokens for any e-mail the requester supplied (Bhavuk Jain, USD 100 000 bounty) [SECONDARY] <https://www.bitdefender.com/blog/hotforsecurity/researcher-reports-zero-day-sign-in-with-apple-bug-that-could-allow-full-account-takeover> |
| **Microsoft Entra** | `email` claim untrusted | "In Microsoft Azure AD, the email claim is both mutable and unverified so it should never be trusted" (nOAuth): a tenant admin sets any address on their own user, and apps keyed on e-mail merged it into the victim's account. [SECONDARY, Descope's disclosure] <https://descope.com/blog/post/noauth>. Microsoft's mitigations: the `xms_edov` optional claim ("e-mail domain owner verified") and removal of unverified-domain e-mails from tokens. [SECONDARY] <https://www.crowdstrike.com/blog/noauth-microsoft-azure-ad-vulnerability/>, <https://workos.com/blog/noauth-microsoft-azure-ad-vulnerability> ("never use the email claim to make authentication or authorization decisions"). Microsoft's own page could not be opened [UNVERIFIED]. | EdMat already trusts a Microsoft address only with `xms_edov` or `verified_primary_email` (`backend/sso/CLAUDE.md`). |
| **Firebase Auth** | Auto-link between *trusted* providers | E-mail verified if "verified by a trusted Identity Provider"; "IdPs that either own the domain or always require verification are considered trusted". Trusted: Google for `@gmail.com`, Yahoo for `@yahoo.com`, Microsoft for `@outlook.com`/`@hotmail.com`, Apple. **Untrusted: Facebook, GitHub, Twitter, and Google/Microsoft for any other domain.** A trusted sign-in onto an untrusted account: "The trusted provider overwrites the untrusted provider." Otherwise the error `account-exists-with-different-credential` makes the app sign in with the old method and then link. [VERIFIED] <https://firebase.google.com/docs/auth/users>, <https://firebase.google.com/docs/auth/web/google-signin> | The "overwrite" is the pre-hijack defence. An attacker who pre-registered with the victim's address loses their password the moment the real owner arrives through Google. That is a destructive merge EdMat does not do. |
| **Supabase Auth** | Auto-link verified identities | "Supabase Auth automatically links identities with the same email address to a single user." "It would also be an insecure practice to automatically link an identity to a user with an unverified email address." It "will remove any other unconfirmed identities linked to an existing user." [VERIFIED] <https://supabase.com/docs/guides/auth/auth-identity-linking> | Same overwrite of unconfirmed identities as Firebase. |
| **Clerk** | Auto-link when both sides verified | Both verified: Clerk "links the OAuth account to the existing account and signs the user in". Provider unverified: Clerk runs its own verification first. Local account unverified: e.g. "Clerk will prompt the user to change their password before linking." [VERIFIED] <https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking> | — |
| **Auth0** | No automatic linking | "Your tenant should request authentication for both accounts before linking occurs"; "every manual account link should prompt the user to enter credentials." The sample Action: "We won't process users for account linking until they have verified their email address." [VERIFIED] <https://auth0.com/docs/manage-users/user-accounts/user-account-linking> | Matching on e-mail only *proposes* a link; the user confirms by authenticating. |
| **Okta** (external IdP) | Admin choice: *Automatic* or *Disabled* | Automatic matches the IdP's username/e-mail against a chosen profile field. Okta suggests turning linking off once existing users have linked. [UNVERIFIED — snippets] <https://help.okta.com/en-us/Content/Topics/Security/idp-add-okta.htm> | Workforce setting: the admin trusts the IdP. Not a consumer default. |
| **Keycloak** | *First broker login* flow: **confirm, then prove** | When an account with that e-mail exists: "Confirm link existing account", then "Verify existing account by Email" (a link to the account's address) **or** "Verify existing account by re-authentication" (its password). "Trust Email" on an IdP only marks the address verified on first federation. [VERIFIED for Trust Email: <https://www.keycloak.org/docs/latest/server_admin/index.html>; the authenticator names and default flow from secondary sources: <https://skycloak.io/blog/keycloak-account-already-exists-error/>] | The silent alternative, "Automatically set existing user", must be built into a custom flow. A community write-up warns it "allows everybody that can create an account with the IdP to log in" [SECONDARY] <https://sng.rs/posts/keycloak-idp-login-with-automatic-linking/> |
| **django-allauth** | Off | `SOCIALACCOUNT_EMAIL_AUTHENTICATION`: "an untrustworthy provider can login to any local account by fabricating social account data … Only set it to True if you are using providers that can be fully trusted." `…_AUTO_CONNECT` attaches the social account permanently. Per-provider `VERIFIED_EMAIL` decides whether a provider's address counts as verified. [VERIFIED] <https://docs.allauth.org/en/latest/socialaccount/configuration.html>, <https://docs.allauth.org/en/latest/socialaccount/provider_configuration.html> | Default off. Trust is chosen per provider, never global. |

**The split, in one line.** The guidance documents and the "build it yourself" frameworks (OWASP,
NIST, OIDC, Auth0, Keycloak, allauth) default to *no silent link: prove both sides*. The consumer
auth services (Firebase, Supabase, Clerk) default to *silent link when both sides are verified*.
They pay for that with machinery, either wiping the unverified side or forcing a password change,
and Firebase also keeps a per-provider-per-domain trust list. **[DISPUTED]** only in the sense that
both are widely shipped. The written guidance is one-sided.

### 2.2 The attacks that shape the rules

- **Pre-account-takeover.** Sudhodanan & Paverd, *Pre-hijacked accounts*, USENIX Security 2022:
  of 75 popular services, at least 35 were vulnerable. The attacker knows only the victim's
  e-mail. [VERIFIED abstract] <https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan>,
  [VERIFIED full text] <https://ar5iv.labs.arxiv.org/html/2205.10174>. The five attacks:
  1. **Classic–federated merge**: the attacker registers a password account with the victim's
     address; the victim later uses "Sign in with Google"; the service merges, and the attacker's
     password still works. *This is exactly the attack that silent auto-link creates when the local
     side is not confirmed.*
  2. **Unexpired session**: the attacker's session survives the victim's password reset.
  3. **Trojan identifier**: the attacker attaches their own IdP identity to the pre-created
     account and keeps access after a reset.
  4. **Unexpired e-mail change**: a pending change of address is confirmed after the victim has
     recovered the account.
  5. **Non-verifying IdP**: an IdP that does not verify e-mail creates the account; the victim's
     later password signup merges into it.

  Their recommendations: verify ownership before *any* use of an identifier; on password reset end
  every other session, cancel pending e-mail changes and show linked identities so the owner can
  remove them; require control of **both** accounts before merging; tell users about sensitive
  changes.
- **nOAuth** (Entra, 2023): a provider's e-mail claim was attacker-settable. EdMat already defends
  against it (§2.1).
- **Domain lapse** (Truffle Security, January 2025): buy a dead start-up's domain, recreate its
  Workspace, and sign in as former employees wherever apps trust `email`/`hd`. Google paid a
  bounty. No fix is confirmed. Apps keyed on `sub` are not exposed, because a recreated account
  gets a new `sub`. [VERIFIED] <https://trufflesecurity.com/blog/millions-at-risk-due-to-google-s-oauth-flaw>,
  [SECONDARY] <https://www.securityweek.com/google-oauth-flaw-leads-to-account-takeover-when-domain-ownership-changes/>.
  **The lesson for linking:** a verified Google address on a non-Gmail domain proves that somebody
  controlled that mailbox *once*, not that they control the EdMat account registered with it.

### 2.3 Where EdMat stands today

`backend/sso/CLAUDE.md` rules 3 and 4 already match the strict column. The key is
`(provider, issuer, subject)`. A known identity signs in. An unknown identity whose address an
account uses gets `email_in_use` and is sent to Settings → Sign-in methods, where linking needs a
signed-in session redeemed by the same account. A child account cannot start a link (403 `minor`).
Password reset already deletes every API token (`mail/services.py: reset_password`), which answers
attack 2.

The one weakness against the field is **friction, not security**. The person is told to go away
and do it in Settings, and if they have forgotten that they ever made a password account, that is
where they give up.

### 2.4 Recommendation for EdMat: rules to implement

**Answer: no to silent auto-link, yes to an in-flow confirmation.** Keycloak's default, Auth0's
recommendation and NIST's "authenticated session for all linking" in one step:

1. **Identity stays `(provider, issuer, subject)`.** No change.
2. **On `email_in_use`, offer to link instead of refusing.** The callback still issues nothing
   that signs anybody in. The SPA shows: *"An EdMat account already uses this address. Is it
   yours?"*, with two ways to prove it:
   - **(a) the account's password** (if it has one): `POST /api/auth/sso/link-confirm/ {ticket,
     browser_key, password}`. Same throttle as login, same lockout.
   - **(b) a link mailed to the account's address**: valid 30 minutes, single use, bound to the
     same browser key, and stored hashed like the other SSO secrets. The mail names the provider:
     "Somebody asked to connect *Google* to your EdMat account. If it was not you, ignore this." Only
     clicking the link creates the `SsoIdentity` and signs the person in.
   - Only one way exists until the person proves the account. The screen never reveals more than
     today's `email_in_use` already does: no username, no display name, no "has a password".
3. **Option (b) only when the local address is confirmed** (`mail.ConfirmedEmail` matches). If it
   is not confirmed, the address was never proven by anybody (attack 1), so offer only (a). If the
   account has no password either, keep today's refusal and point at "Forgotten your password?",
   which proves the mailbox.
4. **Never link a child account (`is_minor`) or any guardian-managed account through this flow.**
   It has no address and no self-chosen password, and it is the guardian's to run
   (`accounts/minors.py`). The refusal says so (`minor`), not `email_in_use`. If guardian-approved
   linking is ever wanted, it is a separate feature: the guardian, signed in, links from the
   child's settings. Not recommended. A provider account for an under-16 is itself outside most
   providers' terms in Poland [UNVERIFIED].
5. **After any link, by either path including Settings, mail the account.** "Google was connected
   to your EdMat account on …; if this was not you, reset your password". Also write the audit row
   that exists today. This is the pre-hijack paper's "notify on sensitive changes" and
   OWASP's e-mail-change rule applied to linking.
6. **Password reset also lists linked sign-in methods** on its success page, each with "Unlink"
   (attack 3). Tokens are already revoked. If a change-of-address flow is ever built, a reset cancels
   any pending change (attack 4).
7. **If the owner nevertheless wants zero friction for Gmail**, the narrowest silent variant the
   field would accept is the one below. It is **not recommended**. All of these must hold:
   - provider = Google, `email_verified` = true, the address ends in `@gmail.com` (Firebase's
     "trusted" set), and **no** `hd` claim;
   - the local account's address is confirmed (`ConfirmedEmail`) and equal;
   - the account is not a minor's or guardian-managed;
   - the account has no other identity from the same provider;
   - a notification mail goes out at once (rule 5).

   Every other provider and every non-Gmail domain still goes through rule 2. Apple relays never
   match; Facebook never asserts verification; GitHub and Microsoft are not authoritative for a
   domain they do not own. The cost: the confirmed-address check rests on EdMat's own confirmation
   mail, which is days old, and the residual risk is a reassigned Gmail address [UNVERIFIED whether
   Google ever recycles one].

---

## 3. Browser error reporting

### 3.1 Options

| Option | Collected by default (browser) | Hosting / data location | Cost | GDPR posture |
|---|---|---|---|---|
| **Sentry SaaS** | Message, stack, URL **including the query string**, Referer and User-Agent headers, breadcrumbs (console logs "which may contain PII", clicks, fetch/XHR, navigation). **"The SDK sends the user's IP address by default"**, turned off with `dataCollection: { userInfo: false }` (newer SDKs; `sendDefaultPii` is described as deprecated). Even then: "IP addresses can still reach Sentry through collected HTTP headers, cookies, or query parameters." [VERIFIED] <https://docs.sentry.io/platforms/javascript/data-management/data-collected/>, <https://docs.sentry.io/platforms/javascript/configuration/options/>. Session Replay is a separate integration, masking text and media by default [VERIFIED] <https://docs.sentry.io/platforms/javascript/session-replay/privacy/>. Server-side scrubbing is on by default, and IP storage can be switched off, but "Geographic information is extracted from the user's IP address … even if the setting to stop storing IP addresses is turned on." [VERIFIED] <https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/> | US company; EU region in Frankfurt (`de.sentry.io`) [VERIFIED] <https://docs.sentry.io/organization/data-storage-location/> | Free Developer plan; errors kept 30 days (Developer) or 90 days (Team and up) [VERIFIED] <https://docs.sentry.io/security-legal-pii/security/data-retention-periods/> | Processor with a DPA; the customer must minimise data and "provide notices or obtain consents". Sentry's own GDPR page gives "opt-in consent for Sentry SDKs via your website or app consent banner" as an example [VERIFIED] <https://sentry.io/trust/privacy/>. Third-country processor even with EU storage. |
| **Sentry self-hosted** | As above, under our own control | Our servers | **4 cores, 16 GB RAM + 16 GB swap, 20 GB disk** minimum [VERIFIED] <https://develop.sentry.dev/self-hosted/> | No transfer. Too heavy for webek4. |
| **GlitchTip** (Sentry-SDK-compatible) | Whatever the Sentry SDK sends, so the same client-side config applies | Self-hosted, or hosted (US or EU/Germany) | **256 MB RAM** all-in-one (512 MB recommended), PostgreSQL 14+, Valkey/Redis optional [VERIFIED] <https://glitchtip.com/documentation/install>. Hosted: free up to 1 000 events/month [VERIFIED] <https://glitchtip.com/pricing>. Retention via `GLITCHTIP_RETENTION_DAYS` / `GLITCHTIP_EVENT_RETENTION_DAYS` (defaults 90 / hot 30, from the repo, not the docs page) [UNVERIFIED] | Self-hosted: no transfer, no processor. A second service to run and patch. |
| **Bugsnag / Insight Hub** (SmartBear) | **IP collected by default** (`collectUserIp: false` stops it). Breadcrumbs on (errors, logs, navigation, requests, clicks); `enabledBreadcrumbTypes: []` turns them off [VERIFIED] <https://docs.bugsnag.com/platforms/javascript/configuration-options/> | GCP; EU data said to go to the US under SCCs; no EU region confirmed [UNVERIFIED] <https://bugsnag.com/product/security/> | Paid tiers | Third-country processor. |
| **Rollbar** | `captureIp` default **true** (`'anonymize'` masks the low bits). Telemetry on: network, console, DOM, navigation; `scrubTelemetryInputs` default false [VERIFIED] <https://docs.rollbar.com/docs/rollbarjs-configuration-reference> | USA [UNVERIFIED] <https://docs.rollbar.com/docs/gdpr-rollbar> | Paid tiers | Third-country processor. |
| **OpenTelemetry (browser)** | Nothing grouped as "errors"; you build it | Needs an OTLP collector | Free, but work | "Client instrumentation for the browser is experimental and mostly unspecified." [VERIFIED] <https://opentelemetry.io/docs/languages/js/>. Not a fit. |
| **Home-grown beacon** | Exactly the fields we choose (§3.3) | Our own API and database | A few hundred lines | First-party, no processor, no transfer. Minimisation is enforced by the code, not by a settings page. |

The browser primitives the home-grown option needs: the `error` event on `window` [VERIFIED]
<https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event>, `unhandledrejection`
[VERIFIED] <https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event>, and
`navigator.sendBeacon` / `fetch(…, {keepalive: true})` [VERIFIED]
<https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon>. SvelteKit's client
`handleError` hook catches errors during load and render, which `window.onerror` sees only partly
[UNVERIFIED — docs not re-read this time; <https://svelte.dev/docs/kit/hooks#Shared-hooks-handleError>].

**What "industry standard" means here.** The default in industry is Sentry-style SaaS with
the SDK's defaults. It is not the standard for an EU public-sector or student site that promises
"no identifier that would let us recognise you". The disclosures found are all **self-hosted plus
legitimate interest**. Universität Bielefeld (UniMaps): "Sentry wird ausschließlich auf unseren
eigenen Servern betrieben … Eine Übermittlung personenbezogener Daten an den Anbieter … erfolgt
dabei nicht", basis art. 6(1)(f) [VERIFIED]
<https://uni-bielefeld.de/einrichtungen/zab/unimaps/datenschutzhinweis/>. The University of Zurich
runs self-hosted Sentry as a service [UNVERIFIED] <https://www.bf-tools.uzh.ch/en/tools/sentry>.
A UK department uses hosted Sentry on legitimate interests ("site security, error-handling and
performance") [VERIFIED] <https://deprivation.communities.gov.uk/privacy-notice>. GOV.UK goes the
other way: its real-user monitoring, which includes "JavaScript errors your device encountered",
runs only with consent [VERIFIED] <https://www.gov.uk/help/privacy-notice>. That is the
conservative end of practice, and it bundles errors with performance analytics.

### 3.2 The legal analysis

1. **It is "access" to the terminal equipment.** The handler is code we distribute that
   "instructs the browser of the user to send asynchronous requests with the targeted information.
   Such access clearly falls within the scope of Article 5(3) ePD" (EDPB 2/2023 para 33). Para 53
   adds that "the fact that this information is being produced locally does not preclude the
   application of Article 5(3)" [VERIFIED]
   <https://edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf>.
   A stack trace is information produced in the device. So the question is the exemption, not the
   scope. In Poland that means PKE art. 399 ust. 3 pkt 2 (`ANALYTICS-LAW.md` §2.1, [VERIFIED] there).
2. **The exemption.** Art. 399 ust. 3 pkt 2 covers access *konieczne do … dostarczania usługi
   świadczonej drogą elektroniczną, żądanej przez … użytkownika końcowego*.
   - *For:* a crash means the requested service is not being delivered, and finding out about it is
     part of delivering it.
   - *The authorities closest to this:*
     - WP29 Opinion 04/2012 extends the exemption to things "set for the specific task of increasing
       the security of the service that has been explicitly requested by the user", and keeps
       first-party analytics outside it. It says nothing on crash reports [VERIFIED]
       <https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf>.
     - The DSK counts user-oriented security and fraud-prevention systems as part of the
       *Basisdienst* and has no passage on error analysis [VERIFIED]
       <https://lfd.niedersachsen.de/download/142884>.
     - The CNIL's exempt list includes audience measurement used for "détection de problèmes de
       navigation", on strict conditions [UNVERIFIED — cnil.fr down; secondary
       <https://twobirds.com/en/insights/2020/france/cookies-et-traceurs-les-nouvelles-recommandations-de-la-cnil>].
     - The ICO, applying PECR as amended by the Data (Use and Access) Act 2025, lists "preventing or
       detecting technical faults" among its examples of "strictly necessary to provide the service
       the subscriber or user requests", judged "from the point of view of the subscriber or user"
       [VERIFIED]
       <https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/>.
       UK law, not binding here. It is the only text found that names faults, and it reads the same
       Directive wording.
   - *Against:* error data mostly serves the operator's future fixing, not the page the user is
     looking at right now. The EU reading of "strictly necessary" is narrow. No Polish authority
     (UODO, UKE) has said anything **[DISPUTED]**.
   - *Conclusion:* consent-free is the mainstream and defensible position **only for a minimal,
     first-party, identifier-free beacon**. Breadcrumbs, a user id, replay, a third-party processor
     or performance data each move it towards analytics, where the exemption plainly does not reach.
3. **GDPR.** The report can be personal data: a stack can carry a fragment of user content, and
   the request carries an IP. Basis art. 6(1)(f): operating and fixing the service, which
   `LEGAL.md` §1 says is open to the student group. The balancing is easy if the beacon is minimal,
   short-lived and disclosed. Art. 13 disclosure is required whatever art. 399 says
   (`ANALYTICS-LAW.md` §2.1). Sentry's own docs put minimisation and notice on the customer (§3.1).
4. **Minors.** Nothing in the beacon identifies a person or an account, so the heavier balancing
   for children does not change the design. That is one more reason not to attach the token or a
   user id.
5. **GPC / DNT.** An art. 21 objection must be honoured unless there are compelling grounds.
   EdMat's policy already treats GPC/DNT as an objection to statistics and keeps security logging
   (`ANALYTICS-LAW.md` §3 row 12). Fixing a crash is weaker than security. The beacon is also an
   *access* that the browser did not have to make. **Recommendation: do not send when
   `navigator.globalPrivacyControl === true` or `doNotTrack === '1'`.** The cost is a few missed
   reports; the gain is that "GPC means nothing leaves your browser except what you asked for" stays
   true. Server-side 5xx logging continues for everyone.

### 3.3 Recommendation for EdMat

**Build the home-grown beacon. Do not adopt a SaaS. Keep GlitchTip, self-hosted, as the documented
upgrade if volume or triage ever needs a UI.** GlitchTip would need the same client-side
restrictions (`beforeSend` that rebuilds the event from the field list below, no breadcrumbs, no
IP).

**Client** (`hooks.client.ts` `handleError`, plus `window` `error` and `unhandledrejection`):

- **Sends only:**
  - `message`, truncated to 500 characters;
  - `stack`, truncated to 4 KB, with every URL in it reduced to origin + path (query and fragment
    stripped);
  - `kind` (`error` / `rejection` / `sveltekit`);
  - `route`, the **route template** (`/exercises/[id]`), never the concrete path;
  - `build`, the app version or commit;
  - `locale`, `pl` or `en` only;
  - the browser family and major version, derived **server-side** from the User-Agent the request
    carries anyway, not read in the browser.
- **Never sends:** user id or token (the beacon goes without `Authorization`, so the server cannot
  attach one), page URL or query, referrer, screen or viewport size, timezone, language list,
  device memory, breadcrumbs, console output, DOM snapshot or replay, form values, cookies or
  storage contents.
- **Limits:** only on an actual error. At most 5 reports per page load, deduplicated by message +
  first frame. Errors whose stack frames are all `chrome-extension:` / `moz-extension:` or
  cross-origin (`"Script error."`) are dropped. No cookie and no storage write. Nothing is sent
  under GPC/DNT. `sendBeacon` to the same origin. The kill switch is a `FeatureFlag`
  (`client_errors`), the three-file change.

**Server** (`/api/client-errors/`, anonymous, POST only):

- Throttled per IP (for example 30/h).
- Body capped at 8 KB, with the field allowlist re-applied server-side. The client is untrusted, so
  unknown fields are dropped and the stack is re-stripped of queries.
- Stores a **fingerprint** (a hash of the message with numbers normalised, plus the top in-app
  frames), a count, first and last seen, and up to N sample reports per fingerprint.
- **The IP is used for the throttle in memory and not stored with the report.** If it is ever
  stored, it goes in `RequestLog` under that log's existing rules, not in this table.
- **Retention:** samples 30 days; per-fingerprint counts 90 days. Read in `/moderation` by staff,
  next to the analytics Health panel.

**Privacy policy wording** (beside the request-log paragraph, and as a row in the storage/access
table):

> **EN.** *Error reports.* When the site breaks in your browser — a page fails to load or a button
> throws an error — your browser sends us a short technical report: the error message, where in our
> code it happened, which page type you were on (for example "an exercise page", not which
> exercise), the app version and your browser family. It contains no account, no identifier and no
> address of the page, and nothing is stored on your device. We use it only to find and fix faults,
> on the basis of our legitimate interest in a working service (art. 6(1)(f) GDPR), keep individual
> reports for 30 days and counts for 90 days, and share them with no one. If your browser sends a
> Global Privacy Control or Do Not Track signal, no report is sent.

> **PL.** *Raporty o błędach.* Gdy strona zepsuje się w Twojej przeglądarce — nie wczyta się albo
> przycisk zgłosi błąd — przeglądarka wysyła nam krótki raport techniczny: treść błędu, miejsce w
> naszym kodzie, w którym wystąpił, rodzaj strony (np. „strona zadania”, a nie które zadanie),
> wersję aplikacji i rodzinę przeglądarki. Raport nie zawiera konta, identyfikatora ani adresu
> strony i nic nie jest zapisywane na Twoim urządzeniu. Używamy go wyłącznie do wykrywania i
> naprawiania usterek, na podstawie naszego prawnie uzasadnionego interesu w działającej usłudze
> (art. 6 ust. 1 lit. f RODO); pojedyncze raporty przechowujemy 30 dni, a liczniki 90 dni, i nikomu
> ich nie udostępniamy. Jeśli przeglądarka wysyła sygnał Global Privacy Control lub Do Not Track,
> raport nie jest wysyłany.

---

## 4. Open questions for the owner

1. **Linking: the confirmation step, or silent Gmail auto-link?** §2.4 rules 2–6 are the
   recommendation; rule 7 is the narrowest silent variant. Only the owner can trade the extra click
   against the risk. A smaller sub-question: offer path (b), the mailed link, or only (a), the
   password? (b) needs the mail service working on production, which it is since 2026-10-14.
2. **Error reporting: accept class B without asking IOD UW, or ask first?** `ANALYTICS-LAW.md`
   §8 question 4 is the same question. The design above is built so that the answer is probably
   yes, but nobody qualified has said so.
3. **GPC/DNT suppressing error reports** (§3.2 point 5): the recommendation is yes. If the owner
   prefers to treat fault reports like security logging and ignore the signal, the policy wording
   loses its last sentence.
4. **Whether GlitchTip is ever wanted.** It is not needed now. It would be a second service on the
   Faculty's servers, which the Ośrodek would have to agree to host.
