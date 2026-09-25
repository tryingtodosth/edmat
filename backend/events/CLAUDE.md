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

## Exports and retention (`exports.py`, CONFERENCE-BRIEF.md §3.G)

**Not every staff member gets the same registration row.** `GET /registrations/` answers an
organiser with `EventAttendanceSerializer` (answers, note, account id, waiting-list timing) and
everybody else — volunteers *and* reviewers — with `exports.DoorListAttendanceSerializer`: the row
id, the name, the status and the check-in stamp, and `attendee.id` is **null**. The row id is kept
deliberately, because it is what `POST /registrations/{row_id}/checkin/` addresses; nothing a
volunteer does addresses a person. Adding a field to the full serializer without deciding which
side of that line it falls on is the way this leaks — `WITHHELD_FROM_NON_ORGANISERS` is asserted
against in `test_exports.py` so the decision is forced.

The **full CSV** (`/registrations/export/`) is organisers-only since §3.G — it was every staff
member, and it is the exact file the research report names as the commonest accidental disclosure
at an academic event. Every download of it, and of the door list, writes an `ExportLog` row
(`log_export()` is the only writer). `exports/needs/` is counts and nothing else and is
**not** logged: no identifiers, and the organiser's own panel fetches it on open. Where a question
is free text, the aggregate is `answered` / `unanswered` and never the text — house rule 10.

`_attendance_mode` is resolved, not merely read (`_resolved_mode`): only a hybrid event asks the
question, so reading the stored key alone would report every attendee of an ordinary onsite
lecture as "did not say".

**Retention** is `manage.py purge_event_data --older-than-days 30 [--dry-run]`, implemented in
`purge_event_data()` here rather than in the command, so the integration work has one place to
happen. It blanks the accessibility note and free-text answers and nulls `checked_in_by`; it never
touches who attended, the multiple-choice answers (so an aggregate stays reproducible) or the
programme. `Event.ends_at` is a property, so the cutoff is a `starts_at__lt` candidate filter plus
a Python test. `RETENTION_NOTE` names `ScanEvent` and `CloakroomItem` as what the command must
learn at integration, and `EventAttendance.note` as the field somebody still has to decide about.
Nothing schedules the command — `LEGAL.md` §8 says so rather than implying a cron that is not
there.

## Verify

`manage.py test events` (refusal-weighted; `test_exports.py` is the §3.G half) + the availability half in
`booking/tests.py`. E2E: `events-and-nav.mjs`, `known-issues.mjs`.

## Personas and the matrix (CONFERENCE-BRIEF.md §3.B)

`manage.py seed_conference_personas` builds seven ordinary accounts — organiser, reviewer,
volunteer, attendee, guardian, a real minor made through the guardian flow, and a stranger — plus
one published multi-day "Sandbox conference" with a programme, an open call and a checked-in
attendee, and prints who can do what. Idempotent; `--password` sets the one password. The building
lives in `testing/personas.make_personas()`, which `test_permission_matrix.py` calls too: the table
and the accounts a person signs in as are then the same seven.

`manage.py seed_conference_demo` (`testing/conference_demo.py`, `HISTORY.md` §17BK) builds a lived-in
two-day conference on top of those seven — venue, checklist, documents, tickets, a day-one scan log,
a rota, a cloakroom — for screenshots and QA. Day one is today in Warsaw; anything the plan dates
after now is left unapplied. It writes attendances and assignments directly (nothing notifies) and
calls only the minting and validating services; the rota plan is checked against `shifts.rules`
before a row is written.

**Both seeders now promise two things about themselves, because this seed runs on the live
database** (`HISTORY.md` §17BL). Neither is documentation — both
are enforced in `make_conference_demo`, inside its own transaction, so a build that cannot keep them
leaves nothing behind:

- **Every seeded event is titled `TEST=FAKE …`.** `FAKE_PREFIX` lives in `testing/personas.py`;
  `conference_demo.py` imports it rather than repeating the literal. A demo conference and a real
  one share the `Event` table and the public `/events` list — there is deliberately no `is_sandbox`
  column — so the title is the only thing telling a reader which is which. Changing the marker
  changes a lookup key: both titles are how the seeders find their own rows.
- **No seeded account holds authority outside the demo** — `assert_contained()`, over every
  `persona.*` and `conf.*` account. `is_staff`/`is_superuser`/groups/permissions: none. `EventStaff`:
  only on a *marked* event. `VenueStaff`: only on the demo venue. `CourseStaff`,
  `OrganizationMember`, `ProjectMember`, `NodeGovernor`: no rows at all. `CONTAINMENT_MODELS` is
  hand-maintained — **a new way for an account to gain authority belongs in that tuple**, and a test
  asserts every entry still imports so a rename cannot turn the check into a silent no-op.

A dev box that has run `frontend/e2e/` **will** fail containment: the preview script leaves events
hosted by `persona.organiser` behind, which is authority outside the demo. That is the check
working; delete those events and seed again (`test.md` has the query).

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

