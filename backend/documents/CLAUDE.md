# documents/ — event documents, visibility tiers, and the briefing that unlocks the door

Two models, one rule module, three endpoints. It exists because a conference hands different pieces
of paper to different people (CONFERENCE-BRIEF.md §3.C): a public joining note, an attendee's
access instructions, a volunteer briefing, an organisers-only budget, and a fire plan the building
wrote. And because a briefing nobody has confirmed reading is not a briefing — so the
acknowledgement is what unlocks a volunteer's day-of tools.

## The shape

```
EventDocument(event, title, kind: file|link, file, url, visibility, requires_acknowledgement,
              version, replaced_by, removed_at, scanned, scan_detail)
DocumentAcknowledgement(document, user, version)   unique per (document, user, version)
```

- **The tiers are a ladder plus one side branch.** `public ⊂ attendees ⊂ staff ⊂ organisers` —
  a step up sees everything below, because a document an attendee may read is not a secret from the
  volunteer at the door. **`venue` is off the ladder**: the building's administrators are neither
  above nor below an organiser, they are a different party. Until step A lands, only organisers
  answer to it.
- **A replacement is a new row.** `POST /documents/{id}/replace/` writes version + 1 and points the
  old row at it. The old bytes, the old version number and every acknowledgement made against it
  stay exactly where they were (house rule 12). An in-place edit would silently convert forty
  people's "I have read it" into a claim about text they never saw — which is the whole reason this
  model has a version at all.
- **DELETE is a tombstone** (`removed_at`), so the read receipts stay answerable.
- **A lifecycle is one field**: `replaced_by IS NULL AND removed_at IS NULL` is "current". No
  `is_active` boolean anywhere.

## `access.py` is the only place the rules live

`visible_tiers_for(user, event)` · `visible_documents` · `can_read_document` ·
`can_manage_documents` · `missing_acknowledgements(user, event)` · `briefing_block_reason` ·
`visible_events`.

Every endpoint asks these; none re-derives a role (they all go through `Event.role_of` /
`can_organise` / `is_staff_member`). **`missing_acknowledgements` is the cross-step seam**: it is
called by the check-in action today and, at integration, by step D's `/scans/` and step F's
cloakroom desk — all three answer the same 409 `briefing_unread` carrying the document ids.

Two hooks the integrator wires (CONFERENCE-BRIEF.md §5):

1. **`venue_admin_check(user, event)`** returns `False` today. The comment above it spells the
   replacement body for `venues.access.is_venue_admin`. It is a module-level function on purpose —
   one obvious edit, and a test monkeypatches it to prove the tier is real rather than decorative.
2. **`visible_events(user)` mirrors `EventViewSet._visible_to`** rather than importing it (that rule
   lives in a viewset method, and `events` takes no edits this cycle beyond the one guard). Flagged
   here as the drift risk it is: if the events visibility rule changes, this changes with it.

## The one edit in `events/`

`events/registration_views.py`, the check-in action, gains three lines: ask
`briefing_block_reason(event, request.user)` and return it with 409 when it answers. Nothing else in
`events` knows this app exists — the FK is a string reference, so the dependency runs one way.

The gate covers the undo as well as the check-in: it is the same tool, and somebody who may not open
the door may not reopen it either.

## Files: house rule 7, both halves of it (`files.py`)

- **An image is re-encoded from its pixels** through `backend/imaging.py` — byte cap, sniff, the
  decoded-pixel budget checked against the header, then decode, EXIF-transpose, fresh WebP. A
  polyglot is not a question this path has to answer: it keeps pixels and discards everything else.
  There is a test that uploads a real PNG with a payload appended and reads the stored bytes back.
- **A PDF cannot be re-encoded**, so it gets the 25 MB cap, the libmagic sniff, and
  `materials.validators.scan_for_malware` — `scanned=False` recorded honestly when no daemon is
  reachable, and a hard refusal when `MATERIAL_SCAN_REQUIRED` is on (house rule 10).
- **Everything else is refused by name** before either path runs. This step accepts PDFs and images
  only; a `.txt`, a `.docx` and a script called `plan.pdf` all get a 400 that says what was wanted.
- The stored name is random and the uploader's filename is discarded; `Content-Type` comes from what
  the file was proven to be, never from the request.

**The bytes are served by `GET /documents/{id}/file/`, never from `/media/`.** The tier is re-checked
on every request, a caller below it gets 404, and the header is
`attachment; filename="<slugified>"; filename*=UTF-8''…` plus `X-Content-Type-Options: nosniff`. The
frontend fetches it as a Blob through `lib/api/client.ts` (`getBlob`) and renders it itself, so
nothing needs an inline disposition or a URL that carries a token.

## API

```
GET|POST /api/events/{id}/documents/        list filtered by tier; organisers post multipart or a link
GET      /api/events/{id}/acknowledgements/ organisers: who has read what, and who has NOT
GET|PATCH|DELETE /api/documents/{id}/       PATCH is title/tier/mandatory only; DELETE tombstones
GET      /api/documents/{id}/file/          the bytes, tier-checked
POST     /api/documents/{id}/acknowledge/   409 `superseded` / `withdrawn` when the world moved
POST     /api/documents/{id}/replace/       the next version (organisers)
```

The two event-scoped paths are registered in `documents/urls.py`, not as actions on `EventViewSet`:
the router in `events/urls.py` never matches `events/<id>/documents/`, so the request falls through
to this app and `events/urls.py` stays untouched.

## One thing inherited from the cache

`/api/events/` is on `config/cachemw.py`'s anonymous-read allowlist, so
`GET /api/events/{id}/documents/` **from a signed-out visitor** can be served from the 60 s response
cache. That is safe rather than merely tolerated: the middleware only stores and only replays a
response for a request carrying no Authorization header and no session cookie, and an anonymous
caller resolves to the `public` tier alone — there is no tier whose answer could leak into somebody
else's. What it does mean is the usual sub-minute lag: a newly-posted public document, and a flipped
kill switch, reach a signed-out reader up to 60 s late, exactly as the events list itself already
does. The file endpoint is not under that prefix, so bytes are never cached.

## The flag

`event_documents`, seeded ON by `moderation/migrations/0043_conference_flags.py` with the other five
conference keys. Off: every endpoint here 403s a non-staff caller, the frontend panel goes, **and the
briefing gate stops applying** — check-in behaves exactly as it did before the app existed
(house rule 3: a killed feature must not keep imposing its rule on a neighbour). That last part is
why `missing_acknowledgements` reads the flag with a plain `is_feature_enabled()` rather than
`feature_gate`: it governs a rule applied to somebody else's endpoint, not a surface of its own, and
an `is_staff` bypass would hand a platform moderator a different answer from the volunteer beside
them. `age_verification` is the same shape, for the same reason.

## Tests

`documents/tests.py` (40, refusals first), with its own temporary `MEDIA_ROOT` per class so a run
never leaves files under `media/event-documents/`. E2E: `frontend/e2e/event-documents.mjs`.
