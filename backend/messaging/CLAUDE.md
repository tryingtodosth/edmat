# messaging — a thin DRF wrapper over django-postman

**No models of its own.** `MessageViewSet` is a plain `GenericViewSet` over postman's `Message`
model and `pm_write()` API. `django.contrib.sites` is a hard import-time dependency of postman
itself — not optional.

## Invariants

- `?folder=inbox|sent|archives|trash` (postman's own manager methods do the folder scoping —
  one row per message, not per conversation). Retrieve marks read as a side effect ONLY when the
  caller is the recipient. `unread-count/` backs the header badge.
- **postman ships no reply API** (only Django form classes) — `services.reply_to_message()`
  replicates its thread-linking sequence read from the installed package's own `BaseWriteForm._save()`:
  the FIRST reply promotes the parent into its own thread root (`parent.thread = parent`); later
  replies inherit `thread_id`. Recipient is "whoever isn't the current replier" on the parent —
  a real back-and-forth, never unconditionally the original sender. Don't reinvent this; if
  postman is ever upgraded, re-check that sequence against the new source.
- A third party (neither sender nor recipient) gets **404** from retrieve/reply/thread — the
  queryset-scoping convention, not 403.
- Auto-moderation off (no `POSTMAN_AUTO_MODERATE_AS`); `skip_notification=True` throughout (no
  mail backend exists) — messages surface via these REST endpoints and the frontend unread badge
  (`lib/state/messages.svelte.ts` — a plain refetch store, deliberately NO SSE).
- Authenticated-only throughout; behind the `messaging` FeatureFlag. No user search exists —
  conversations start from a Service listing's Contact link or a profile's Send Message link.
- **The body is encrypted at rest** (`crypto.py`, AES-256-GCM, `edmat1:` prefix): sealed in
  `services.send_message`/`reply_to_message` — the only two write paths — and opened in
  `MessageSerializer`, the only read path. Add a third of either and it must go through them.
  A value without the prefix is returned as-is, so a mixed table is normal and nothing had to be
  migrated; `manage.py encrypt_messages` converts old rows when somebody chooses to (deliberately
  a command, not a data migration — see its docstring). **The SUBJECT is deliberately in clear**:
  `CharField(120)` cannot hold the ciphertext of a 120-character subject, and shrinking what people
  may type to ~56 bytes to hide what is usually a public listing's own title is the wrong trade.
  This is at-rest, not end-to-end — the key is on the server; `crypto.py` records what that does and
  does not defend against, and why E2EE is a product decision rather than a module's to make.
  An unreadable row (rotated key) becomes `body: ''` + `body_unavailable: true`, never a 500, and
  the decrypt is cached on the ROW — caching on `self` serves row 1's body for a whole inbox.
- Known accepted gaps: no edit/delete/report, no attachments, no archive/trash UI (the API
  folder values are real).

## Verify

`manage.py test messaging` — threading (incl. reply-recipient inversion), retrieve-marks-read
(and that the SENDER retrieving does not), folders, third-party 404s; and `test_encryption.py`,
which asserts against the DATABASE ROW rather than the response, because an unencrypted body
round-trips through the API perfectly.
