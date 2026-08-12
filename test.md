# Testing EdMat

Two suites, deliberately different in kind:

| | What it is | Where | Count |
|---|---|---|---|
| **Backend** | Django's own test runner against a real (throwaway) database | `backend/*/tests.py`, plus `test_*.py` in several apps | 1145 |
| **Browser** | Playwright driving the real frontend against the real backend | `frontend/e2e/*.mjs` | 22 scripts |

The backend figure was measured (`manage.py test --parallel 4`, ~9 min); the per-app numbers further
down are not all re-counted and some lag behind. The browser row deliberately no longer carries a
total — the per-script counts below are the ones kept current, and a headline number that nobody
re-measures is worse than none.

The split is not arbitrary. The Django suite pins **rules** — who may see what, what is refused and
why — because those are the things that fail silently: a broken create flow announces itself
immediately, a roster leaking to strangers does not. The browser scripts pin **what a person
actually experiences**, which is the half no unit test can reach: that the same page renders three
different things to a stranger, a participant and the instructor.

---

## 1. Backend tests

### Running them

```sh
cd backend
../.venv/bin/python3 manage.py test          # everything (~3.5 min)
../.venv/bin/python3 manage.py test classroom  # one app
../.venv/bin/python3 manage.py test classroom.tests.DiscussionTests            # one class
../.venv/bin/python3 manage.py test classroom.tests.DiscussionTests.test_a_public_thread_is_readable_but_not_writable_by_outsiders  # one test
```

Useful flags:

```sh
manage.py test --keepdb      # reuse the test database — much faster on repeat runs
manage.py test --parallel 4  # split across processes
manage.py test -v 2          # name every test as it runs
manage.py test --failfast    # stop at the first failure
```

**Nothing needs to be running first**, and nothing touches `db.sqlite3` — Django creates a separate
test database, applies every migration, and destroys it afterwards.

### One quirk you will hit if you write more of these

Any test that makes an HTTP request must declare the telemetry log-shard databases, or it fails on
Django's cross-database isolation guard rather than on anything you wrote:

```python
class MyApiTests(TestCase):
    databases = set(all_log_shards()) | {'default'}
```

`classroom/tests.py` and `identity/tests.py` both have an `ApiTestCase` base doing exactly that —
inherit from it rather than repeating the line.

### What each app covers

| App | Focus |
|---|---|
| `classroom` (86) | Courses run by users: visibility, enrolment, lessons, discussion, notifications, settings, staff roles, contributions, chapters, invite links |
| `booking` (137) | Availability arithmetic, the two availability modes against each other, what a hosted event does to them, the booking lifecycle, notifications, listing deletion, the tutor's own calendar, and (`test_week_schedules.py`, 64) weeks that replace the repeating pattern: precedence, merging, what a copy carries forward, bulk apply |
| `events` (60) | Visibility and drafts, authoring and location validation, attendance and capacity, the private roster, notifications (including the deliberate silences), the kill switch, and the schedule integration |
| `identity` (36) | Sign-in provider drafts, schools, the USOS seam, consent gating, standing |
| `accounts` profile extras (21) | Experience, skills, the derived activity feed, the demo-content seed, and the clock/week-start display preferences |
| `config` (16) | The Unicode-aware `ucontains` lookup and the Polish-diacritics bug it fixes, driven through the two browse `?q=` paths as well as the queryset — see `config/test_dbsearch.py` |
| `moderation` | Reports, auto-hide, the queue, node governors, feature-flag kill switches |
| `exercises`, `materials`, `community`, `study`, `services`, `messaging`, `notifications`, `telemetry`, `accounts` | Their own domains |

#### `classroom` in more detail (the newest, and the most rule-heavy)

- **VisibilityTests** — a draft is invisible to everybody but its instructor; a published course is
  public without an account; discovery by subject.
- **EnrolmentTests** — open admits immediately, approval parks the request; the cap holds on *both*
  the joining and the approving path; a closed course refuses; an instructor cannot join their own;
  asking twice does not queue twice; leaving frees the seat and re-joining reuses the row; somebody
  removed cannot walk back in.
- **RosterTests** — the roster is not public; participants see each other, the instructor also sees
  pending requests.
- **LessonTests** — an outsider sees the lesson but not its notes (present but empty, so the response
  shape never changes with the caller); a pending request is not yet a participant.
