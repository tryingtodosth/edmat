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
- Known accepted gaps: no edit/delete/report, no attachments, no archive/trash UI (the API
  folder values are real).

## Verify

`manage.py test messaging` — threading (incl. reply-recipient inversion), retrieve-marks-read
(and that the SENDER retrieving does not), folders, third-party 404s.
