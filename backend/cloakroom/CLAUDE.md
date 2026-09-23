# cloakroom — the desk at an event, by anonymous bearer token

`CloakroomDesk`, `CloakroomItem`, and the rules in `rules.py`. Built as step F of
`CONFERENCE-BRIEF.md` (§3.F, from `CONFERENCE-RESEARCH-REPORT.md` §2.1 and its decision 5).

## The one invariant everything else follows from

**An item is never linked to a person.** There is no FK to a depositor, no name, no account, no
document number — anywhere, in any status. A coat is found by the 8-character token printed on a
paper slip and by nothing else, exactly as a real cloakroom works.

`deposited_by` / `returned_by` / `exception_verified_by` are the **staff member operating the
desk**, not the owner. That is an accountability trail for the desk, which is the question an
organiser actually asks when two racks disagree; it is not a record of who left what.

Consequences worth knowing before changing anything here:

- A lost slip has no fallback *inside* the data, because there is nothing to match a person
  against. `returned_by_exception` is the whole answer: the clerk writes what the item looks like
  and **which KIND of identity** they were shown (`student_card`, `id_document`, `account`), never
  the number on it, and the lost token is blacklisted at that desk from that moment.
- The CSV export has six columns and not one of them is a person.
- If somebody later asks for "let an attendee see their own cloakroom items", the honest answer is
  that this app cannot, by construction, and adding it means giving up the property that makes the
  log not personal data.

## Shapes

- **`status` is one field**, never a pair of booleans: `stored` → `returned` /
  `returned_by_exception` / `unclaimed`. The desk has its own: `open` → `closed`, and it does not
  reopen — the reconciliation list is a statement about a moment.
- **Two partial unique constraints**, the `ExerciseTranslation` shape: one `stored` token per desk
  and one `stored` item per hook. Flat `unique_together` would make the second evening's rack 12 a
  500 instead of a coat. Note that DRF derives validators from `unique_together` but **not** from
  `Meta.constraints` (`backend/CLAUDE.md`), which is why the deposit path checks
  `deposit_block_reason` first and catches `IntegrityError` behind it.
- **The generator is stricter than the constraint**: `CloakroomDesk.new_token()` avoids every token
  the desk has ever issued, in any status, so `return_result` can never be ambiguous about which
  coat a slip means.
- **`rack_labels` is a JSON list, not a `Rack` model.** A hook label is not something anybody
  queries or hangs anything off; the item keeps its own copy of the string, so renaming the rail
  half way through the evening does not rewrite history.
- **The token alphabet has no `O`/`0`/`I`/`1`** — it is typed off a paper slip by a tired person,
  which is also why the return endpoint upper-cases and trims what it is given.
- **`free_racks` treats `unclaimed` as taken**, not free: a coat nobody came back for is still
  hanging on that hook. Found by looking at a screenshot of a closed desk reporting every hook free
  while one of them visibly held a rucksack — no assertion would have caught it, because every
  assertion agreed with the code.

## Rules live in `rules.py`, and the endpoints ask

`can_operate`, `deposit_block_reason`, `free_racks`, `return_result`, `hand_back`,
`exception_block_reason`, `return_by_exception`, `reconcile`.

**`can_operate` is deliberately one function.** Today it is "any `EventStaff` member", the same bar
check-in already sets. `CONFERENCE-BRIEF.md` §5 has the integrator narrowing it to *a confirmed
`cloakroom` station assignment* on step E's rota when the event has one — when that lands, this
body grows an `if` and nothing else in this app moves.

Every refusal is a word, not a boolean (house rule 6): `not_staff`, `desk_closed`, `rack_taken`,
`unknown_rack`, `description_required`, `identity_required`, `not_stored`, `has_items`. Every
return is a verdict: `returned`, `unknown_token`, `already_returned`, `blacklisted`, `desk_closed`.
All of them have a sentence in `frontend/src/lib/utils/labels.ts`.

**409 vs 400**: `rack_taken` / `desk_closed` are the world having moved (409); `unknown_rack` and a
malformed exception are the request being wrong (400).

## API

```
GET  /api/events/{id}/cloakroom-desks/        anybody who can see the event; reduced shape for non-staff
POST /api/events/{id}/cloakroom-desks/        organiser only — opening a desk is running the event
GET/PATCH/DELETE /api/cloakroom-desks/{id}/   DELETE only while the desk has never taken anything
GET/POST /api/cloakroom-desks/{id}/items/     POST is the deposit; the token is minted server-side
POST /api/cloakroom-desks/{id}/return/        {"token": …} — the Return flow's own call
POST /api/cloakroom-desks/{id}/items/{i}/return/
POST /api/cloakroom-desks/{id}/items/{i}/return-by-exception/
POST /api/cloakroom-desks/{id}/reconcile/     closes the desk, returns the unclaimed list
GET  /api/cloakroom-desks/{id}/export/        CSV, six columns, no names
```

All behind `feature_gate('cloakroom')`. The event-nested list is **this app's own URL**, not an
`@action` on `EventViewSet` — `CONFERENCE-BRIEF.md` §4 rule 1 keeps `events` untouched by every
step but D.

Visibility is `events.agenda_views._visible_events`, **imported rather than copied**: a second
hand-written copy is how two surfaces start disagreeing about whose draft is whose. Authority is
then asked object-by-object (house rule 4), because a queryset filter never runs for an action that
arrives with an id in the URL.

## Verify

`../.venv/bin/python3 manage.py test cloakroom` (34 tests, refusals first). Browser:
`frontend/e2e/event-cloakroom.mjs`. The frontend half is `/events/[id]/cloakroom` plus the panel at
the event page's `<!-- conference: cloakroom -->` mount point; `qrcode` and `@zxing/browser` are
both dynamically imported and asserted absent from the entry bundle (house rule 11).

## Left open

- **A closed desk refuses returns.** Somebody who comes back for an `unclaimed` coat the next
  morning is handled off-system, by the organiser reading the reconciliation CSV. Reopening a desk
  is deliberately not offered; a "collect an unclaimed item" endpoint is the honest way to add it.
- **No notification anywhere** — a cloakroom has nobody to notify, because it knows nobody.
- **`ScanEvent`-style offline queueing is not built.** The desk needs the network for every
  deposit; step D's batching shape is the obvious model if that ever matters.
- **Retention**: step G's `purge_event_data` does not know about `CloakroomItem` yet
  (`events/exports.py`'s own `RETENTION_NOTE` names it as the next table to learn). Nothing here is
  personal data, so this is tidiness rather than a duty.