- **AuthoringTests** — creating is not publishing; the creator becomes the instructor regardless of
  what was posted; somebody else's course cannot be edited; the cap cannot be cut below the people
  already admitted; a course cannot end before it starts.
- **DiscussionTests** — participants-only by default; a public thread is readable but **not writable**
  by outsiders; off means off, including for the instructor; a reply cannot be smuggled in from
  another thread.
- **NotificationTests** — a request reaches the instructor with the note; joining an *open* course
  notifies nobody; every decision reaches the person it is about; a new lesson reaches participants
  but not its own author; **a pending request is never told what is happening inside**.
- **NotificationSettingTests** — each of the three independent switches, on its own: the instructor's
  per-course announcements, the participant's per-course mute, and the account-wide category, plus
  muting one type without the rest.
- **KillSwitchTests** — the feature flag hides the whole surface (401 anonymous, 403 signed in) while
  a moderator keeps access.
- **StaffTests** — creating a course seats its author as owner *at the model level*, so a seed command
  or the admin produces one too; an admin may edit but only the owner may delete; an assistant curates
  content but cannot touch settings or the staff list; **the owner can never be demoted or removed**,
  because a course whose owner a co-admin could evict is one that can be taken hostage; promoting a
  participant gives up their seat, so nobody counts twice against the cap.
- **ContributionTests** — the three policies; a non-participant is refused even when the course is open
  to contributions; a pending submission is visible to staff and to its own author and to nobody else;
  every member of staff is notified, not just the owner, so the queue does not stall when one person is
  away; approving publishes and tells the contributor; rejecting keeps the reason; staff never queue
  behind themselves; a contributor may withdraw their own pending submission but not somebody else's;
  the same thing cannot be added twice.
- **ChapterTests** — a locked chapter still *appears*, with its unlock date, while its contents do not,
  so a course never looks shorter than it is; staff read it early because they have to prepare it; no
  date means always open, which is not the same as a date in the past; deleting a chapter keeps its
  content, unfiled.
- **InviteTests** — a link jumps the approval queue but **never seats anybody over capacity**; a staff
  link makes a co-teacher; used-up, expired and revoked each refuse in their own words; revoking keeps
  the row; the preview is readable logged out and says little; an unknown token is a 404 rather than a
  description; following your own link does not demote you.
- **Attachment image tests** (`AttachmentImageMetadataTests` and its four neighbours, at the end of the
  module) — an uploaded image is re-encoded rather than stored, so **GPS, the device model and the ICC
  profile do not survive**, while the orientation tag is honoured *before* it is dropped — pinned by
  difference, because asserting the tag is absent afterwards would pass whether or not it was ever
  obeyed. Also: the stored image keeps its aspect ratio (it is a scanned page, not an avatar) and is
  not upscaled; a real Windows executable renamed `.png` and a real 140 KB/144-megapixel decompression
  bomb are both refused; and **a PDF is stored byte for byte**, because a document's bytes are the
  document. `StripAttachmentImageMetadataCommandTests` covers the command for files stored before any
  of that existed: dry-run changes nothing, the real run deletes the original, and a second run is a
  no-op. The fixtures are genuine encoded images carrying real EXIF — a fixture that never carried any
  would make the whole class pass for nothing.

#### `booking` in more detail (the two availability modes are the whole point)

- **AvailabilityComputationTests** — a weekly rule becomes back-to-back sessions; a window too short to
  fit one offers nothing rather than a short session; every day in the range comes back, including the
  empty ones, so "nothing on Wednesday" is distinguishable from "Wednesday was not asked about"; a rule
  pinned to one listing does not leak into another while a general one applies to all; a block cuts a
  hole in the *middle* of a window rather than trimming an edge; an all-day block clears the day; an
  opening adds hours the weekly pattern never had; a block on the same day beats an opening; overlapping
  rules do not offer one hour twice; the past is never offered.
