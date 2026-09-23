# shifts — the volunteer rota (station → shift → assignment)

`Station`, `Shift`, `Assignment`, `VolunteerRecord`, and one rule module every endpoint asks.
Built as `CONFERENCE-BRIEF.md` §3.E from `CONFERENCE-RESEARCH-REPORT-SHIFTS.md` (R2). Its own app
rather than more of `events`: a rota owns a lifecycle, a set of safeguarding invariants and a legal
artefact that nothing else on an event has any use for — and only step D was allowed an `events`
migration while the seven conference branches were built in parallel.

## What is deliberately NOT here

- **No swap requests.** R2's `SwapRequest` entity is replaced by drop-to-pool with a four-hour
  cutoff (its own §6 decision 2): somebody who has just fallen ill has no time to negotiate a
  bilateral trade, and software that insists on one produces an unannounced no-show instead.
- **No `HoursLog` table.** Hours are derived from a `done` assignment's own shift, with
  `Assignment.hours_credited` as the organiser's override. A second table storing what the first
  one implies is one more thing that can disagree with the rota.
- **No kiosk, no badge scanning** (R2 §6 decision 4): an organiser marks a shift done afterwards.
- **No chat, and no volunteer ever sees another volunteer's contact data** (§6 rule 3). The desk
  somebody is meant to reach is the `info` station's `location_text`, and that is the whole of it.
- **No 14-hour daily-rest rule.** R2 infers it from the Labour Code by analogy; it would refuse the
  ordinary shape of a two-day conference (pack-down at 18:00, doors at 07:00). Said out loud in
  `rules.py` rather than left as a silence.
- **No notifications.** Adding a `Notification.type` changes `choices` and so needs a migration in
  `notifications`, which is exactly the kind of shared-file change seven parallel branches were
  told to avoid. Named in `HISTORY.md` §17BF.E's "Left open".

## Invariants

- **The minor line is UNDER 16** (`accounts/minors.py`, `Profile.is_minor`), not R2's 18. Every
  minor rule reads `is_minor`; none of them computes an age.
- **The constants are constants** (`rules.py`): night 22:00–06:00, 7 h daily cap, 15 min gap, 4 h
  drop cutoff, 30 min before a credited-hours override needs a note. An organiser cannot loosen
  any of them — a number a form can raise is a number somebody raises at 23:40 on day two.
- **A minor cannot claim anything until `VolunteerRecord.consent_recorded_at` exists.** The record
  is organiser-filled FIELDS; no scan of a consent form or of a criminal-record certificate is ever
  stored (§6 rule 5).
- **Two of the refusals are soft.** `needs_adult` and `needs_confirmation` do not refuse a claim —
  they make it land as `claimed` instead of `confirmed`. `HARD_REASONS` / `SOFT_REASONS` in
  `rules.py` is the split, and the order of the checks matters: a soft reason must never hide a
  hard one.
- **Self-claim needs the `volunteer` role; an organiser may assign anybody on staff.** An organiser
  claiming for themselves gets `organiser_assigns`, not `not_volunteer` — a different sentence for
  a different person (house rule 6).
- **The unique constraint is PARTIAL**, excluding `dropped` (the `ExerciseTranslation` lesson): the
  tombstone of a shift you gave back must not stop you taking it again.
- **Coverage is two `COUNT`s per shift, never a stored tally** (house rule 5), plus `needs_adult`,
  which is the one deficiency a number cannot show — a shift can be full of fifteen-year-olds.
- **A `done` assignment credits the shift's length** unless `hours_credited` says otherwise; an
  override more than 30 minutes away needs `credit_note` or the endpoint answers 400
  `note_required`. A `no_show` credits zero.
- **Visibility is staff-only and 404, not 403**: for somebody who does not help run this event, its
  rota does not exist. Every single-object action re-asks the rule module anyway (house rule 4).
- Everything is behind `feature_gate('shifts')`, and the frontend panel does not even FETCH when
  the flag is off — a kill switch that logs a 403 in the console has not removed the feature.

## The session signal (`signals.py`)

A `Station` may point at an `events.Session`. A shift created for it with no hours of its own takes
the session's and gets `follows_session=True`; `post_save` on `Session` moves exactly those. A
shift somebody gave its own hours to (splitting a long session in two) is left alone, because that
was a deliberate act a programme edit has no business undoing. The move is a `QuerySet.update()`,
so it fires no signal of its own — stated here rather than hidden, per house rule 5's own note.

## Cross-app touches

- `booking/availability.py` gained `_shift_intervals`: a **confirmed** shift blocks a tutor's
  bookable hours exactly as hosting an event does, and for the same reason. `claimed` does not —
  it may never become anything, and withdrawing income over a maybe is the wrong way round.
- `rules.holds_station_assignment(user, event, kind)` + `event_has_station(event, kind)` exist for
  step F: "who may operate the cloakroom desk" becomes a confirmed `cloakroom` assignment where the
  event rostered one, and staff membership where it did not.
- `ics.py` imports `events.ics`'s two private helpers on purpose (escaping and CRLF rules live in
  one place); if those are renamed, this file moves with them.

## Verify

`../.venv/bin/python3 manage.py test shifts` (48 tests, refusal-weighted) plus `events booking
notifications moderation` for the neighbours. Browser: `frontend/e2e/event-shifts.mjs`.
