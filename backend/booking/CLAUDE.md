# booking — availability arithmetic and sessions

Models: `AvailabilityRule` (repeating weekly pattern — belongs to the **tutor**, optionally
narrowed to one Service), `AvailabilityException` (`block` AND `open` — two kinds, not a
boolean: "and also this Saturday" is unsayable with blocks alone; openings add before blocks
subtract, all-day openings refused), `WeekTemplate`, `WeekSchedule` (+ window children),
`Booking`. Core arithmetic in `availability.py`.

## The decisions everything follows from

- `Service.availability_mode`: **`derived`** (published hours minus what's taken) vs
  **`declared`** (a fixed window that keeps showing whole — overlapping requests legal). Two
  different promises, both stated in words on screen. Default `derived` (the mode that cannot
  mislead). **The mode changes what is shown/refused, never who decides** — every booking starts
  `requested` and needs the tutor's confirmation in BOTH modes.
- **Both modes' semantics fall out of ONE function, `is_offered_slot()`** — deliberately the
  same computation the public browse endpoint uses, so a student can't craft a POST for a slot
  that isn't genuinely published. Never fork a second "does this look reasonable" check.
- A **requested** booking already holds a derived slot (`BLOCKING_STATUSES`) — first-asker holds
  it until answered (no expiry; known cost). Confirming overlapping bookings is refused in both
  modes; confirming one does NOT auto-decline rivals (the clash count shown is tutor-only —
  it's a window onto their whole calendar).
- Busy time is always computed **tutor-wide across every listing** — an hour booked through the
  physics listing must not be offered through the maths one. `Booking.tutor` is denormalized for
  exactly this query; keep it.
- `Booking.ends_at` is **stored** — changing `session_minutes` later must not retroactively
  lengthen agreed appointments. Five statuses: `declined` (tutor's answer) ≠ `cancelled`
  (either party, with `cancelled_by`); `complete` refused before the end time, never automatic.
- **`WeekSchedule` replaces the weekly pattern for its week TOTALLY** — a detached week with no
  windows publishes nothing (that's what clearing it meant). Exceptions apply on top of BOTH
  sources; the branch lives in one function (`_base_windows`) and everything downstream is blind
  to which arm ran. The stored week key is **always Monday-based** regardless of viewer
  preference (it's a lookup key; viewer week-start is a display concern).
- Events integration: **hosting** an event feeds `_busy_intervals` (removes derived hours,
  interval arithmetic — a 150-min workshop swallows every slot it covers); **attending does
  not** (an RSVP is retractable one-click and must not silently cost a tutor income). Draft/
  cancelled events block nothing; the `events` kill switch gives hours back (a kill switch whose
  side effects outlive it isn't one).

## Endpoints

`BookingViewSet` = ReadOnly + four explicit actions (request/confirm/decline/cancel) — never a
generic PATCH (it would write `status=` past every rule). Third party → 404; wrong party → 403;
wrong-status → 409. `GET /api/services/{id}/availability/` (public, student view: sliced by
session length, taken hours removed, `has_schedule` its own flag) lives in THIS app despite the
URL (services importing booking would be circular). `GET /api/my-schedule/` (tutor's own week,
every listing, both sides of their bookings, **never subtracts** — appointments drawn on top of
whole bands; deliberately disagrees with the student view about a hosted event's hour).
All times are project-TZ (UTC) — no per-user timezone exists anywhere.

## Verify

`manage.py test booking` + `test_week_schedules.py` (the slot arithmetic is pinned directly —
edge cuts, mid-window blocks, mode-vs-mode on the same calendar). E2E: `booking.mjs`,
`schedule-editing.mjs`.