- **ModeTests** — also where events meet availability, because it is the same subtraction: **an event the
  tutor is HOSTING takes the hour out of a `derived` listing and one they are only ATTENDING does not**
  (hosting is a commitment to people who will turn up; attending is a one-click statement this app lets
  you take back, so treating it as a withdrawal of bookable hours would mean an RSVP silently costing
  somebody income); a `declared` listing keeps publishing through both; a draft and a cancellation block
  nothing; a 150-minute workshop swallows every slot it covers; the `events` kill switch gives the hours
  back; and a student is refused at *request* time as well as shown a shorter list. Then: `derived`
  removes a taken hour from what the next person sees and `declared` does not,
  against the *same* calendar; a **requested** booking already holds a `derived` slot, not just a
  confirmed one; declining gives the hour back; and an hour taken through one listing is taken on all of
  them, because a tutor is one person.
- **RequestTests** — a request starts as a request in both modes; the end time is the server's to decide;
  a time the tutor never offered is refused; a second request for the same hour is refused in `derived`
  and **accepted** in `declared`, which is the mode working rather than a hole in it; a paused listing
  takes no bookings; nobody books themselves; the past is refused; and booking needs an account.
- **LifecycleTests** — only the tutor confirms; a third party gets a 404 rather than a 403; a repeated
  transition is a 409 rather than a 400; a decline keeps the reason; either party may cancel and the row
  records which; **a tutor cannot confirm two sessions at the same time even in `declared` mode**; a
  session cannot be completed before it has happened; the tutor is told how many other requests contest
  a slot and **a student never is**; the list splits by which side you are on.
- **NotificationTests** — the request reaches the tutor with the time, the answer reaches the student, a
  decline carries the reason, a cancellation reaches the other party and not the one who did it, and
  turning the category off stops the row being created at all.
- **ListingDeletionTests** — a listing with an upcoming booking refuses to be deleted, pausing is offered
  instead and leaves the booking alone, and once the bookings are settled the delete goes through.
- **MyScheduleTests** — the tutor's own calendar, and every test is a way it differs from the
  student-facing endpoint, which is why it exists separately: a booked hour stays **inside** its window
  rather than being cut out of it, windows are not sliced into sessions, rules pinned to different
  listings all appear, the past is not hidden, a blocked day has no window at all, both sides of the
  caller's account land in one calendar, nobody else's does, it needs an account, and an absurd span is
  trimmed rather than rendered.
- **KillSwitchTests** — the `tutoring` flag hides availability and bookings alike, while a moderator
  keeps access.

#### `events` in more detail (the newest)

- **VisibilityTests** — a draft is invisible to everybody but its host, and 404s on its own URL rather
  than 403ing, because for a stranger it does not exist; a published event is readable with no account;
  a **cancelled event stays readable but leaves the browse list**, while staying in the lists of the
  people it concerns — both halves matter and they pull in opposite directions; `upcoming` is the
  default and `past` is reachable; discovery by subject and by field; `mine=hosting` and
  `mine=attending` are different lists, and declining takes an event off the second one.
- **AuthoringTests** — the creator becomes the host regardless of what was posted; creating answers with
  the READ shape, because the client needs an id and the derived fields to navigate; onsite needs a
  place, online needs a link, hybrid needs both; **a partial edit is validated against the fields it is
  not changing**, so switching an event to online while sending no URL fails on the URL it does not
  have; cancelling cannot be smuggled in as a PATCH and a cancelled event cannot be reopened; a draft
  nobody is coming to can be deleted, and an event people are coming to refuses, naming cancelling as
  the alternative.
- **AttendanceTests** — answering twice updates one row rather than making a second; changing your mind
  gives the seat back and the next person gets it; a full event still lets somebody holding a seat
  decline, which is the one answer a full event most wants; the host neither attends nor is counted; the
  past and a cancellation both refuse, each in its own words; and the block reason is told to the person
  it applies to rather than left to be discovered by trying.
- **RosterTests** — not public, and not readable by somebody who is not going; but the people who ARE
  going see each other, unlike a course roster, because "is anybody else going" is half of why somebody
  opens an event; only the host sees the declines.
- **NotificationTests** — the host is told when somebody is coming; **a decline is deliberately silent**
  and **a change of mind does not notify again**; cancelling reaches everybody holding a seat and nobody
  else; moving the time or the room tells them, and **fixing a typo in the description tells nobody**;
  turning the category off stops the row being created at all.
- **KillSwitchTests** — the `events` flag hides every action, including reads and including from the
  host of an existing event, while a moderator keeps access.
