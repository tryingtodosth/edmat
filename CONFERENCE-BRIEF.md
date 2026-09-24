# Conference management — the design, and the seven parallel steps

Written 2026-09-23 from the two Gemini Deep Research reports (`CONFERENCE-RESEARCH-REPORT.md`,
`CONFERENCE-RESEARCH-REPORT-SHIFTS.md`) answering `CONFERENCE-RESEARCH-PROMPT.md`. Reconciled here:
what is accepted, what is rejected and why, and how it is cut into seven steps that seven agents
build **at the same time** on seven branches. Read §4 before touching anything — it is the set of
rules that lets seven branches merge.

Status: **§0 (this note, the flags, the mount points) landed on `ux-and-whiteboard`. Steps A–G are
on the shared todo board.** `HISTORY.md` §17BF is where each step records what it built.

---

## 0. Where we stand

The events app is already a light conference system: `Event` (draft / published / cancelled,
multi-day via `runs_until`), `EventStaff` (organiser / reviewer / volunteer, the host immutable),
a programme (`Track`, `Session`, `SessionSpeaker`, `SessionLink`, `SessionBookmark`, `.ics`),
registration (`EventAttendance` as the engine: rsvp / approval / form, waiting list with a 24 h
offer, per-session seats, check-in by any staff member, CSV export) and a call for contributions
with single-blind review. Read `backend/events/CLAUDE.md` and `HISTORY.md` §17AM–§17AO.

What is missing, in the reports' words and ours: a **venue** as a thing with its own
administrators, rooms and rules; a **checklist** the building hands the organiser; **documents**
on an event that only some roles see, with an acknowledgement that unlocks a volunteer's tools;
a **ticket** with a QR code and a **scanner** that works when the Wi-Fi does not; a **rota**, so
that a volunteer is a person at a place for an hour and not a badge; a **cloakroom**; exports that
give catering counts and not people; and a way to **see the page as a stranger** and to prove the
permission matrix rather than believe it.

**Since 2026-09-24 there is also a lived-in demo**: `manage.py seed_conference_demo` builds "Dni
Dydaktyki Fizyki 2026" on top of the personas — a venue with bookings and a checklist, documents
in every tier, a programme, 146 registrations with tickets and a day-one door log, a rota with a
minor on it, a cloakroom with coats on the racks. `HISTORY.md` §17BK; the research answer it was
meant to come from is `CONFERENCE-RESEARCH-REPORT-DEMO.md`, which mostly did not.

## 1. The reports, reconciled

Accepted, with the step that builds it:

| Decision | From | Step |
|---|---|---|
| Role presets, never a checkbox permission editor. Volunteer sub-kinds are **stations on the rota**, not new `EventStaff` roles — a person is a volunteer; where they stand today is an assignment. | R1 §1.2, R1 decision 1 | E |
| Venue as a first-class object with its own administrators, rooms with a seated and a fire-evacuation capacity, room booking as a request the venue approves. | R1 §3.4, decision 6 | A |
| Checklist template → instance by **snapshot on instantiation**; items carry owner role, T±offset, mandatory, N/A-with-reason, evidence, venue sign-off. Four seeded bilingual templates from the report. | R1 §3.3, decision 7 | A |
| Documents with four visibility tiers; an acknowledgement ledger keyed by document version; volunteer tools locked until the event's mandatory briefings are acknowledged. | R1 §3.5, §4.1 | C |
| Opaque random ticket token, never PII in the QR; scanner caches the list, queues scans, syncs in **batches** with a client nonce; the earlier scan wins, the later is flagged a collision; entry/exit modes; name lookup and typed code as fallbacks. | R1 §2.2, decisions 2 and 4 | D |
| Ticket delivered on a page and as a printable sheet; no wallet passes. | R1 §2.3, decision 3 | D |
| No per-session door scanning; session capacity stays a registration rule. | R1 §2.4, decision 10 | — |
| Cloakroom by **anonymous bearer token**, item never linked to a person; lost-token exception flow records an identity; reconciliation at close. | R1 §2.1, decision 5 | F |
| Rota: station → shift → assignment; **self-claim within invariants** plus organiser assignment; **drop-to-pool with a cutoff** rather than mandatory bilateral swaps; passive hours logging confirmed by an organiser, not a kiosk; a printable certificate. | R2 §2, §6 decisions 1, 2, 4 | E |
| Minors on the rota: no station unless `minors_permitted`, an adult on the same shift where `requires_adult`, no shift touching 22:00–06:00, a daily cap, guardian consent recorded. | R2 §2 | E |
| Role-scoped exports: catering and accessibility as **aggregates only**; a door list with name and status only; the full export organiser-only and audit-logged. Retention: operational rows purged on a schedule, said honestly as a command. | R1 §4.2, §4.3 | G |
| Role **preview** and seeded **personas**, never "log in as". A parametrised permission-matrix test. | R1 §5, decision 8 | B |
| Badges for minors: first name and last initial, no ids, a distinct visual. | R1 §2.5, decision 9 | D (the printable sheet) |

