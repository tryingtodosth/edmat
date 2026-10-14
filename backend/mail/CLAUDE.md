# mail — no-reply@edmat.net: the logged outbound queue, the read-only inbox, confirm + reset

Built 2026-10-14. Closes the longest-standing gap in the root `CLAUDE.md` ("No email backend").
The mailbox is OVH MX Plan (`MXPLAN 001`): SMTP `ssl0.ovh.net:465` (SSL), IMAP `ssl0.ovh.net:993`.

## Configuration (all in `config/settings.py`, all optional)

- **The password is read from a file**: `EDMAT_MAIL_PASSWORD_FILE`, default `/etc/edmat/mail-password`
  (0640 root:www-data on webek4), or `EDMAT_MAIL_PASSWORD` directly. Not envvars: the real password
  has `'` and `;` in it, and the file is read the same way by Apache and the cron job.
- **No password → the console transport.** A bare clone needs no account and no daemon; every row
  it "sends" ends as `status='console'` ("Not sent (no mail server)"), never `sent`. House rule 10.
- `EDMAT_SMTP_HOST/PORT`, `EDMAT_IMAP_HOST/PORT`, `EDMAT_MAIL_USER` (default `no-reply@edmat.net`),
  `EDMAT_SITE_URL` (where links point; `http://localhost:5173` under DEBUG, else `https://edmat.net`).
- Under `manage.py test` the transport is `locmem` and delivery is inline in the commit hook
  (`EDMAT_MAIL_DELIVER_INLINE`), so tests assert on `django.core.mail.outbox`.

## The shapes

- **`services.py` is the only place a message is queued or a link is made.** Queue a row inside the
  request's transaction → `on_commit` starts a daemon thread that delivers it. A request never
  waits on SMTP (eight mod_wsgi slots). `manage.py mail_cron` (every 5 min, `deploy/cron/edmat-mail`)
  retries `failed` rows (≤ 5 attempts), un-sticks `sending` rows older than 15 min, queues digests
  and reads the inbox. **A claim is one WHERE-anchored `update()`**, so the thread and the cron job
  can race for a row and exactly one sends it.
- **The log never holds a working link.** Confirm and reset bodies are stored with
  `OutboundEmail.LINK_MARKER` (`[[link]]`); `render_body` builds the link at send time from the
  user (a signed `{u, e}` for confirmation, Django's `default_token_generator` for reset — both
  deterministic, so a retry builds a valid one). The superuser reading the log sees `[[link]]`.
- **`transport.LoggedEmailBackend` is `EMAIL_BACKEND`** and logs anything sent AROUND the queue
  (admin, postman) as `kind='direct'`. The queue opens the real transport directly, so nothing is
  logged twice. A `direct` row cannot be retried — its message object is gone.
- **Confirmed is derived**: `ConfirmedEmail.email == user.email` (case-insensitive). Users cannot
  change their address today, but if that ever lands, confirmation lapses by itself.
  A completed password reset also confirms the address (the link was opened from that inbox).
- **The digest** (`MailPreference.notification_digest`, off by default) is the only notification
  email: at most once an hour, unread notifications since the last digest, only to a CONFIRMED
  address, and switching it on never mails the backlog. `notifications.services.notify()` is not
  touched — the digest reads `Notification` rows, so its three gates stay the only gates.
- **The inbox is read-only twice over**: `select(readonly=True)` and `BODY.PEEK[]` — OVH webmail
  looks unchanged. Incremental by `(folder, uidvalidity, uid)`. Text only: HTML is stripped with
  bleach to text, attachments are recorded by name/type/size and their bytes are never stored
  (house rule 7). Over 2 MB → headers only.
- **Who sees what**: the Mail tab endpoints (`/api/mail/…`) are **superuser-only** (`IsSuperuser`),
  not staff — they show every registered address and what strangers mailed us. The frontend tab
  in `/moderation` is guarded by `authStore.user.isSuperuser` as well.

- **`account_erasure`** (2026-10-14): "your account will be deleted on …" with a cancel link, queued
  by `accounts/erasure.py` to a CONFIRMED address only; the link (`/cancel-deletion?token=`) is built
  at send time from `accounts.erasure.cancel_token` like the others. Retention of `OutboundEmail`
  (finished rows) and `InboundEmail` is 12 months — `accounts/retention.py`, not this app.

## Endpoints

`POST /api/auth/password-reset/` (accounts view → `request_password_reset`, always 202) ·
`POST /api/auth/password-reset/confirm/ {uid, token, password}` (400 `invalid_link` | `password`;
success deletes every API token) · `POST /api/auth/confirm-email/ {token}` (400 `expired` |
`invalid` | `changed`) · `POST /api/auth/confirm-email/resend/` (409 once confirmed; throttle
`mail_resend`) · `GET/PATCH /api/auth/me/mail/` · superuser: `GET mail/status/`,
`GET mail/outbound/[?q,status,kind]`, `GET mail/outbound/{id}/`, `POST mail/outbound/{id}/retry/`,
`POST mail/test/ {to}`, `GET mail/inbound/[?q]`, `GET mail/inbound/{id}/`,
`POST mail/inbound/fetch/` (503 + `not_configured` | `login_failed` | `unreachable`).
Lists are capped at 200 and leave bodies out.

## Left open

- No kill switch (`FeatureFlag`): the transport is the switch (remove the password file), and the
  digest is per-person opt-in. If a mail feature ever goes to everybody by default, add one.
- No per-type email choice, no instant (non-digest) notification email, no HTML mail.
- No bounce handling: bounces arrive in the inbox and a superuser can read them; nothing marks an
  address as undeliverable.
- No change-of-address flow (none existed before either).
- SPF/DKIM for edmat.net are DNS, outside this repo — `deploy/UPDATE-2026-10-14.md` says what to check.

## Verify

`manage.py test mail` · `manage.py mail_check [--send-to you@example.com]` (logs in, sends only
with the flag) · `e2e/mail.mjs`.