- **ScheduleTests** — events you host and events you are going to are both on `/api/my-schedule/`; ones
  you declined, somebody else's, your own drafts and cancelled ones are not; the kill switch empties the
  list **without breaking the endpoint**, because that is a tutoring endpoint; and an event sitting on a
  published window does not consume it, which is the load-bearing half of the decision to put events on
  that calendar at all.

---

## 2. Browser tests

These drive a real Chromium against **both servers running**, so they need a little setup. They are
not wired into `npm test` on purpose: they need two processes and a browser binary, and a test suite
that fails because you forgot to start a server teaches you nothing.

### One-time setup

Playwright is deliberately **not** a dependency of this repo — it is needed for these two scripts
and nothing else:

```sh
cd frontend
npx playwright install chromium
```

### Running them

Three terminals. Use ports **8011 / 5183** so the scripts never touch a dev server you have running
on the usual 8000 / 5173.

```sh
# 1 — backend, with the USOS stand-in connector on and the test origin allowed
cd backend
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 EDMAT_USOS_MOCK=true \
  ../.venv/bin/python3 manage.py runserver 127.0.0.1:8011
```

```sh
# 2 — frontend, pointed at that backend
cd frontend
echo 'PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api' > .env.e2e
npx vite dev --mode e2e --port 5183 --strictPort
```

```sh
# 3 — the scripts
cd frontend
node e2e/classroom.mjs
node e2e/education-auth.mjs
node e2e/material-claims.mjs
node e2e/classroom-overhaul.mjs
node e2e/profile-overhaul.mjs   # seed it first: manage.py seed_profile_showcase
node e2e/booking.mjs
node e2e/schedule-editing.mjs
node e2e/events-and-nav.mjs
node e2e/known-issues.mjs
node e2e/course-search.mjs
node e2e/navbar-stages.mjs
node e2e/prerender-check.mjs    # NOTE: runs against `npm run preview`, not `vite dev` — see below
```

**`prerender-check.mjs` is the one script that must NOT be pointed at the dev server.** It verifies
the five prerendered routes (`/`, `/levels`, `/privacy`, `/login`, `/register`), and prerendering is
a BUILD-time step — `vite dev` renders everything on the fly, so every check in it would pass there
without proving anything about what actually ships. Build first, then preview:

```sh
cd frontend
npm run build
npx vite preview --port 5174 --strictPort     # 5174 is already in the backend's CORS allowlist
E2E_BASE=http://localhost:5174 node e2e/prerender-check.mjs
```

Its first four checks run with **JavaScript disabled**, deliberately: that is what a crawler which
does not execute scripts sees, and what the browser can paint on the very first frame. Before the
prerendering change those four would have found an empty page — the body had 0 characters of text.
They are the regression guard for the whole optimization; if someone later removes a `+page.ts`,
this is what says so.

Each prints one `ok`/`FAIL` line per check, a total, and any console or page errors. Exit code is 0
only when **both** the failures and the error list are empty — a page error is a failure here even if
every assertion passed.

`.env.e2e` is a mode-specific file, so it overrides `.env` **without changing it** — your ordinary
`npm run dev` setup keeps working untouched.

### What they cover

**`e2e/classroom.mjs` (44 checks)** — three people in three separate browser contexts, because the
entire feature is about who is looking:

1. anyone can browse; the nav offers it
2. creating a course leaves it a draft, invisible to everybody else
3. publishing it, with approval required
4. a lesson: public blurb, participant-only notes
5. a student asks to join, and waits
6. the instructor sees the request *with the note*, and approves
7. being in the course is what unlocks the notes and the roster
8. "My courses" splits teaching from taking part
9. leaving gives the seat back and re-locks the notes
10. a full course refuses in its own words, with no join button
11. uncapping is accepted
12. discussion is participants-only by default — a stranger gets no composer
13. the post notification arrives and links back to the course
14. a public thread is readable by anyone, writable only by participants
15. turning discussion off removes it entirely
16. muting one course stops its notifications without leaving it
17. the account-wide notification category and its per-type rows exist

**`e2e/education-auth.mjs` (42 checks)** — the sign-in drafts and the USOS ground: all four providers
offered and labelled drafts, each modal describing its own provider's real quirk and blockers, the
repository link, Escape closing it, the school picker distinguishing a university that runs USOS from
one that does not, **no session created by any of it**, then connect → transfer diploma/grades →
consent one field at a time → un-publish → delete.

