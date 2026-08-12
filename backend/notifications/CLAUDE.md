# notifications — one creation path, three gates, SSE delivery

`Notification` is deliberately **denormalized**: `target_label` captured at creation (no
GenericForeignKey resolution on read), plus nullable FKs only to things with a real page to open
(`exercise`, `material`, `taught_course`, `event`). No grouping/clustering — a plain
reverse-chronological list, considered and declined, not forgotten. Bookings deliberately have
NO FK (no per-booking page; the card routes those four types to the schedule page by type).

## The one rule

**`services.notify()` is the only place a row is created.** Three gates live inside it and must
be unbypassable: `recipient=None` silently no-ops (742 corpus exercises have no submitter),
`actor == recipient` no-ops, and the preference gate means a muted category's row is **never
created** — not hidden client-side. Layered on top: `Profile.muted_notification_types`
(per-type, checked AFTER the coarse category), and per-tag (`TagFollow.notify`) / per-course
(`Enrollment.notify`) mutes checked by their own senders (`notify_tag_followers`,
`notify_course_participants`).

Adding a type: register it in `_PREFERENCE_FIELD_FOR_TYPE` (the catalog `NOTIFICATION_TYPES`
derives FROM that dict — one place) AND mirror it in frontend `lib/utils/labels.ts`
(`NOTIFICATION_TYPE_CATEGORY`/`_LABELS`) — a hand-maintained mirror, flagged in both files.

Deliberate silences (don't "fix"): joining an open course, an event decline, an RSVP change of
mind, a description-only event edit, self-actions.

## SSE (`views.py` + `redisbus.py`)

`GET /api/notifications/stream/?token=…` — a raw `StreamingHttpResponse` from a plain APIView.

- Token in the **query string** because `EventSource` cannot set headers at all.
  `QueryParamTokenAuthentication` is wired onto THIS VIEW ONLY — never add it globally. The
  better fix (short-lived ticket) is named in the code, not built.
- `EventStreamRenderer` exists purely to satisfy DRF content negotiation: without it,
  `Accept: text/event-stream` gets a **406 before `get()` runs** — invisible to curl (sends
  `*/*`), found only in a real browser.
- Without Redis: poll every `SSE_POLL_INTERVAL_SECONDS` (3s), cap at 600s (EventSource
  auto-reconnects via the `retry:` directive). With `EDMAT_REDIS_URL`: real pub/sub — `notify()`
  publishes once fire-and-forget (the DB row is the durable truth), the stream blocks on the
  subscribe socket, subscribe-first-then-drain + an `id <= last_id` guard closes the
  snapshot/subscription race. Two streams per account (Redis-counted, TTL leak guard, fail-open);
  a third tab gets 429, which EventSource treats as terminal.
- Only rows created AFTER the stream opens are sent; history comes from the normal list fetch.

## Verify

`manage.py test notifications`. E2E: `notification-types.mjs`. SSE changes must be verified in a
real browser (the 406 class of bug is curl-invisible).