Rejected or narrowed, and why:

- **Badge-token authentication** (R2 do-not-build table). EdMat has accounts and token login; a
  volunteer signs in as themselves. R2's own decision 5 concedes it breaks pre-event scheduling.
- **"Do not build in-app messaging"** (R2). It exists (`messaging/`), and a minor cannot message or
  be messaged by server rule. What we keep from the argument: **no chat inside the rota, and no
  volunteer sees another volunteer's contact data** — a supervisor is reached through the
  organiser desk line on the shift, and the existing messaging app if both are adults.
- **Under 18 as the minor line** (R2). EdMat's line is **under 16** (`accounts/minors.py`,
  `Profile.is_minor`, GDPR Art. 8 as transposed). The rota reads `is_minor`; the 8 h / 7 h / 22–06
  / 14 h numbers are R2's Labour-Code-by-analogy inference, adopted as **defaults an organiser
  cannot loosen**, not as statute. `LEGAL.md` gets a paragraph saying exactly that.
- **`is_sandbox` on Event, `PreviewUser` proxies, an impersonation audit table** (R1 §5). No
  impersonation is built, so nothing to audit; personas are ordinary accounts on ordinary events
  with `.example` usernames and a seed command that is idempotent.
- **WeasyPrint / server-rendered PDFs** (R1 §2.3). A print stylesheet on a plain page is the
  printable sheet; the browser makes the PDF. No new binary dependency.
- **Ed25519 signed tokens** — the report itself prefers opaque; opaque it is.
- **WAL / busy_timeout pragmas** — already the project's SQLite posture (`backend/CLAUDE.md`);
  the batch endpoint is what matters.
- **Venue-only document tier** — the tier exists (`venue`), readable by the venue's
  administrators once step A lands; step C ships it as a tier only organisers see until the
  integration wires `venues.access.is_venue_admin` in (§5).
- **Guardian consent scan upload for volunteers, RSPTS/KRK vetting records** (R2 §4). Kept as
  **fields an organiser fills** (consent recorded on / by whom; vetting checked on / reference),
  never a file of a criminal record certificate on this server.
- **Reviewer scores, auto-schedulers, wallet passes, native apps, WebSockets** — no.

Both reports' legal citations are **unverified** (the paste dropped them). Nothing here turns a
citation into code; where a number is a default it is labelled a default.

## 2. Shared shapes every step uses

- **Authority** is asked of `Event.role_of / can_organise / is_staff_member` and, for a venue, of
  `venues/access.py` (step A). A new endpoint never re-derives a role (house rule 2 of the shape
  list; boundary 2 in `CLAUDE.md`).
- **Visibility is a queryset filter, authority an object check** (house rule 4). A stranger gets
  404 for a draft event's anything.
- **Every new surface is behind a `FeatureFlag`** — all six keys are seeded in §0: `venues`,
  `event_documents`, `tickets`, `shifts`, `cloakroom`, `role_preview`. A step checks its own key
  through `feature_gate`, hides its own links, and its neighbours keep working with it off
  (house rule 3).