**`e2e/profile-overhaul.mjs` (53 checks)** — the one-screen profile and the modal-per-area editor.
Replaces `profile-editing.mjs`, which drove ⋯ menus on the public profile: that surface is gone on
purpose, so the script that exercised it went with it, and every write it checked (experience added,
reordered and removed; a skill added and removed; the self-declared rule holding) is checked here
instead.

**Seed the account it reads first** — `manage.py seed_profile_showcase` — and run the API with
`EDMAT_USOS_MOCK=true`, or the transcript half has nothing to group. The flag is compared against the
string `true`, so `EDMAT_USOS_MOCK=1` leaves the mock OFF and looks exactly like a code fault.

**Re-seed after any run that fails partway.** The transcript section prunes an academic year and
relies on a full transfer to put it back, so a run that dies before that leaves the account a year
short — and the NEXT run then fails on assertions about a count, pointing at code that is fine. This
cost two runs to work out. `seed_profile_showcase` is idempotent; run it again before re-running.

Three things only a browser can answer, and they are the reason this exists:

1. **the layout claim**, measured rather than asserted — at 390×844 the identity card, the tiles and
   the summary rows have to fit one screen, and nothing may scroll sideways;
2. **the two privacy rules in the RENDERING**, not just in the API — a private set and a finished
   lesson appear for their owner and for nobody else, and the tile counts never advertise a row the
   feed then withholds;
3. **the transcript grouped by year**, each year with its own average, one year removable without
   un-publishing the rest, and a full transfer restoring every year.

Plus the editor end to end (a bio saved — the first write path this app has ever had for that field —
a certificate added, a duplicate refused in words, both removed again), and the dialog's own keyboard
behaviour: focus moves in on open, is trapped, and returns to the row that opened it on Escape.

**It writes screenshots to `/tmp/edmat-profile-*.png` and they are meant to be looked at.** Four real
rendering faults in this feature passed every assertion and were caught only by reading them: activity
rows collapsing into an unreadable column at phone width, grade rows breaking differently line to line
so a term appeared to belong to the wrong course, the "read all" dialog re-using the clamped style and
showing the same truncated text, and an orphan tile alone on a row.

It restores the bio it overwrites, which it has to: the first version left its own short marker
behind, and every run after it failed a clamp check for a reason that had nothing to do with the code.

**`e2e/classroom-overhaul.mjs` (29 checks)** — several people running one course. An owner creates it,
makes a second account an administrator, and that co-admin can edit and mint invite links but is
offered no delete. Two chapters, one dated far in the future: staff are told it is still shut, a
participant sees that it exists and when it opens but none of its contents. A participant contributes
a material, is told it is waiting, and it stays invisible to everybody else until the **co-admin** —
not the owner — approves it. Then an invite link: readable logged out without leaking anything else,
joining straight past the approval queue, and refused once revoked.

**`e2e/booking.mjs` (51 checks)** — three people in three contexts, because the entire feature is
about the same grid of buttons meaning two different things. A tutor publishes one 14:00–17:00 Tuesday
rule through the real form (having first been told, correctly, that nobody can book them without one)
and it becomes three one-hour slots. The same window is captioned differently on a `derived` and a
`declared` listing. A student requests an hour and is told it is a **request**, not an appointment. That
hour then vanishes from the derived listing and stays on the declared one; a second person asks for it
anyway and is accepted. The tutor is warned the hour is contested, confirms one, is **refused** on the
clashing one in its own words, and declines it. Each student sees their own answer, neither is shown the
tutor's calendar, and the decline arrives as a notification. A whole-day block empties a Tuesday the
weekly rule would otherwise fill — read back from the public endpoint with no account. Deleting a listing
with a live booking is refused, naming pausing as the alternative.

Two of its checks had gone stale and were repaired rather than worked around. `pageToSlots` clicked a
`.weeks` "Later →" pager that stopped existing when this feature gained week and month views — a
selector matching nothing anywhere in the app, which crashed the run at check 6 and took the other 45
with it. And the tutor-calendar check never paged forward to the week the session is actually in, so it
passed on a Monday and could not pass on a Sunday; it now walks forward the same way the student side
already did.

