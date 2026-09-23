# venues — buildings, rooms, room bookings and the checklists a building hands an organiser

Conference step A (`CONFERENCE-BRIEF.md` §3.A), built on `conf/a-venues`. Eight models, one rule
module, one flag: `venues`.

## Why this is an app and not fields on `events.Event`

A venue outlives every event held in it, has administrators who are not anybody's event staff, and
says no for reasons that have nothing to do with the event asking (the room is taken; the headcount
is over the fire capacity; the building is closed). `Event.venue` + `Event.room` would model the one
case a lecture theatre is used once and nothing about the case it is used forty times a term.

**The event ↔ venue link IS the `RoomBooking` row.** That is what lets `events` keep an untouched
schema (`CONFERENCE-BRIEF.md` §4 rule 1) — and it is also the honest shape: an event may ask two
buildings, be refused by one and hold the other's answer, which a nullable FK cannot express.

## The one place `events` depends on this app

`EventViewSet.update` calls `venues.access.publish_block_reason(event)` — one import, inside the
method, when the request is `draft → published`. Nothing else in `events` knows this app exists.
The rule: **an event that has been given a room cannot be announced while a mandatory line of that
building's checklist has not even been started.** `in_progress` does not block
(`SETTLED_ITEM_STATUSES`) — somebody is on it, and this is a gate on acknowledgement, not on
progress.

It answers `None` — silently, deliberately — in three cases:

1. the `venues` flag is off. House rule 3 read the strict way: a killed feature removes itself, it
   does not leave a lock behind on somebody else's surface. There is a test for exactly this.
2. the event has no **approved** booking. An event with no venue publishes precisely as it did
   before this app existed. A merely `requested` booking blocks nothing — asking is not having.
3. the event has a room but no checklist instance for that venue. A building that hands out no list
   blocks nothing.

## Invariants

- **`seated_capacity ≤ fire_capacity`**, in `Room.clean()` so the admin and any seed command are
  held to it too. They are genuinely different numbers — chairs versus what the fire safety
  instruction permits standing — and confusing them is how a workshop with 40 chairs gets 120 people
  into a room rated for 90.
- **Two `approved` bookings on one room may not overlap.** Checked in `access.booking_block_reason`
  against the database, not by a constraint: the rule is "these intervals intersect", which no
  SQLite unique index expresses. **Half-open** — a booking ending at 12:00 does not collide with one
  starting at 12:00, or every back-to-back lecture in the timetable would be refused. Checked at
  request time *and* again at approval, because two organisers may both have asked while it was
  free.
- **A decision is ONE WHERE-anchored `update()`**, never `select_for_update()`
  (`backend/CLAUDE.md` rule 1): the loser of a double decision matches zero rows and gets 409
  `already_decided`.
- **A building cannot be left without an administrator** (409 `last_administrator`) — the same
  reasoning `EventStaff` gives for the host's own row.
- **`not_applicable` needs `na_allowed` AND a reason.** Two flags, because "you must answer this"
  and "the answer may be no" are different things: a mandatory catering item may legitimately be
  waved away when there is no catering.
- **A `requires_venue_signoff` item reaches `done` only through a venue administrator.** The
  organiser may take it to `in_progress` and no further — that is the whole point (the keys really
  were handed back, and the *building* says so).
- **A checklist instance is a SNAPSHOT.** `ChecklistInstanceItem` carries its own copy of every
  word; there is no FK to the template item. A template edit bumps `ChecklistTemplate.version` and
  is *offered* (`POST /checklist-instances/{id}/sync/`), never applied. The honest cost, stated in
  `services.sync_new_items`: a building that *renames* a line produces a second item rather than an
  edit, because matching is by `(order, title_en)`. The alternative would overwrite an item somebody
  has already ticked and signed, which is the thing this shape exists to refuse.
- **Nothing is hard-deleted.** A venue, a room and a template are deactivated; a rejected or
  withdrawn booking is a state (house rule 12).

## Who may do what

`access.py` is the only place that answers this, and every pk-addressed action asks it explicitly —
a queryset filter never runs for an id in a URL (house rule 4).