- **A refusal carries its reason** (house rule 6): `claim_block_reason`, `deposit_block_reason`,
  `scan_result` are words, and the frontend has a line for each.
- **Recount, never increment** (house rule 5): coverage, seats, racks, hours are `COUNT`s.
- **Tombstone, don't delete** (house rule 12): a cancelled assignment, a rejected booking, a
  returned coat are states.
- **No email** — every notification is the existing in-app `notifications` app; anything the
  report says an email would carry is a page.
- **Pictures and files** through `imaging.py` / the materials PDF path (house rule 7).
- **New enums mirrored into `labels.ts`** say so in both files (house rule 13).

## 3. The seven steps

Each step is one agent, one branch `conf/<letter>-<name>`, one worktree, one board entry. Each is
**full stack**: models + migrations + rule module + serializers + views + tests (refusals first),
`lib/types` + `lib/services` + components + route, both message catalogues, an e2e script run with
the real servers up and a screenshot looked at, a `backend/<app>/CLAUDE.md`, a `HISTORY.md`
§17BF.<letter> section with "Verified" and "Left open", and the board entry moved to `done.md`.

### A. `venues` — venues, rooms, venue staff, room booking, checklists (branch `conf/a-venues`)

New app **`venues`**. Models: `Venue(name, slug, address, contact_note, security_phone, is_active)`,
`VenueStaff(venue, user, role: administrator | porter, added_by)` — porter can see and sign
handovers, administrator everything; `Room(venue, name, number, floor, seated_capacity,
fire_capacity, has_av, accessible, notes, is_active)` with `seated ≤ fire` in `clean()`;
`RoomBooking(event, room, starts_at, ends_at, status: requested | approved | rejected | cancelled,
expected_headcount, purpose, decided_by, decided_at, note)` — the event ↔ venue link **is the
booking**, so `events` needs no migration; two approved bookings on one room may not overlap
(checked in the rule module against the DB, a 409 with `room_busy`); `expected_headcount >
fire_capacity` is a refusal with `over_fire_capacity`. `ChecklistTemplate(venue nullable = platform
default, name, description, version, event_kind_hint, is_active)`, `ChecklistTemplateItem(template,
title_en, title_pl, description_en, description_pl, owner_role: organiser | venue, due_offset_minutes
signed relative to event start (negative) or end (positive, flagged by `anchor: start | end`),
is_mandatory, na_allowed, evidence_kind: none | file | link | text, requires_venue_signoff, order)`,
`ChecklistInstance(event, venue, template, template_version, created_at)` (one per event + venue),
`ChecklistInstanceItem(instance, copied fields, computed_due_at, status: pending | in_progress |
done | not_applicable, na_reason, evidence_text, evidence_url, evidence_file, done_by, done_at,
signed_off_by, signed_off_at)`. Invariants: `not_applicable` needs `na_reason` and `na_allowed`;
`requires_venue_signoff` items reach `done` only through a venue administrator; the instance is a
**snapshot** — a later template edit bumps `version` and offers "add the new items" to open
instances, never overwrites. **An event whose booking is approved cannot leave `draft` while a
mandatory item is `pending`** — implement as `venues/access.py: publish_block_reason(event)` and
call it from the existing publish path (one small edit in `events/views.py`; say so in a comment).

Rule module `venues/access.py`: `is_venue_admin(user, venue)`, `can_manage_room(user, room)`,
`booking_block_reason(event, room, starts, ends, headcount)`, `publish_block_reason(event)`.
Seed the four bilingual templates from R1 §6.4 as platform defaults in a data migration.

API: `/api/venues/` (public list of active venues, detail with rooms), `/api/venues/{id}/staff/`,
`/api/rooms/`, `/api/room-bookings/` (an organiser requests for their event; a venue admin
`approve` / `reject` with a note; the organiser `cancel`), `/api/events/{id}/checklist/` (the
instance, items, `PATCH` an item, `sign-off`), `/api/checklist-templates/` (venue admins).