**`e2e/schedule-editing.mjs` (36 checks)** — laying a schedule out on the calendar instead of through a
form. The editor opens and says, before any change is made, whether it is about to change this week
alone or every week. A drag on a day column becomes real stored hours and detaches the week, keeping
the hours it already showed. The same block is then moved with the mouse, both edges are pulled, and
all of it is done again with the arrow keys — Enter on a day adds an hour, Shift+↑↓ resizes, Delete
removes — because a schedule editor that only answers a pointer is unusable for the people who most
need their hours right. Then the week is repeated across five, the sixth is confirmed still on the
ordinary timetable, and the third of the five is changed on its own while the other four stay exactly
as they were. Finally the week is saved as a template and put back on the pattern.

It signs in as the seeded `kasia` rather than registering, and starts by clearing its own weeks,
templates **and repeating rules** through the real endpoints — the last section edits a rule on
purpose, so without the reset each run starts from the previous run's drift and the grid's hour range
moves with it.

Worth knowing before writing another drag test: `page.mouse` works in **viewport** coordinates while
`boundingBox()` reports an element wherever it is, so on Playwright's default 720px-high window every
drag aimed at the lower half of the ~580px calendar grid landed off-screen and silently did nothing.
That context sets a 1200px-high viewport. The symptom is indistinguishable from a broken feature, and
upward drags kept working, which is what gave it away.

Then the same availability in the other two views: the week grid renders an hour axis and seven columns
holding exactly the slots the list showed, as real pressable buttons; the month grid is whole weeks and
marks the days with free times; clicking a day opens its week. And the tutor's own calendar draws
published hours as background bands with the confirmed session **on** them and the declined one absent
— the difference between this endpoint and the student-facing one, made visible.

Finally the display preferences: in English, with nothing set, the axis is 24-hour and the week starts
Monday — the point, since `Intl` would have picked neither. Switching in Settings flips the axis to
AM/PM, moves the week to Sunday-first, re-orders the month grid to match, carries a published rule's
own times with it, and survives a hard reload.

Two things about this script specifically, both deliberate:

- **It signs in as the seeded demo users rather than registering.** Registration is rate-limited per IP,
  and a script that registers three people exhausts it on repeated runs — at which point the whole run
  fails in a way that looks exactly like a regression. The price is that those accounts carry state
  between runs, so the script starts by clearing the tutor's rules and exceptions and cancelling their
  live bookings **through the real endpoints**, and resetting the clock/week-start preferences to the
  defaults — otherwise a previous run's setting quietly becomes the "default" the first check asserts
  against. It needs `password123` (the `seed_demo_users` password), overridable with
  `E2E_DEMO_PASSWORD`.
- **It ignores exactly one console error**: Chromium logs every non-2xx fetch regardless of whether the
  app handled it, and this run deliberately provokes a `409` by confirming a clashing session. Only that
  status is ignored; a 500 or a 403 still fails the run.

**`e2e/events-and-nav.mjs` (92 checks)** — the three things that shipped together, in five browser
contexts. The navbar: one "Add…" trigger holding all five create actions, closing on Escape and handing
focus back; the account button opening a menu of Profile / My Set / My schedule / Settings / Log out,
with Profile resolving to the signed-in person's own id; Messages rendering as an SVG with no text and
a real accessible name. The homepage: five tabs, the panel wired to the tab that owns it, the choice
surviving a reload, the back button stepping between tabs, and arrow keys moving between them. Then a
whole event: created through the real form, answered by a second person — and *answering* is what
unlocks the roster they could not see a moment earlier — the host notified with a link that resolves,
capacity refusing a third person while the seat-holder can still decline and the freed seat is offered
on, the event appearing on the events page, on the homepage tab via a shared link, and on the host's own
calendar labelled "Running", then cancelled, which tells the person who was coming while the event stays
readable. Finally the kill switch, which is the part it was written to prove: with the flag off the nav
link, the homepage tab, the "Add…" entry, the page and the API are all gone, `/api/my-schedule/` keeps
working with an empty events list, and a moderator still sees everything. Last, the phone navbar in its
own 390×844 context: the bar down to one row with neither the desktop nav nor the action row on it, the
drawer holding the browse links, the create actions, the account items and Messages, Escape closing it
and handing focus back, **the bar tucking away on scroll down while the menu button stays within a pixel
of where it was**, the bar returning on scroll up, and a drawer link both navigating and closing the
drawer behind it.