| | administrator | porter | event organiser | anyone |
|---|---|---|---|---|
| read the building, its rooms, its templates | ✓ | ✓ | ✓ | ✓ |
| read the staff list, the booking queue | ✓ | ✓ | — | — |
| edit rooms, decide bookings, write templates | ✓ | — | — | — |
| ask for a room, withdraw the request | — | — | ✓ | — |
| read the event's checklist | ✓ | ✓ | ✓ (event staff) | — |
| tick an item | ✓ | — | ✓ | — |
| tick an item the building signs off | ✓ | — | — | — |

Platform `is_staff` counts as an administrator everywhere, because that is how a building's *first*
administrator is granted (`CONFERENCE-BRIEF.md` §6.4 — no self-service "claim this building"). A
venue itself is created by platform staff only.

## Refusals are words, not booleans (house rule 6)

`bad_times` `room_closed` `over_fire_capacity` `room_busy` `already_decided` `not_allowed`
`last_administrator` `already_started` `venue_required` `no_such_template` `na_not_allowed`
`na_reason_required` `needs_venue_signoff` `no_signoff_needed` `checklist_pending`.

`room_busy` and `room_closed` are **409** (the world moved); everything else is **400** (the request
was wrong when it was written) or **403** (`not_allowed`). The frontend has a line for each in
`VENUE_BLOCK_LABELS` (`frontend/src/lib/utils/labels.ts`).

## The four seeded templates

`migrations/0002_seed_default_templates.py` — the bilingual starter checklists from
`CONFERENCE-RESEARCH-REPORT.md` §6.4 and its Polish appendix, as **platform defaults**
(`venue = NULL`), so the feature is useful to the first building that signs up and has written
nothing. Idempotent by `(venue IS NULL, name)`.

**Both reports' legal citations are unverified** (`CONFERENCE-BRIEF.md` §1). Nothing here turns a
citation into code: the templates are a building's starting point for a conversation with its own
administration, and every item is editable.

Item text lives in **two columns** (`title_en` / `title_pl`), not in a translation table — the one
deliberate departure from the project's shape 1. A translation row exists because the *community*
submits and reviews translations of content; a checklist item is a rule the building wrote, in the
two languages this platform speaks, edited by the building. A review workflow over "zdanie kluczy na
portierni" would be machinery with nobody to run it.

## Due dates

`ChecklistInstanceItem.computed_due_at` is stored, and re-derived by `services.recompute_due_dates`
when somebody reads the checklist — not by a signal on `Event`. A signal would fire on every save of
every event on the platform to answer a question that matters for the handful that have a checklist,
and `events` is an app this one may not add machinery to. Storing it is what makes "this was due
yesterday" something the list can sort by; `anchor='end'` is what makes "T + 1 day" land after a
two-day conference finishes rather than the day after it opens.

## The kill switch

`feature_gate('venues')` on every viewset, with the usual `is_staff` bypass. Off: the whole
`/api/venues/`, `/api/rooms/`, `/api/room-bookings/`, `/api/checklist-*` surface 403s a non-staff
caller, the two panels and the footer link disappear (the panels check the flag **themselves**
rather than being wrapped in `FeatureGate` — that component renders an "unavailable" notice, which
is right for a route and wrong for a panel; with the switch on the event page it grew two grey
paragraphs mid-page, found by looking at an e2e screenshot), and `/api/events/` keeps working
untouched.

## Verify

`../.venv/bin/python3 manage.py test venues events` (53 venue tests, refusal-weighted; the `events`
half covers the publish path this step edits). E2E: `frontend/e2e/venues.mjs` (31 checks).

## Left open

- **Evidence files.** `ChecklistInstanceItem.evidence_file` exists and carries
  `validate_material_submission_file`, but no endpoint accepts a multipart write yet, and the panel
  says so instead of pretending. Step C builds the protected-file endpoint this should reuse.
- **No notification** when a booking is decided. `notifications.notify()` is the right home for it;
  nothing here writes one yet, so an organiser finds out by looking.
- **A calendar of a building across events**, recurring bookings, and a session ↔ room link — all
  named as out of scope in `CONFERENCE-BRIEF.md` §3.A and §7.
- **Venue administrators are added by account id**, because there is no people search (root
  `CLAUDE.md`, known gaps).
- **`ChecklistTemplate` has no editor on the frontend.** A building writes its own templates through
  the API or the Django admin; `/venues/[slug]/manage` lists them read-only.