Since integration (`HISTORY.md` §17BF, "Matrix rows for A, C, E, F, G") the table also covers the
conference layer — `venues`, `documents`, `shifts`, `cloakroom` and `exports.py` — and its fixture
builds, all on the same Sandbox conference: a **venue** with one administrator, a room, an
**approved** `RoomBooking` (which is what makes `documents.access.venue_admin_check` answer at all)
and a second still-`requested` one so approve/reject are 200s; a checklist template whose one item
`requires_venue_signoff`, instantiated; a **document at each of the five tiers**, the `staff` one
mandatory; a `cloakroom` station with a worked shift and an `info` station with an open one; a
**desk** with one coat on rack 1; a `VolunteerRecord`; and an `ExportLog` row. The class carries its
own temporary `MEDIA_ROOT`, because one document has real bytes for `GET /documents/{id}/file/`.

Since the management layer (`HISTORY.md`, "Matrix rows for the management layer") it also covers
`organizations`, `tasks`, `needs`, `plans`, `decisions` and `work`, plus the two node-seam views in
`config/views.py` — on all four node kinds, so the fixture also carries a public course with one
plain participant, an unlisted course, a material with a co-authoring project and a bare one, and
an organisation with a single owner. A row's expected value may be a **`(status, refusal word)`
pair** as well as a bare status, and `test_matrix` then checks `response.data['detail']`: that
layer has twenty-five refusal words and a 403 alone passes on the wrong one. The third persona,
`participant`, is there for the "member but not staff" tier the demo seven have no example of.

**Two personas live in that fixture rather than in `make_personas()`, deliberately.** `venue_admin`
runs the building and is *not* event staff. `clerk` is a second volunteer who has not acknowledged
the mandatory briefing, and exists for exactly one row — `409 briefing_unread` on a desk write. The
volunteer persona cannot carry that row: the volunteer is who the check-in rows assert a **200**
for, and one unread mandatory document would turn every one of those into the same 409. Keeping
both out of `make_personas` keeps `seed_conference_personas`, `CAPABILITY_TABLE` and
`event-preview.mjs` free of four more apps and four more kill switches.

## Verify

`manage.py test events` (154 tests + the 690-row permission matrix, refusal-weighted) + the availability
half in `booking/tests.py`. E2E: `events-and-nav.mjs`, `known-issues.mjs`, `event-preview.mjs`
(needs `seed_conference_personas` run against the backend it drives).

## Tickets and scanning (`scanning.py`, `ticket_views.py`) — CONFERENCE-BRIEF.md §3.D

`EventAttendance.ticket_token` (opaque, 32 chars of `secrets.token_urlsafe`, unique, **null until
the row first holds a seat**), `EventAttendance.checked_out_at`, and the append-only `ScanEvent`.
Migration `0011_tickets` is the ONE `events` schema change the seven parallel conference branches
were allowed (§4 rule 1).

- **The QR carries the token and nothing else** — no name, no id, no event, no signature. A QR is
  photographed by whoever is behind you. Opaque is worth one database lookup and nothing more; a
  signed token would only buy offline validation, which is deliberately not built.
- **The scanner never decides.** It caches `checkin-list` so it can show a name with no network,
  queues scans in IndexedDB and syncs them in **batches**; `apply_batch` decides. A phone that
  decided for itself would disagree with the phone next to it.
- **`client_nonce` is the idempotency key**, generated by the client when the scan happens. A
  nonce already stored returns its own row unchanged, so a retried batch never scans anybody twice.
- **`apply_batch` is one `transaction.atomic()`** (`backend/CLAUDE.md` rule 2), ordered by the
  client's own clock so an exit cannot land before the entry that preceded it. `client_at` is used
  for the stamp but **clamped to `now`** — a phone's clock may run fast, and a check-in in the
  future reads as one that has not happened.
- **`collision` is a same-window fact.** Two entries for one token inside one batch flag the later
  one; across two batches the first is durable state and the second is only `already_in`. Stated as
  a limit rather than papered over with a time heuristic that would make a genuine second tap look
  like fraud.
- **`already_in` is the "nothing changed" word for BOTH directions** (in when already in, out when
  never in). The vocabulary §3.D fixes has one word for it; `direction` rides on the row and the
  frontend reads two different sentences off the pair.
- **First entry sets the existing `checked_in_at`**, so `RegistrationsPanel` and the CSV keep
  working unchanged; `check_in()`'s undo clears `checked_out_at` too, or a row could leave without
  ever arriving.
- **Issuance is hooked into the transitions in `registration.py`, not a signal.** `QuerySet.update()`
  fires no signal, and the seat machinery uses it — so a signal would skip exactly the paths that
  matter. The cost (a status changed in the admin or a shell mints nothing) is stated in
  `ensure_ticket`'s docstring and corrected by `my-ticket`, which calls it too. A rotated token
  replaces the old one in place; past `ScanEvent`s keep the string they actually saw.
- **What each endpoint may know.** `checkin-list` (any staff) is `token, first name + last initial,
  status, in/out` — no ids, no contact data, because a volunteer's phone in a corridor is the least
  trusted copy of a guest list this system produces. `scans` GET (organisers) masks names too. The
  **sixth** endpoint, `badge-sheet` (organisers), is the one place the minors' rule is applied —
  a badge for somebody under 16 prints `Anna K.` and a coloured band. §3.D did not list it; it
  exists because the badge sheet cannot be built from `checkin-list` without masking every adult or
  un-masking every minor.
- Behind **both** `events` and `tickets`. With `tickets` off, check-in by button is untouched.

## Verify

`manage.py test events` (refusal-weighted; `test_tickets.py` is the door's own suite) + the
availability half in `booking/tests.py`. E2E: `events-and-nav.mjs`, `event-tickets.mjs`,
`known-issues.mjs`.