Two things about this script specifically:

- **It seats three of its four people with an already-issued token** rather than driving the login form
  four times. `POST /auth/login/` is throttled at 10/min per IP, and four browser logins plus four API
  tokens is over budget before a single retry — at which point the run fails with "could not sign in"
  and looks exactly like a broken login. The form itself is still exercised for real, once. The token is
  what the app itself persists, so this is the same state a real login leaves behind, not a bypass.
- **Kasia is the moderator**, not Julia — `seed_demo_users` seats exactly one `is_staff` account, and
  pulling a feature flag is `IsAdminUser`.

**`e2e/navbar-stages.mjs` (42 checks)** — the navbar's staged collapse, driven across eleven viewport
widths in order: each stage hides exactly its own link and reveals its icon twin (right of the dice, in
nav order, with a real `aria-label`), the search icon lands immediately left of Add, the logo's
disappearance is banded (back on the phone bar at ≤720px), a signed-in person's language picker moves
into the account menu while a guest's stays in the row, the bar's height falls with the width, and the
collapsed icons still navigate. Then the widened search: a stamped course, tutoring listing and event
created through the API are all found by `/search?q=<stamp>`, **and the result count is asserted to be
exactly 3** — the first run of this script passed its three "is found" checks against a backend that
predated the `?q=` filters, because an unfiltered list also contains the stamped items; only the
screenshot showed the difference, and the count check is what stops that from passing again. Takes
`E2E_SHOTS=<dir>` to save screenshots — look at them; that is how both real issues in this feature's
history were found.

**`e2e/known-issues.mjs` (23 checks)** — the six entries from CLAUDE.md §17V.7 that were real defects
rather than deliberate scope cuts (see §17W). The event form offering subjects at all, and the one
ticked at creation still ticked when the edit form reloads; the edit page itself, refusing a non-host
in words with no form rendered; the host warned that the hours are still published as bookable, styled
as a warning rather than an error; and the "keep these hours free" button, checked by **reading the
stored `AvailabilityException` back from the API** rather than by trusting the confirmation sentence,
so a button that only flipped a flag on the page would fail here. Then the drawer's focus trap on a
390×844 phone: focus held through 40 Tabs and 20 Shift-Tabs, Escape still closing it, focus returning
to the button that opened it.

It **filters one console error on purpose** — the attendee roster is private until you are on it, so
opening an event you have not answered yet really does log a 403, which the page swallows by design.
The filter is narrowed to a failed resource load with that exact status, so a 403 raised anywhere else
still fails the run.

**`e2e/material-claims.mjs` (14 checks)** — a material card previews only its top few coverage and
requirement claims (the real corpus has materials with 30), so the "+N more" count beside them is the
only route to the rest from a grid — and it was an inert `<span>`. Pins that it is a real button with
an accessible name, that it opens a modal holding **every** claim rather than only the hidden
remainder, in the same sort order the card established, that drilling into one claim and closing it
returns to the list rather than the card, that two modals are never stacked, and that the whole path
works from the keyboard.

**`e2e/course-search.mjs` (24 checks)** — searching inside one course, in three contexts, because
the whole point is that the same box shows the owner, a participant and a stranger different things.
Builds its own course through the real endpoints and deletes it afterwards, so a second run starts
clean. Pins the parts the Django tests cannot: that six keystrokes fire **one** request rather than
six, that a result actually navigates to the thing it found (a chapter to the content tab anchored
at that chapter, a comment to the discussion tab), that the matched words are marked in the snippet,
that an ALL-CAPS Polish comment is found typed in lower case — the SQL half of the diacritics fix,
which Python's own `casefold()` would hide — and that the participant notes, a locked chapter's
sessions and a participants-only thread all stay out of a stranger's results.

Two of its checks exist because of bugs a screenshot found and no assertion would have: the panel
first rendered with no card at all (its colour tokens were invented rather than the ones
`_theme.scss` defines), and a chapter hit printed its own title again as its "where" line.

### Two things worth knowing before you debug a failure

- **They talk to a real, persistent database.** Both scripts create their own accounts and use a
  unique course title per run for exactly this reason, but leftovers accumulate. If you want a clean
  slate: stop the backend, delete `backend/db.sqlite3`, then re-run `migrate`,
  `migrate_log_shards`, `import_legacy_corpus` and `seed_demo_users`.