Frontend: `/venues`, `/venues/[slug]` (rooms, capacities, accessibility, the templates it hands
out), `/venues/[slug]/manage` (staff, rooms, templates, the booking queue), a **Venue panel** on
the event page (mount point `<!-- conference: venue -->`) — the organiser picks a venue and room,
requests, sees the decision; a **Checklist panel** (mount point `<!-- conference: checklist -->`)
with the items grouped by due date, N/A with reason, evidence, the venue's sign-off state, and the
publish block spelled out. "Venues" goes in the **Add…** menu for staff of any venue only; the
`/venues` browse link goes in the footer, not the nav.

Not in A: a physical access-card integration; recurring bookings; a calendar of the building.

### B. `preview` — personas, view-as-a-visitor, the permission matrix (branch `conf/b-preview`)

No new app with models. Three deliverables.

1. **`manage.py seed_conference_personas`** (in `events/management/commands/`): idempotent; makes
   `persona.organiser@edmat.example`, `persona.reviewer@…`, `persona.volunteer@…`,
   `persona.attendee@…`, `persona.guardian@…` with a child `persona.child` (via the guardian
   flow, so `is_minor` is real), `persona.stranger@…`; one published multi-day event "Sandbox
   conference" with a programme, an open call, a form registration, the attendee registered and
   checked in, the volunteer on staff, one pending contribution. Password from `--password`,
   default `persona-pass-2026`. Prints a table of who can do what. Re-running updates rather than
   duplicates. `testing/` gets a fixture helper other tests can call (`make_personas()`).
2. **"View as a visitor"** on the event page (mount point `<!-- conference: preview -->`): a
   toggle for staff that re-fetches the event, programme, roster and contributions **with no
   token** and renders the page from those responses, with an unclosable amber bar "Viewing as
   a signed-out visitor — nothing here can be changed" and every action control hidden; a second
   option "as somebody going" that only *hides* controls the API says an attendee lacks (`can_*`
   fields) and is labelled as a layout preview, not a permission check. Implement via one
   `client.ts` option (`anonymous: true`) that omits the header — the only fetch stays in
   `client.ts`. Behind the `role_preview` flag.
3. **`events/test_permission_matrix.py`**: one table `(persona, method, path, body, expected
   status)` × the existing events endpoints (event CRUD, staff, programme writes, registrations
   list, check-in, contributions decisions, export), driven through `subTest`; strangers get 404
   on drafts, attendees 403 on staff lists, volunteers 403 on decisions. Every row that fails
   today is a bug: fix it in the same branch and name it in the history section. A `README`
   comment tells steps A, C–G to add rows for their endpoints at integration.

