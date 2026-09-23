# events — one-off happenings (guest lecture, workshop, meetup)

`Event`, `EventAttendance`, `EventPost`, `EventPostLink`. Deliberately **neither a
`courses.Course`** (no roster lifecycle/chapters/staff — modelling a Thursday lecture as a
one-lesson course would leave every course field meaning nothing) **nor a `booking.Booking`**
(published first, answered by many, nobody approves anybody). The module docstring says so too.

## Invariants

- `status`: draft / published / **cancelled** — cancelled is a STATE, not a deletion (people
  arranged their week around it). A cancelled event leaves the *browse* list but stays readable
  at its own URL and in hosting/attending lists. **Visibility filtering and browse filtering are
  separate layers in `get_queryset`** — DRF's `get_object` reads the same queryset, so an
  unconditional `when=upcoming` filter once made past events 404 on their own URL (and
  unanswerable). Visibility always applies; browse filters only on `list`.
- Start instant **plus duration**, never two datetimes (end-before-start unrepresentable).
  `location_kind` (onsite/online/hybrid) is validated in **`clean()`** so admin and seed
  commands are held to it; a partial edit validates against the fields it is NOT changing.
- `EventAttendance` stores "no" as a real row (unique per person — one seat, and "answered no"
  ≠ "never answered"). Capacity re-checked against the DB on every call; an existing seat-holder
  is exempt from the cap (a full event must accept a decline). The host does not attend their
  own event. Deleting with attendees → 409, naming cancel as the alternative; un-cancelling
  refused.
- Roster: attendees see each other; strangers 403; only the host sees declines. Notifications:
  host told on "coming"; seat-holders told on move/cancel; **declines, RSVP changes-of-mind, and
  description-only edits are deliberately silent** (only time/place count as "changed").
- Calendar coupling (implemented in `booking/availability.py`, decisions recorded there too):
  hosting blocks derived bookable hours; attending doesn't; both are drawn on `my-schedule`
  (events get their own dashed tone). The clash warning + one-click "keep these hours free"
  (writes a real `AvailabilityException`) live on the frontend event page.
- Behind the `events` FeatureFlag — reads too, links too, and `my-schedule` returns an empty
  `events` list while continuing to work (a tutoring endpoint must not break).

## EventPost (`postimage.py`, `services.py`)

A dated **broadcast from the host** — explicitly not the description (undated, for deciders) and
not a `Comment` (a conversation, opposite direction). Only the host posts (it notifies every
seat-holder — `event_posted`, kept apart from `event_updated`, whose urgency it would dilute);
reads are public (the room change is most useful to someone still deciding). Pictures re-encode
through shared `backend/imaging.py` bounds but are **bounded by longest edge, never
centre-cropped** (whiteboards/slides/posters run to the edges); shrink-only; EXIF stripped (a
photo of the room carries the room's GPS). `PostLinksField` accepts three shapes (JSON list,
repeated form keys, one delimited string — multipart has no arrays) and **overrides
`get_value`**: DRF reads only the LAST value of a repeated QueryDict key. Body-only PATCH leaves
links/picture alone; an explicit empty list clears; removing the only picture from a wordless
post is refused. `EventSerializer.post_count` prefetch needs **`to_attr`** — without it the
deferred queryset lands in the related manager's cache and later `.select_related()` chains onto
its `.only()` → `FieldError`.

## Personas and the matrix (CONFERENCE-BRIEF.md §3.B)

`manage.py seed_conference_personas` builds seven ordinary accounts — organiser, reviewer,
volunteer, attendee, guardian, a real minor made through the guardian flow, and a stranger — plus
one published multi-day "Sandbox conference" with a programme, an open call and a checked-in
attendee, and prints who can do what. Idempotent; `--password` sets the one password. The building
lives in `testing/personas.make_personas()`, which `test_permission_matrix.py` calls too: the table
and the accounts a person signs in as are then the same seven.

**There is no "log in as", and there is not going to be one.** The frontend's preview re-asks the
API with the `Authorization` header omitted (`client.ts`'s `anonymous` option); no token for
anybody else is ever minted, so there is nothing to audit and nothing to leak. The reasoning, and
the 2018 Facebook "View As" post-mortem it comes from, is in `testing/personas.py`'s docstring.

`test_permission_matrix.py` is one declarative table `(persona, method, path, body, expected, why)`
driven through `subTest`, each row in its own rolled-back savepoint so a row that writes cannot
change what a later row sees. It is where a new events endpoint's permissions are pinned — add
rows, not a new file. Three shapes it exists to hold: a stranger gets **404** on a draft, an
attendee **403** on the staff list and the registrations, and a volunteer **403** on a contribution
decision even though they are staff (a role is not a ladder).

## Verify

`manage.py test events` (154 tests + the 148-row permission matrix, refusal-weighted) + the availability
half in `booking/tests.py`. E2E: `events-and-nav.mjs`, `known-issues.mjs`, `event-preview.mjs`
(needs `seed_conference_personas` run against the backend it drives).