- **Repeated runs will eventually hit `429 Too Many Requests`** on registration — the auth throttle
  (`accounts/throttles.py`) is real and doing its job. The throttle history lives in the process
  cache, so **restarting the backend clears it**. A run that fails with "the panel did not render"
  right after several earlier runs is almost always this, not a regression. `e2e/booking.mjs` sidesteps
  it entirely by signing in as the seeded demo users instead; the older scripts still register.
- **Most scripts default `E2E_API` to `:8000` while this document specifies `:8011`,** so running them
  on the documented ports needs `E2E_API=http://127.0.0.1:8011/api` in the environment. Without it they
  fail immediately with `connect ECONNREFUSED 127.0.0.1:8000`, which is a wrong port rather than a
  regression. (`e2e/education-auth.mjs` used to hardcode `:8011` in one `page.evaluate` and so could not
  be pointed anywhere else at all; it now reads `E2E_API` like the rest, defaulting to `:8011`, and makes
  the call from Node so it does not depend on CORS.)
- **A long-lived dev server eventually starves the browser.** After a great many full-page navigations
  in one session, Chromium starts failing dynamic imports with `net::ERR_INSUFFICIENT_RESOURCES`; the
  page then renders its server-side HTML and never hydrates, so it looks completely broken while making
  no API calls at all. **Restarting the Vite dev server fixes it.** `e2e/booking.mjs` also opens a fresh
  tab per person between sections (`renew()`) for the same reason — auth lives in the browser context,
  not the tab, so nobody is signed out by it.

---

## 3. Checking a fresh install

`setup.sh` is the thing a new person runs, so it is worth checking on something that has never been
built before rather than on your own working copy — the failures it is meant to prevent only happen
on a clean machine.

```sh
# a genuinely clean copy of the repository, with no .venv, no node_modules and no database
TREE=$(git write-tree) && mkdir -p /tmp/edmat-fresh
git archive "$TREE" --format=tar | tar -x -C /tmp/edmat-fresh
cd /tmp/edmat-fresh && ./setup.sh && ./run.sh
```

Two bugs this caught that no other check would have:

- **`python3 -c 'import venv'` is not a test for python3-venv.** The `venv` module ships with Python
  itself, so it imports fine on a machine where `python3 -m venv` cannot build a working
  environment. What Ubuntu splits into that package is `ensurepip`, which is what the script now
  looks for.
- **Changing the ports broke the site silently.** `run.sh` invites you to change them, but the API
  only accepts browser requests from origins it knows, and its built-in list covers the default port
  only — so a changed port produced "Something went wrong" with no clue as to why. `run.sh` now
  passes the chosen origin through.

---

## 4. Other checks

```sh
cd frontend
npm run check   # svelte-check — expect 0 errors, 0 warnings
npm run build   # production build; also what regenerates the Paraglide message modules
npm run lint    # prettier + eslint (pre-existing formatting debt in older files)
```

**If `npm run check` reports dozens of "Cannot find module '$lib/paraglide/messages'"**, the message
modules simply have not been generated in this checkout yet. Run `npm run build` (or start
`npm run dev`) once and re-check — those files are generated, and gitignored. The same applies after
adding a message key: build before the new `m.*` accessor type-checks.

```sh
cd backend
../.venv/bin/python3 manage.py check          # system check
../.venv/bin/python3 manage.py makemigrations --check --dry-run   # fails if a model change has no migration
```

---

## 5. Adding tests

- **A rule belongs in the Django suite.** Ask "what would fail silently?" — that is the test worth
  writing. Most of `classroom/tests.py` is refusals rather than happy paths for exactly that reason.
- **An experience belongs in a browser script**, and only when it genuinely depends on the browser:
  who sees what, whether a control appears, whether one page's change shows up on another.
- **Assert on scoped text, not whole pages.** A real failure caught while writing these: the phrase
  "taking part in this course" appeared both in the membership notice and in the new
  discussion notice, so a whole-page match started reporting a member as a non-member. The app was
  right; the assertion was ambiguous. Scope to the section (`.enrol`, `.roster`) instead.
- **Chromium's `innerText` returns *rendered* text**, so a heading styled `text-transform: uppercase`
  reads back uppercase. Match case-insensitively or you are testing the stylesheet.