Also B: `lookup_value_regex = '[0-9]+'` as a router-level default (the todo board's "found beside
the feature" item) — the matrix will hit `/api/<thing>/undefined/` on purpose.

### C. `documents` — event documents with visibility tiers and acknowledgements (branch `conf/c-documents`)

New app **`documents`**. `EventDocument(event, title, kind: file | link, file, url, visibility:
public | attendees | staff | organisers | venue, requires_acknowledgement, version, uploaded_by,
created_at, replaced_by nullable)` — replacing uploads a new row with `version + 1` and points the
old one at it (tombstone, history kept); `DocumentAcknowledgement(document, user, version,
acknowledged_at)` unique per (document, user, version). Files: PDF, images, plain text, `.ics`,
`.docx`? — **PDF and images only** in this step, through the existing size cap + sniff + ClamAV
path for PDFs and `imaging.py` for images; stored under a random name; served by a **protected
endpoint** that checks the tier (404 to anyone below it), never a static URL.

Rule module `documents/access.py`: `visible_tiers_for(user, event)` (anonymous → public;
`going`/`promoted` → attendees; `is_staff_member` → staff; `can_organise` → organisers; `venue`
answered by a hook `venue_admin_check` that defaults to organisers-only and is wired to
`venues.access.is_venue_admin` at integration), and **`missing_acknowledgements(user, event)`** —
the list of mandatory documents the user has not acknowledged at their current version. Wire it
into the existing **check-in** action (`events/registration_views.py`, one guard: a volunteer with
missing acknowledgements gets 409 `briefing_unread` with the document ids) — that is the "tools
lock until the briefing is read" rule, and steps D and F call the same function at integration.

API: `/api/events/{id}/documents/` (list filtered by tier; organisers POST multipart or a link),
`/api/documents/{id}/` (PATCH title / tier / requires_acknowledgement, DELETE = tombstone),
`/api/documents/{id}/file/` (the bytes, tier-checked), `/api/documents/{id}/acknowledge/`,
`/api/events/{id}/acknowledgements/` (organisers: who has read what, per version).

Frontend: a **Documents panel** on the event page (mount `<!-- conference: documents -->`):
grouped by tier with a tier chip, upload/link form for organisers, "Read and understood" button
where required, the organiser's read-receipt table; a **briefing interstitial** component that the
check-in panel shows when the API says `briefing_unread` — the document opens inline (pdf.js
lazily, house rule 11), the button acknowledges, the action retries.

### D. `tickets` — the ticket, the QR code, the scanner, the badge sheet (branch `conf/d-tickets`)

**The only step allowed an `events` migration** (`0011_tickets`): `EventAttendance.ticket_token`
(32 chars, `secrets.token_urlsafe`, unique, set when a row first becomes `going`/`promoted`, blank
otherwise; a `rotate` action for "I forwarded it by mistake"), `EventAttendance.checked_out_at`,
and a new model `ScanEvent(event, attendance nullable, token_seen, direction: entry | exit,
result: admitted | already_in | not_going | unknown | exited | collision, client_nonce unique,
client_at, received_at, scanned_by, device_label, is_offline_sync)` — append-only. Rule module
`events/scanning.py`: `apply_scan(event, user, payload) -> ScanEvent` implementing R1's rules:
first entry admits and sets `checked_in_at` (the existing field, so the RegistrationsPanel keeps
working); a second entry without an exit is `already_in`; exit sets `checked_out_at`; an unknown
token is `unknown`; a `pending`/`waitlisted` row is `not_going`; a nonce seen before returns the
stored row unchanged (idempotent). `apply_batch(event, user, scans)` orders by `client_at`,
applies each, and marks a later one for a token already admitted in the same window as
`collision`. **One `transaction.atomic()` per batch** (`backend/CLAUDE.md`'s SQLite rules).

API: `GET /api/events/{id}/my-ticket/` (token + the fields the sheet prints), `POST …/my-ticket/rotate/`,
`GET /api/events/{id}/checkin-list/` (staff: `[{token, first name, last initial, status,
checked_in_at}]` — no ids, no contact data), `POST /api/events/{id}/scans/` (a list; returns one
result per nonce), `GET /api/events/{id}/scans/` (organisers: the log, counts in / out / now
inside as `COUNT`s). Behind `tickets`; with it off, check-in by button keeps working.

Frontend: `/events/[id]/ticket` — the QR (`qrcode` npm, lazily), the short code under it, the
event's when/where, a print stylesheet that makes an A6 badge; **minors' tickets print first
name + last initial only and a coloured band** (`is_minor` comes from `/auth/me/` for self or the
guardian's child list). `/events/[id]/scan` (staff): camera scanning (`@zxing/browser` or `jsQR`,
lazily; assert absence from the entry bundle like KaTeX), entry/exit switch, typed code, name
search over the cached list, a big green / amber / red result with the reason in words, the
queue length, "last synced", and the offline queue in IndexedDB flushed every 5 s and on
reconnect; **the list is cached on open** so scanning works with no network. Organisers get a
**Badge sheet** page `/events/[id]/badges` (A4 grid of the going list, print stylesheet) linked
from the RegistrationsPanel. Mount `<!-- conference: ticket -->` on the event page for the "My
ticket" / "Scan" / "Badges" links.

### E. `shifts` — stations, shifts, assignments, hours, certificates (branch `conf/e-shifts`)

New app **`shifts`**. `Station(event, kind: door | room | info | cloakroom | runner | setup |
other, name, location_text, session nullable, briefing_note, minors_permitted, requires_adult,
needs_confirmation, order)`; `Shift(station, starts_at, ends_at, needed, note)` — a shift on a
station with a `session` is created from the session's time and **moves when the session moves**
(a signal on `Session` save; say so in the docstring); `Assignment(shift, user, status: offered |
claimed | confirmed | dropped | no_show | done, source: self | organiser | pool, claimed_at,
confirmed_by, dropped_at, drop_reason, hours_credited decimal nullable, credited_by)`;
`VolunteerRecord(event, user, consent_recorded_at, consent_recorded_by, consent_note,
vetting_checked_at, vetting_reference, emergency_contact_note)` — organiser-filled fields for the
R2 §4 artefacts, no files. Hours are derived: a `done` assignment credits the shift's length unless
`hours_credited` overrides it (organiser, with a note when it differs by more than 30 min).

Rule module `shifts/rules.py`: `claim_block_reason(user, shift)` returning one of `not_volunteer`,
`shift_full`, `overlap`, `too_close` (< 15 min gap), `minor_station`, `minor_night` (touches
22:00–06:00 local), `minor_daily_cap` (> 7 h in a calendar day for `is_minor`), `needs_adult` (no
confirmed adult on the shift yet — offered as `claimed` pending an adult, not refused, when the
station `requires_adult`), `needs_confirmation`, `event_over`; `drop_block_reason` (`cutoff` when
< 4 h before start — the organiser can still drop anyone); `coverage(event)` — per shift
`needed`, `confirmed`, `claimed`, `is_short`. Who may claim: an `EventStaff` volunteer (any role
may be assigned by an organiser). Minors: a volunteer with `is_minor` **cannot claim** until a
`VolunteerRecord.consent_recorded_at` exists.

API: `/api/events/{id}/stations/`, `/api/stations/{id}/shifts/`, `/api/shifts/{id}/claim/`,
`…/drop/`, `…/assign/` (organiser, user id), `…/confirm/`, `…/no-show/`, `…/done/` (with optional
hours), `/api/events/{id}/coverage/`, `/api/events/{id}/my-shifts/` (+ `.ics`, reusing
`events/ics.py`), `/api/events/{id}/volunteers/` (organiser: the records), `/api/my-volunteering/`
(across events: hours by event, for the certificate). Behind `shifts`.

Frontend: **Rota panel** on the event page (mount `<!-- conference: rota -->`): for a volunteer,
"My shifts" and "Open shifts" with the block reason in words on a disabled Claim; for an
organiser, the **coverage grid** (stations × the event's hours, cells green / amber / red by
`is_short`, click to assign by account id — the people-search gap is known), station editor,
volunteer records, no-show / done marks, hours override. `/volunteering` (account menu): every
event's hours and a **printable certificate** page per event (`/events/[id]/certificate`), Polish
and English on one sheet, the organiser's name, unsigned — it says "issued by the organiser through
EdMat, request a signed copy from …". A **wall rota** print view (`/events/[id]/rota`) for staff.
No contact data of any volunteer is ever in a volunteer-facing response — first name + last
initial only; the organiser desk location comes from `Station.location_text` of kind `info`.

### F. `cloakroom` — the desk (branch `conf/f-cloakroom`)

New app **`cloakroom`**. `CloakroomDesk(event, name, rack_labels: list of strings, opens_note)`;
`CloakroomItem(desk, rack_label, token (8 chars, `secrets`, unique among `stored` per desk),
status: stored | returned | unclaimed | returned_by_exception, description, deposited_by,
deposited_at, returned_by, returned_at, exception_note, exception_identity_kind: none |
student_card | id_document | account, exception_verified_by)` — **no FK to a person** for the
item; the exception path stores a `description` and the identity *kind*, not a document number.
Rule module `cloakroom/rules.py`: `deposit_block_reason` (`rack_taken`, `desk_closed`,
`not_staff`), `return_result` (`returned`, `unknown_token`, `already_returned`, `blacklisted`);
a lost token is blacklisted for the desk when the exception return happens; `reconcile(desk)`
marks every `stored` item `unclaimed` at close and returns the list.

API: `/api/events/{id}/cloakroom-desks/`, `/api/cloakroom-desks/{id}/items/` (staff; deposit
returns the token), `…/items/{id}/return/`, `…/items/{id}/return-by-exception/`,
`…/reconcile/`, `…/export/` (CSV: rack, token, status, times — no names). Behind `cloakroom`.
Who may operate: any `EventStaff` member (the station kind lands with E; at integration a
`cloakroom` station assignment becomes the check).

Frontend: `/events/[id]/cloakroom` (staff): a two-button desk — **Deposit** (pick a free rack from
a grid, print / show the token as a QR and a large number on the ticket slip, a print stylesheet
for a 60 mm slip) and **Return** (camera or typed token, `@zxing/browser` lazily, the result in
words); the exception dialog; the rack grid as the live state; **Close the desk** with the
reconciliation list and the CSV. Mount `<!-- conference: cloakroom -->` on the event page for the
staff link and the "There is a cloakroom at …" line for attendees.

### G. `exports` — data minimisation, exports, retention (branch `conf/g-exports`)

No new app; a module `events/exports.py` and a management command. Deliverables:

1. **Tighten the existing responses per R1's table**: `GET /registrations/` for a *volunteer*
   returns name, status, checked-in only (no `answers`, no contact); organisers keep everything.
   The public roster stays as it is.
2. **Aggregated exports**: `GET /api/events/{id}/exports/needs/` — counts by attendance mode and
   by accessibility need (the baseline reserved keys) and, per organiser-defined choice field,
   counts per option, **no rows**; `GET …/exports/door-list.csv` — name, status, checked-in;
   the existing full CSV stays organiser-only and now writes an `ExportLog(event, user, kind,
   rows, created_at)` row; `GET …/exports/log/` lists it.
3. **Retention** as `manage.py purge_event_data --older-than-days N [--dry-run]`: for events that
   ended more than N days ago (default 30), blank `EventAttendance.answers`' accessibility key and
   free-text answers, null `checked_in_by`, and print what it did; **never touches** who attended
   or the programme. A `RETENTION_NOTE` in `events/exports.py` names the tables steps D and F add
   (`ScanEvent`, `CloakroomItem`) as the next ones the command should learn at integration.
4. `LEGAL.md` gets §"Event data: who sees what, and for how long" — the role table and the purge
   schedule, with the unverified-citation caveat.
5. Frontend: the organiser's **Exports card** inside `RegistrationsPanel` (needs summary
   rendered as a small table, the two downloads, the export log) — this is the one step that
   edits `RegistrationsPanel.svelte`; D links its badge sheet from the same panel, so **G adds a
   `<!-- conference: exports -->` marker inside the panel's header area and D's link goes below
   the existing CSV button**, different lines.

## 4. Rules for building seven branches at once

These exist because seven agents share one repo and one `events` app.

1. **One new app per step (A, C, E, F), no `events` migration except D's `0011`.** Anything that
   would be a field on `Event` is a row in your app pointing at it. If you truly need an `events`
   schema change, stop and write it on the board instead.
2. **Feature flags are already seeded** (six keys, `moderation` migration `0043`, both frontend
   files, both catalogues). Do not add a key; do not touch `moderation/migrations`.
3. **The event page has mount points**, one HTML comment per step, each separated by a blank
   line: `venue`, `checklist`, `documents`, `ticket`, `rota`, `cloakroom`, `preview`. Replace
   **your own marker line only** with your component; imports go in the script block **in a new
   line right after `import EventStaffPanel …`**, one import per step. Do not reorder anything on
   that page.
4. **i18n keys are prefixed by step**: `venues_*`, `checklist_*`, `preview_*`, `documents_*`,
   `tickets_*`, `shifts_*`, `cloakroom_*`, `exports_*`; add them as **one contiguous block at the
   end of each catalogue**, both files, identical key sets (house rule 1). The integrator
   concatenates the blocks; a key outside your prefix is a merge conflict you caused.
5. **`labels.ts`**: add your enum maps at the end of the file under a comment naming your
   backend module. Nothing else in that file.
6. **Nav**: no step touches the header nav. Account-menu and Add-menu items go through the
   existing menu components by appending one entry at the end of the list, behind your flag.
7. **`HISTORY.md`**: append your section `## 17BF.<letter> …` at the very end. `CLAUDE.md`'s app
   list is edited by the integrator only. `test.md` gets one paragraph per step, at the end.
8. **Boards**: your `doing.md` entry is already written with your branch and worktree. When you
   finish, move it to `done.md` (top) with the commit hash and what you actually ran; re-read the
   file immediately before editing it, and write it in one process (a small Python script), because
   six others edit the same files. Anything you leave open goes to `todo.md` under your heading.
9. **Verify by running** (house rule 2): `manage.py test <yourapp> events`, `manage.py check`,
   `makemigrations --check --dry-run`, `npm run check` (0/0), `npm run lint`, `npm run build`,
   and your e2e script against real servers — **start them on your own ports** (`run.sh`
   assigns; do not fight another worktree's ports) and look at the screenshot. Say in the board
   entry exactly what you ran.
10. **Commit on your branch, never push, never merge.** The integrator merges A–G into
    `ux-and-whiteboard` in the order B, G, C, D, A, E, F and wires the three cross-step hooks
    (§5). Do not rebase onto anything after you start.
11. **Absolute paths always.** Your shell's cwd is not reliable across calls; every command
    names your worktree.

## 5. Integration, after the seven land

Merge order B → G → C → D → A → E → F (smallest blast radius first; E and F call C's gate and A's
role). Then, on `ux-and-whiteboard`:

- wire `documents.access.venue_admin_check` to `venues.access.is_venue_admin`;
- gate D's `/scans/` and F's deposit/return behind `documents.access.missing_acknowledgements`
  (the same 409 `briefing_unread` C used for check-in);
- make F's "who may operate" ask E for a confirmed `cloakroom` station assignment when the event
  has one, staff membership otherwise;
- add rows for every new endpoint to B's permission matrix and run it;
- teach G's purge command `ScanEvent` and `CloakroomItem`;
- update `CLAUDE.md`'s app list (23 → 27) and flag list (14 → 20), `CLAUDE_MAP.md`, `test.md`;
- run the whole backend suite, `npm run check`, `npm run build`, `check:katex`, `check:a11y`, and
  the seven e2e scripts plus `events-and-nav.mjs`, `event-registration.mjs`,
  `event-programme.mjs`, `event-contributions.mjs`;
- one `HISTORY.md` §17BF preamble tying the letters together.

## 6. Defaults in force unless Piotr says otherwise

1. Minor line is **under 16**, the rota's night window 22:00–06:00, daily cap 7 h, gap 15 min,
   drop cutoff 4 h — all constants in `shifts/rules.py`, none organiser-editable.
2. Ticket token 32 chars, cloakroom token 8 chars, batch flush 5 s, retention 30 days.
3. A volunteer sees co-volunteers as first name + last initial; never a contact.
4. Venue administrators are granted by account id by a platform staff member (admin) at first;
   a venue's own administrator may add the next. No self-service "claim this building".
5. No file of a criminal-record certificate or a consent scan is ever stored; fields only.

## 7. Left open, by design

- Session ↔ room link on `Session` (an `events` migration) — after D lands, one field.
- A calendar of a building across events; recurring bookings.
- Per-session scanning (rejected on purpose); wallet passes; native apps.
- People search — every "by account id" above waits on it.
- Legal review of both reports' citations before any of the LEGAL.md text is relied upon.
