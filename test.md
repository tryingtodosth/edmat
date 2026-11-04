# Testing EdMat

Two suites, deliberately different in kind:

| | What it is | Where | Count |
|---|---|---|---|
| **Backend** | Django's own test runner against a real (throwaway) database | `backend/*/tests.py`, plus `test_*.py` in several apps | 2706 |
| **Browser** | Playwright driving the real frontend against the real backend | `frontend/e2e/*.mjs` | 22 scripts |

The backend figure was measured (`manage.py test --parallel 4 --keepdb`, ~21 min — see below for
what that number depends on); the per-app numbers further down are not all re-counted and some lag
behind. The browser row deliberately no longer carries a total — the per-script counts below are
the ones kept current, and a headline number that nobody re-measures is worse than none.

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
../.venv/bin/python3 manage.py test --parallel 4 --keepdb   # everything — ~21 min, 2707 tests
../.venv/bin/python3 manage.py test courses                 # one app
../.venv/bin/python3 manage.py test courses.tests.DiscussionTests            # one class
../.venv/bin/python3 manage.py test courses.tests.DiscussionTests.test_a_public_thread_is_readable_but_not_writable_by_outsiders  # one test
```

Useful flags:

```sh
manage.py test --parallel 4  # split across four worker processes — the documented way to run it all
manage.py test --keepdb      # keep the test database afterwards
manage.py test -v 2          # name every test as it runs
manage.py test --failfast    # stop at the first failure
```

**`--parallel 4` is the command to use, and it needs `tblib`** (it is in `backend/requirements.txt`;
`pip install -r requirements.txt` has it). A worker process ships a failure back to the parent by
pickling it, and a traceback object does not pickle — without `tblib` the *first* error in any
worker kills the whole run with `TypeError: cannot pickle 'traceback' object` and never tells you
which test failed. Django's own documentation names it under "Running tests in parallel".

**Where the time actually goes.** Measured on this machine on 2026-10-06: **24 min 27 s**
wall-clock for 2 686 tests, of which **14 min 53 s** is the tests and the remaining **~9½ min** is
building the test databases before a single one runs. (Four other agents were working the same six
cores, so read it as an upper bound.) Re-measured the same evening on the merged tree with the
machine otherwise idle: **20 min 59 s** for **2 700** tests, 12 min 43 s of them tests, and the
whole run printed 198 lines. And again on 2026-10-07, idle, after the six tests below were added:
**21 min 38 s** for **2 706** tests, 13 min 34 s of them tests, 194 lines. The build is ten
databases, not one — `default` plus the nine telemetry log shards, each with its own `migrate`, and
under `--parallel 4` each of them cloned once per worker. The test databases are SQLite **in-memory** (nothing in `DATABASES` sets
`TEST['NAME']`), so **`--keepdb` cannot keep anything between runs here**: it is harmless, not a
speed-up, and the ~9½ minutes are paid again every time.
And on the merged tree the same afternoon (`HISTORY.md` §17BU): **23 min 22 s** for **2 707**
tests, 199 lines, with the a11y audit running beside it for part of the time — the count is what
changed (D's one test and C's six), not the shape.

**Nothing needs to be running first**, and nothing touches `db.sqlite3` — Django creates separate
test databases, applies every migration, and destroys them afterwards.

One thing it *did* touch, until recently: the anonymous-read response cache is a FILE cache under
`backend/cachedata/`, which outlives the process. Its stored responses are replayed as plain
`HttpResponse` objects, which have no `.data` — so an anonymous GET made by one test could be served
back to a different test, to the next run, or to a run after the dev server had browsed the same URL,
failing it with `'HttpResponse' object has no attribute 'data'` a long way from the cause. About 74
tests in `courses` failed that way on a clean checkout, and which ones moved with execution order.
The middleware is now removed from `MIDDLEWARE` under the test runner (`config/settings.py`), and
`telemetry.tests.AnonymousReadCacheTests` — the suite that is actually about it — puts it back for
itself. If a swathe of unrelated tests ever starts failing on a missing `.data` again, that is where
to look.

### The one rule every new test class has to follow

**A test class that makes a request declares the telemetry log-shard databases.** One line, at the
top of the class:

```python
from telemetry.routers import all_log_shards


class MyApiTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}
```

The request-logging middleware writes a `RequestLog` row for every request, into one of nine
separate SQLite files (`telemetry/routers.py`), and Django's test runner forbids a test from
touching a database alias its class did not declare. Without the line the class fails on that
guard rather than on anything you wrote — serially `telemetry/middleware.py`'s `except Exception`
swallows it and logs a full traceback per request (noise that reads exactly like a failure), and
under `--parallel` it is a hard `setUpClass` error.

Three details that have each cost somebody an afternoon:

- **Put it on a base class in that file, once**, and let the subclasses inherit it — forty-two
  files now do (`booking/tests.py: ApiTestCase`, `shifts/tests.py: RotaTestCase`,
  `plans/tests.py: PlansTestCase`, `galleries/tests.py: GalleryBase`,
  `accounts/test_avatar.py: AvatarTestCase`, `accounts/test_throttling.py: ThrottleTestCase`, and
  since 2026-10-07 `moderation/tests.py`, `materials/tests.py`, `services/tests.py` and
  `exercises/test_solution_entries.py`, which between them carried the line 55 times and now carry
  it 4). A **new test file adds a base rather than repeating the line**. A class in such a file
  that reaches no endpoint stays on plain `APITestCase`, which is what keeps the check below able
  to catch the next class that forgets. There is deliberately **no cross-app shared base**: the
  repetition across apps is on purpose, so one app's fixtures cannot break another's.
- **Not `databases = '__all__'`.** `config/test_locale_hint.py` is the one place that should use
  it; a class that declares every database will happily pass a test that writes to the wrong one.
- **It is not only `self.client`.** A class that builds its own `APIClient()` in a helper makes
  requests too — `taxonomy/tests.py` does, and that is exactly how three of its classes stayed
  broken while a narrower check said the file was fine.

**`backend/testing/check_databases_declared.py` is the check**, and zero is the bar:

```sh
cd backend
../.venv/bin/python3 testing/check_databases_declared.py   # -> "0 classes still unresolved, in 0 files"
```

It parses rather than imports (so it needs no settings and no database), resolves a declaration
inherited from a base class in the same file **or in another module**, and names every class that
still needs the line. Run it after adding a test class; a number other than zero is the count of
suites whose next full run will be noise.

**The suite runs it too**, which is new on 2026-10-07 — `testing/test_databases_declared.py`
asserts `offending_classes()` is empty, so a forgotten line now fails `manage.py test` instead of
waiting for somebody to remember a paragraph. Four fixture tests beside it build throwaway source
trees and prove the check can still fail: a class that declares nothing is caught, a base class in
the same file counts for its subclasses, a base that itself forgot does not shield them, and a base
whose *name* does not contain `TestCase` (`GalleryBase`, `DeskCase`) no longer makes its subclasses
invisible — that last one had been hiding 74 real request-making classes from the check, all of
which happened to inherit the line anyway. The test class is a `SimpleTestCase` and needs no
`databases` of its own, because it makes no request: the checker and the test agree about that.

`testing/` is not a Django app, but `manage.py test` finds it — discovery walks the filesystem from
`backend/`, not `INSTALLED_APPS`, which is also why `config/test_locale_hint.py` runs.

### What each app covers

| App | Focus |
|---|---|
| `classroom` (86) | Courses run by users: visibility, enrolment, lessons, discussion, notifications, settings, staff roles, contributions, chapters, invite links |
| `booking` (137) | Availability arithmetic, the two availability modes against each other, what a hosted event does to them, the booking lifecycle, notifications, listing deletion, the tutor's own calendar, and (`test_week_schedules.py`, 64) weeks that replace the repeating pattern: precedence, merging, what a copy carries forward, bulk apply |
| `events` (60) | Visibility and drafts, authoring and location validation, attendance and capacity, the private roster, notifications (including the deliberate silences), the kill switch, and the schedule integration |
| `identity` (83) | Sign-in provider drafts, schools, the USOS seam, consent gating, standing, and (§17BR.B) the **learning record**: the two blocks gated separately, `null` rather than 404 when nothing is shared, a minor's record withheld with its reason whatever the consents say, the owner getting `is_owner` back with both blocks empty, `viewer` widening nothing for a stranger, the provider registry idempotent and the metric union zero-filled, an unknown metric key kept rather than dropped, and the two `distinct()` ordering traps pinned by exact counts |
| `study` (21) | Study sets, and (§17BR.B) the minors fix: a minor's shared set answers an empty `owner_display_name` with `owner_anonymous` true, for **every** reader including the owner, while an adult's still reads as theirs and `owner` is untouched so the private-set notice keeps working |
| `accounts` profile extras (21) | Experience, skills, the derived activity feed, the demo-content seed, and the clock/week-start display preferences |
| `config` (16) | The Unicode-aware `ucontains` lookup and the Polish-diacritics bug it fixes, driven through the two browse `?q=` paths as well as the queryset — see `config/test_dbsearch.py` |
| `moderation` | Reports, auto-hide, the queue, node governors, feature-flag kill switches |
| `galleries` (28) | Pictures on a piece of content (root `HISTORY.md` §17AY) — weighted at refusals: an **unpublished exercise's gallery is not readable by a stranger** (the leak the visibility module exists to prevent), an unknown target type is 404, a disguised executable is refused, the stored picture is a bounded WebP with the camera tag gone and a small one not blown up, the per-gallery ceiling and the shared byte allowance both refuse, somebody who merely uploaded a picture **cannot reorder** while a material- or branch-level governor can, a partial order is refused rather than guessed at, a child's picture waits for a moderator, the kill switch closes the surface while staff get through, and a picture is reportable |
| `moderation` governor applications (25) | `moderation/test_governor_applications.py` — applying to look after a discipline, branch or material: an empty application refused, applying twice refused, the queue is oldest-first and the position honest, an applicant sees only their own, a **governor of the branch above cannot decide** (delegated granting is deliberately not built), declining needs a reason, deciding twice is a clean 409, and — the interlock — approving is what makes `is_governor_of_material` start answering yes |
| `messaging` encryption (20) | `messaging/test_encryption.py` — bodies encrypted at rest (root `HISTORY.md` §17AX). Every check that matters reads the **database row**, because an unencrypted body round-trips through the API perfectly: the column does not contain the words; both people read them back; a reply too; the subject deliberately in clear; a list decrypting every row and not just the first (one shared child serializer); a legacy plaintext row still readable and the `encrypt_messages` command converting it idempotently; a row sealed under another key surfacing as `body_unavailable` with a 200 rather than a 500; tampering detected; a wrong-length key refused |
| `coauthoring` (173) | A material's project, its team and its immutable versions (`COAUTHORING-BRIEF.md`) — weighted at the refusals and the races: a stranger gets **404** on a draft project and its versions while a `seeking_coauthors` draft answers with a teaser (same keys, private halves empty), `visible_projects` is pinned AGAINST `can_view` row by row (house rule 4's two halves), a save against a stale basis is **409 carrying the head**, a second decision is 409, a second `published` row is an IntegrityError, the projection equals the material after publish (file, url, body, title, description) and clears the two shapes it is not, the per-account byte quota counts version files, the deciding circle is checked per state (member / staff / material governor / branch governor / proposer / stranger), a rejection needs a note and reclaims the blob while keeping the row, all five invite refusals including the last-use race, the join-request flow and its six block reasons, minors refused from owning but allowed to propose, the kill switch closing the API for an ordinary account and not for staff, notifications gated by preference and linked to the PROJECT before there is a material, a feed row for a new version of a published material and **none** for a first publication or for the backfill, `translation_stale`, and two query-count assertions that pin the reverse-one-to-one N+1 shut on both material listings |
| `moderation` material versions (9) | `moderation/test_material_versions_queue.py` — the queue's `material_versions` section. What it shows (a first publication, a proposal on an orphan project) and, more to the point, what it **does not**: a proposal a project's own team can decide never reaches a moderator, which is the whole open-science bet. Branch-scoped for a governor and unscoped for staff, a zero-grant governor sees nothing (the `None`-vs-empty-set distinction), the badge count agrees with the section, and `_KIND_MODELS` deliberately gains no new kind — decisions go through the app's own endpoint |
| `coauthoring` submit path (93) | `coauthoring/test_submit_path.py` — the single-shot upload after it was folded into a project with a team of one (`HISTORY.md` §17BC, phase 3). The whole retired `MaterialSubmission` suite ported rather than dropped: content-sniffed uploads, the image re-encode (EXIF and GPS gone, a tall scan bounded, a PDF byte-for-byte), the per-account byte quota with the incoming file weighed, the verified-only restriction (a 400 on the FILE, so a link or a written body still goes through), link-only materials, the auto-publish fast path, approval creating a real published material with its provenance/requirements/coverage, distinct slugs for two identical titles, the rejection reclaiming the blob and keeping the row, throttling, and the two switches answering per project (a first publication to `material_submissions`, everything else to `coauthoring`). Plus `FoldMigrationTests`, the project's first `TransactionTestCase`, which migrates backwards and runs the fold for real |
| `concepts` (92) | Wiki articles per audience built from blocks (`CONCEPTS-BRIEF.md`, root `HISTORY.md` §17BD) — weighted at refusals and races: a stranger gets **404** on a concept whose only article has only a pending revision while its author gets 200, a verified contributor's first revision is `published` and a plain user's `pending`, a minor verified contributor still queues, the article's author can decide a stranger's revision of it and a stranger cannot, a stale submit is **409 carrying the head** and a second decision is 409, exactly one `published` per article after two accepts (supersede-first), reject needs a note, withdraw and draft PATCH/DELETE by the author only, `draft_exists`, two articles on one page order pinned-first then newest head and `?article=` picks the other, `resolve_page`'s fallback order with its exact flags, the list narrowing by `content_locales` with the hidden count and `?audience=all` NOT narrowing, `?q=` finding a word inside a formula's source, `clean_blocks` refusing an unknown kind / an over-long body / a missing asset / an image asset in a pdf block and stripping a `<script>`, `expand_blocks` at two queries for any number of blocks, an asset upload re-encoding a PNG and refusing a PE named `.pdf`, the quota counting assets, the link circle (adder / staff / governor / stranger / minor), self-link, prerequisite on an exercise, duplicate 409, body links harvested across articles and re-synced when a mention goes while manual rows stay, `body_origin` refusal, the chip-row read listing only visible concepts and `[]` with the flag off, the queue section branch-scoped for a governor and unscoped for staff with a branch-less concept reaching staff only, the three notifications gated by preference and carrying `concept_slug`, a feed row on first publish and on a later one and none for a draft, report removal hiding the article and — when it was the last — the concept and its backlinks, tag apply with `kind='concept'`, and `seed_concepts` idempotent |
| `materials` validators (7) | `materials/test_validators.py` — moved unchanged when `MaterialSubmission` was retired: a real PDF/PNG/LaTeX accepted, an executable renamed `.pdf` refused, an oversized file refused, a disallowed extension refused, and `scan_for_malware` degrading honestly with no daemon reachable |
| `exercises` material links (39) | `exercises/test_material_links.py` (26) + `moderation/test_submission_material_links.py` (13) — exercises attached to materials (`HISTORY.md` §17BE): listing and linking, a duplicate pair 409, an unpublished exercise 404, the scoped PATCH/DELETE (creator, staff, the material's governor and its submitter may; a stranger gets 404), the `?material=` filter, the reverse listing, and a submission that names a material becoming a real link on approval — on the moderator's path and on the verified-contributor fast path alike |
| `exercises` batch import (8) | `ImportExercisesCommandTests` in `exercises/tests.py` — `manage.py import_exercises` (root `HISTORY.md` §17BQ, `.claude/skills/import-exercises/SKILL.md`). One file becomes an Exercise + its one published translation + two **pinned** entries + a source row; `verified` is **derived** (true for the file with a `## Rozwiązanie`, false for the one without) and never read from front matter; a second run is `0 created, 2 updated` and a tag a reader applied in between **survives** it; a file with no `number:` gets one and has it written back, which is what makes the re-run an update; one bad file (unknown difficulty, `verified:`, an unknown `## heading`, unbalanced maths) imports **nothing**; an unknown topic is refused until `--create-topics`; a re-run **does not republish** a row somebody hid; `--dry-run` writes nothing |
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

## Discussions under the standing pages (`community/discussions.py`, 2026-10-06)

**Django: `../.venv/bin/python3 manage.py test community.test_discussions`** — 55 tests. Key
parsing and what it refuses; `effective_policy`'s page-as-ceiling rule in both directions (a page
narrows its sections, a section cannot widen past its page) and the flag above both; every refusal
word `post_block_reason` answers with, including the `minor` rule that applies only to `anyone`;
what is held and what is not (anonymous always, staff never); who may read a held comment; and the
moderator's list, its counts and the fact that it has no DELETE.

Thirteen of those are from the closing cycle (2026-10-06): that a 403, a malformed body and a
reply naming a parent in another thread each leave **no `DiscussionLocation` row** while a held
comment still creates its own; that the count excludes a tombstone and a held comment while the
thread still carries the tombstone; the `discussion_location` field a report row now carries for a
comment held under a standing page (and `None` for every other comment — pinned here rather than
in `moderation/tests.py`, because the rule it tests is this app's); and the three conditions
`sweep_discussion_locations` requires, one test per condition failing.

**Django: `../.venv/bin/python3 manage.py sweep_discussion_locations [--dry-run]`** — not a test,
but the thing to run after a bulk import or anything that writes at a standing page. It deletes
`DiscussionLocation` rows with no comments, default settings and no `updated_by`; `--dry-run`
prints the candidates and changes nothing. On the development database on 2026-10-06 it found 4
locations and 0 candidates — every one of them had been configured through the moderator API by
`about-discussions.mjs`, which is the "somebody decided this" condition doing its job.

**Django: `../.venv/bin/python3 manage.py test community.test_management_discussions`** — 41 tests
(2026-10-08, `HISTORY.md` §17BY): a task, a plan, a need or a poll as a location. The key shape
and what it refuses; a missing row, a stranger on a closed board's task, a draft plan, a non-open
need and a members poll are each **404** on the policy read, the thread read and the write, with the
roster's twin answering 200; `needs.rules.can_view_need` agreeing with `public_needs` for three
readers; the two settings and the hold applying to a row; the report-queue key; both kill switches
(the row's own and `about_discussions`); the batched `?keys=` read — order, absence of unreadable
keys, dedupe, the 200-key cap, and that four keys cost the same queries as two (the exact count
this started as hid a real three-queries-per-key N+1 — the property, not the number, is what
matters); and the moderator's add form refusing a row that does not exist and a section under a row.

**Browser: `frontend/e2e/management-discussions.mjs`** — 45 checks, zero console errors (30 for the
threads; 13 added the same day for the folded board: the row carries no description, the modal
opens with `/tasks/<id>` in the address bar, Escape returns to `/coop` (`/about` until 2026-11-02),
the task page links back, a plan step's description is hidden from the list and shown in a
`?step=` modal that survives a reload and closes to a clean URL; 2 added 2026-11-03 for the
cleanup — the author deletes the public comment and a moderator removes the held one, which an
author's DELETE answers 409 for).

```bash
cd frontend && E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 \
  E2E_STAFF_TOKEN=<admin's token> E2E_USER_TOKEN=<student1's token> \
  node e2e/management-discussions.mjs
```

Finds the project's own organisation and one task, plan, need and poll on it through the API;
reads four policies in one request; 400 for `tasks/0`, 404 for `tasks/999999`; a member's comment
under the task counted exactly; the location row appearing in the moderation list; `staff` refusing
with its word and `moderated` holding — the held row listed for staff by id and shown to its author
as the placeholder (trap 31); the `tasks` flag taking the task's thread down and leaving the plan's;
then in the browser the line under the task on `/about` with the exact count, ONE policy request for
the whole tasks panel (asserted on the network), the thread open in place, the same line on
`/tasks/<id>`, one line at the foot of `/plans/<id>`, and the moderation tab linking `tasks/<id>` to
the task and naming the kind. Cleans up by deleting both comments as their author and re-reads the
count. Tokens from `manage.py shell` (trap 30), falling back to the form. On `/about` the task is
folded, so the script clicks `[data-task-row=<id>]` first and finds the discussion line inside
`.modal-panel` — with `.first()`, because the card draws its subtasks as nested `article.task`s.

**Browser: `frontend/e2e/about-discussions.mjs`** — 51 checks, zero console errors (35 until 2026-10-15, when it was rewritten for what `/about` draws now; 31 until 2026-10-06; closing step E added the held-count link and the clean-up re-query, and made the count assertion exact).

**Rewritten 2026-10-15 (WP9).** Since `/about` became the EdMat organisation's page it keeps ONE
location of its own, `about#money-and-openness` (the research thread's), and the script had gone on
driving the brochure's `mission`/`origin`/`features`/`closing` — "collapsed lines… found 2" and then
a timeout. It now plays every policy on that one location in turn (`anyone` → `users` → `verified`
→ switched off), reads the location's original policy first and **puts it back at the end, and on
an abort**, and scopes its `/about` counts to `article.about` — the second collapsed line on the
page is the organisation description's row discussion, which `management-discussions.mjs` owns. The
four module showcase pages' checks run first, unchanged — six since WP6 (2026-10-15) added
`/about/account` and `/about/licences-and-data`, seven discussable sections each (57 checks).

**Retargeted 2026-11-02 (§17DD).** `about#money-and-openness` left `/about` with the association
(`work/edmat_project.py: RETIRED`), so `/about` has no standing-page location of its own any more.
The same policy cycle now runs on the manual chapter `/about/guide/courses`, whose one thread is the
page's own row (`section=''`) — created through the moderator form when a fresh database lacks it.
The separate "a manual chapter has one thread" check went (it is now the main check), so the count
is one lower.

```bash
cd backend && ../.venv/bin/python3 manage.py migrate   # trap 23: the tables are new
cd frontend && E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 \
  [E2E_LOCALE=en] node e2e/about-discussions.mjs   # Polish by default; E2E_LOCALE=en for English (WP7)
```

It drives the surface as a reader meets it: the collapsed lines are drawn, and **no thread is
fetched until one is clicked** — asserted on the network, not on the DOM, because an absent thread
would also "pass" if the fetch had happened and failed. Then: a switched-off location draws no
affordance at all (house rule 3, not a disabled line); a visitor gets a composer and a name field
where the audience is `anyone`; what they write is accepted, comes back marked held, is invisible to
everybody else and visible to staff; a signed-in comment appears at once; an unverified reader gets
the verified-only sentence and no composer; a manual chapter draws exactly one discussion; and with
the flag off there is no affordance anywhere while the policy endpoint still answers.

It needs `admin` and `student1` with password `password123` (override with `E2E_STAFF`,
`E2E_STAFF_PW`, `E2E_USER`, `E2E_USER_PW`) and since 2026-10-06 it **clears up after itself**, so
the count check asserts an exact number — the count it read from the server before it wrote
anything, plus the one public comment it wrote. Cleanup uses the two removals this platform
already has rather than a delete endpoint nobody should add (house rule 12): the signed-in comment
is deleted by its own author (a tombstone), and the anonymous one — which was held, so never
public — is removed by staff through the report queue `hold_for_review` filed for it. Both are
re-queried **authenticated** at the end (trap 12). Two things it taught, both already in
`e2e/CLAUDE.md`: waiting for
`.section-discussion__body` proves nothing, because the panel appears instantly carrying
"Loading…" (trap 25), and a long chain of full page loads exhausts the dev server into
`ERR_INSUFFICIENT_RESOURCES`, which reads exactly like the feature being broken (trap 3).

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
node e2e/classroom.mjs               # the enrolment lifecycle; ola/bartek/julia by token; creates and deletes its own course
node e2e/education-auth.mjs
node e2e/material-claims.mjs
node e2e/material-claims-rework.mjs   # E2E_BASE=http://localhost:5173; signs in as ola@edmat.example
node e2e/coauthoring.mjs              # co-authoring end to end; kasia/ola/michał/julia; leaves its scratch projects (no delete endpoint)
node e2e/materials-coop.mjs           # the cooperation overview: panel designs, /coop page, policy, team thread, switch; kasia/ola/julia; leaves its scratch material
node e2e/exercise-material-links.mjs  # exercises linked to materials; ola on material 1 + exercise 2; removes its own link
node e2e/concepts.mjs                 # concepts end to end; needs seed_demo_users + seed_concepts; leaves its scratch concept (no delete endpoint)
node e2e/course-claims.mjs            # E2E_COURSE=<public course id with a subject branch>
node e2e/login-return.mjs
E2E_USER=<id> E2E_PUBLISHED=55 E2E_PRIVATE=2 node e2e/profile-exercise-counts.mjs   # needs an account with >50 exercises; see its header
node e2e/issue-reports.mjs            # E2E_API=http://localhost:8000/api; signs in as ola + kasia, toggles the `issues` flag and restores it
node e2e/phone-navbar.mjs             # 390px: ☰ in the bar and tucking with it, the drawer's own ✕, the focus trap
E2E_TOKEN=<kasia> E2E_USER_TOKEN=<michal> node e2e/account-menu.mjs   # the grouped account menu + Help (WP8): both locales, keyboard, drawer at 390, dark; flips `flashcards` off and back on
node e2e/language-default.mjs         # the Polish default, the GeoIP hint, the picker at the top of the drawer, the Messenger-bar clearance; signs nobody in
node e2e/learning-record.mjs          # the learning record on a public profile (§17BR.B); kasia (API, grades + sets) + ola (a real guardian-created minor and their public set, both deleted afterwards); toggles `share_activity` and the `learning_record` flag and restores both
node e2e/make-a-deck.mjs             # the three "make a deck" buttons (lesson / session / concept) against the real POST /api/decks/ (§17BU.D); michał runs the course + event, ola is the participant/visitor, kasia only flips the flag; builds and removes its own course, event and every deck
node e2e/about-page.mjs               # /about as the project's organisation page (2026-10-08): both locales, both themes, phone width, the open board drawn for a stranger with nothing to press, five kill switches hiding their cards, the "New here?" strip and the Explore section (WP7); since WP11 it also asserts that with `organizations` off the page sends NO request for the organisation (it used to excuse a 401); needs the EdMat seed; kasia's token or login only to flip the flags
E2E_TEACHER_TOKEN=<school.teacher> E2E_STAFF_TOKEN=<kasia> node e2e/wp11-fixes.mjs   # WP11's five fixes (41 checks + 1 skip): a school class reads "A school class" with no versions panel, the People tab's under-16 badge on the pupil's line, no Markdown asterisks in four manual chapters + /about/contests (both locales), /about/tutoring says the hours are Polish time and no longer names UTC (since ux/tz-warsaw), /about with `organizations` off asks for nothing and logs nothing; needs seed_school_demo; flips `organizations` off and back on — run on a DB copy
E2E_TEACHER_TOKEN=<school.teacher> E2E_STAFF_TOKEN=<kasia> node e2e/wp12-schools-tidy.mjs   # WP12 (73 checks): the /courses hub's "General courses" chip leaves out a LISTED school class (en/pl, 1280/390) while "All" shows it; a school may not run a version (`course_is_version`) or a general course with versions (`course_has_versions`) — the organisations panel says why, nothing is linked, `supports` still works; a body running a version may not turn into a school (the manage page says why); needs seed_school_demo; lifts the creation gate for its two scratch courses, makes the class public and the school "Other" for the run, puts all three back — run on a DB copy, and wait 60 s between runs (the anonymous read cache)
node e2e/showcase.mjs                 # the fourteen design-showcase pages under /about/<feature>, their screenshots, live links and switches; signs nobody in (E2E_TOKEN adds the signed-in /work check; E2E_NO_BACKEND=1 runs with the API down)
node e2e/showcase-screens.mjs         # re-takes the module pages' screenshots into static/showcase/<slug>/ (E2E_TOKENS=<json of DRF tokens>; writes one demo goal; ONLY=<slug,…> for a subset)
node e2e/exercise-claims.mjs          # E2E_EXERCISE=<published exercise id>, default 51
node e2e/exercise-card-click.mjs      # E2E_BASE=http://localhost:5173, E2E_BRANCH=<slug>, default analiza-matematyczna; signs nobody in, saves to the guest working set only
node e2e/taxonomy-other.mjs           # creates e2e-other-* nodes + one submission; delete them after
node e2e/solution-entries.mjs         # E2E_EXERCISE=<published exercise with pinned corpus entries>, default 1; ola + michal + kasia, resets its own scratch first
node e2e/activity-feed.mjs            # the activity feed + micro-posts; ola + michal (UI) + kasia (API); toggles the `posts` flag and restores it; cleans its posts
E2E_ASKER_TOKEN=<ola> E2E_ANSWER_TOKEN=<michal> E2E_STAFF_TOKEN=<kasia> E2E_MINOR_TOKEN=<persona.child> node e2e/ask.mjs   # WP15 (59 checks): ask a question in a tag from the hero, en+pl, 390+1280, a reply, the minor's hold, the `posts` switch off for a non-staff account (restored); tombstones its own questions (marker WP15-e2e) at both ends; E2E_TAG defaults to indukcja
node e2e/pdf-preview.mjs              # E2E_MATERIAL=<hosted-PDF material id>, default 1; signs nobody in
node e2e/topic-threads.mjs            # E2E_MATERIAL=<material with covers claims>, default 1; ola (UI) + kasia (API); cleans its marker posts
node e2e/audience-bands.mjs           # audience chips/badges/forms (§17AL); kasia (API) + ola (UI); creates and deletes one listing, resets ola's filter
node e2e/audience-browse.mjs          # browse by audience first (§17DE): the lens on /disciplines, /disciplines/<d>, /branches/<b>; counts, the fold, ?audience= both ways; read-only guest, 390 + 1280, pl + en
node e2e/audience-radio.mjs           # the chip row as a RADIO group (single-select); kasia submits + deletes two scratch exercises, ola gets two pinned bands and is restored; waits out the 60 s read cache first (E2E_NO_CACHE_WAIT=1 to skip)
node e2e/event-programme.mjs          # the programme (§17AM); kasia builds it on the page, ola bookmarks/asks/exports; deletes the scratch event
node e2e/event-registration.mjs       # registration (§17AN); kasia/ola/michał; clears the login throttle cache first if re-running (backend/cachedata)
node e2e/event-contributions.mjs      # the call for contributions (§17AO); kasia (host) / michał (reviewer) / ola (author); deletes the scratch event
node e2e/guardian-accounts.mjs        # guardian accounts + minor defaults (§17AP); kasia makes and deletes a child 'e2e-zosia'; clear backend/cachedata BEFORE (never during) a run
node e2e/sorting-and-languages.mjs    # sort keys in the URL + the content-language rule (§17AQ); English-interface contexts; resets ola's content_locales
node e2e/comment-attachments.mjs      # pictures/PDFs on comments (§17AR); ola on exercise 1 with generated files; deletes its marker comments
node e2e/rich-editor.mjs              # the Tiptap editor + maths palette (§17AS); ola on exercise 2; resets her editor_mode to source
node e2e/comment-input-kinds.mjs      # the six input kinds + inline pictures + chemistry (§17AV, §17BA); ola on exercise 2; kasia toggles the `chemistry` flag; ~3 min (Indigo WASM)
node e2e/notebook-anchors.mjs         # notebooks + comments on one part (§17DI); ola on exercise 2, kasia writes a notebook solution; E2E_TOKEN_OLA/E2E_TOKEN_KASIA skip the login throttle; deletes its marker comments and entry
node e2e/sketch.mjs                  # the freehand whiteboard (Excalidraw); ola draws a real stroke on exercise 2; kasia toggles the `sketches` flag; leaves its two sketch rows (no delete endpoint)
node e2e/reading-comfort.mjs          # text size / high contrast / 44px floor / hero copy (§17AT); a guest + ola; resets her text_size/high_contrast
E2E_PROD=http://127.0.0.1:5190 node e2e/fcp.mjs   # against a static serve of build/ with 200.html fallback
node e2e/classroom-overhaul.mjs      # staff, contributions, locked chapters, invite links; ola/julia/bartek/michał by token
node e2e/profile-overhaul.mjs   # seed it first: manage.py seed_profile_showcase
node e2e/booking.mjs
node e2e/wp14a-flows.mjs        # the audit's broken flows (WP14a); E2E_OLA_TOKEN / E2E_KASIA_TOKEN; PL at 390 + EN at 1280; deletes its submissions, cancels its booking requests
node e2e/schedule-editing.mjs
node e2e/events-and-nav.mjs
E2E_BASE=http://localhost:5225 E2E_API=http://127.0.0.1:8125 node e2e/polls.mjs   # polls end to end (§17BI.E); kasia creates, opens, votes and closes a poll on her own event
node e2e/known-issues.mjs
node e2e/course-search.mjs
node e2e/navbar-stages.mjs
node e2e/course-content-links.mjs
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

**`e2e/concepts.mjs` (60 checks)** — concepts end to end (`HISTORY.md` §17BD): a plain user creates a
concept with markdown, formula and picture blocks → invisible to a second browser → staff accept it from the moderation
`concepts` tab → it is on `/concepts`, the home tab and search; a verified contributor writes a `primary` article with a
chemistry block (made through the API — Ketcher's 21 MB editor has its own script) and a PDF block → a `primary` reader
sees it and opens the PDF preview, a `senior` reader sees the fallback notice; a second person writes their own `primary`
article → the pool lists two and `?article=` switches; an edit against a stale head gets the 409 dialogue; the article's
author accepts a stranger's revision from the history page; `[[derivative]]` renders as a link and shows as a backlink;
linking an exercise from the concept page puts the chip on the exercise page; flag off hides tab, nav, chips and search.
Run with `E2E_BASE` + `E2E_API` set (8012/5183 matched `frontend/.env.e2e` on the first run); per-person browser
contexts (leaked SSE streams exhaust Chromium's per-origin pool); non-2xx responses are recorded with their URL and only
the deliberate 404/409/gate refusals forgiven; 17 screenshots in `e2e/screenshots/concepts-*.png`. Leaves its scratch
concept behind (no delete endpoint). Three consecutive clean runs on 2026-09-23.

**`e2e/materials-coop.mjs` (47 checks)** — the cooperation overview of a material (`HISTORY.md` §17BH).
Kasia (staff, API only) publishes a scratch material `e2e-coop-<stamp>` in one request, adds ola and
hands it over. Julia, signed in but a stranger, reads the panel on the material page (version line,
policy badge, the two-row roster), switches it to the timeline and the tiles from its kebab and sees
the choice survive a reload; follows "Cooperation page" to `/materials/<id>/coop`, walks Overview /
Team / History / Discussion, and posts in the team thread (which the material's public thread does
not receive). Ola sets the policy to "by request" with a welcome note; julia's panel then refuses her
in words, the API refuses her proposal with `members_only`, the team view offers "Ask to join" and she
asks; the thread has no composer for her any more. Ola sees the Team tab's badge, the application,
accepts it, and the roster grows to three. Finally the `coauthoring` switch is turned off as kasia
and checked as julia: no panel, the unavailable notice on the page, 403 from the API; and back on.
Screenshots `e2e/screenshots/coop-*.png`. No cleanup for the material (no delete endpoint); the
switch and both accounts' `content_locales` are restored.

**`e2e/coauthoring.mjs` (52 checks)** — co-authoring a material end to end (`HISTORY.md` §17BC),
four seeded people in four browser contexts. Kasia (staff, by API token) makes sure `coauthoring` and
`material_submissions` are on and remembers their state; ola starts a scratch project `e2e-coauth-<stamp>`
with a generated PDF and publishes it — the script accepts either outcome and, when it was queued,
kasia accepts it through the version decision endpoint; the material page then carries the project
panel naming the version and its author. Ola mints an invite link; michał opens it (the page says who
is inviting and to what), accepts, lands on the project page and is on the team, and the link counts
its use. Michał saves a new PDF as a draft; ola publishes it **with the version page's Publish
button**, and the material's Download link changes to the new file — the projection following the
version. Julia proposes a link from the material page's "Improve this material" (told what publishing
means and that a person will read it); ola rejects it on the version page, Reject refused until a
reason is typed, the confirmation shown; julia reads the reason on her version page and the material
still serves version 2. With `coauthoring` off (as julia, not staff) the material page still works,
the project panel is gone and the account menu has no co-authoring entry. Flags and content-locale
preferences are restored in a `finally`; the invite link is revoked, which is the one cleanup this
API supports — the scratch projects stay, named `e2e-coauth-*`.
`E2E_BASE` (default `http://localhost:5183`), `E2E_API` (default `http://127.0.0.1:8011/api`),
`E2E_SHOTS`.

**`e2e/exercise-material-links.mjs` (21 checks)** — exercises linked to materials (`HISTORY.md`
§17BE). A signed-out reader sees the "Exercises from this material" section with no Add or Link
controls; ola, signed in, links exercise 2 to material 1 through the picker with a role and a
locator, sees the row as a real exercise card with its chips, finds the material in the exercise
page's "From material" block, follows "Add an exercise" to `/submit?material=1` (the chip, the role
and locator fields, the material's own branch pre-selected, the chip dismissible), then removes the
link and confirms through an authenticated request that it is gone. Two waits worth knowing: the
branch is filled in two requests after the chip appears, and the remove control appears only once
the signed-in user is known — both are waited for, bounded, rather than read from the first frame.
`E2E_BASE`, `E2E_API`, optional `E2E_MATERIAL` (default 1), `E2E_EXERCISE` (default 2).

**`e2e/classroom.mjs` (56 checks)** — the enrolment lifecycle of a course somebody runs, driven
through the page as it is today (rewritten 2026-09-10; the original predated every rewrite of the
course page). Ola runs it, bartek and julia take part, a signed-out stranger looks on — seeded
accounts, tokens written straight into localStorage, a fresh course per run deleted at the end:
the nav and the browse page; a course created through the real form starting as "only you" (a
stranger gets "does not exist"); published through the edit form with approval required and then
listed; a lesson whose blurb everybody sees and whose participant notes a stranger and a pending
requester do not; the request with its note on the People tab, approved, "Taking part: 1"; the
notes unlocked by membership; `/courses/mine` splitting run from taken; leaving giving the seat back
and asking again allowed; a full course refusing the next person in words with no button; a cap
below the people already in refused; somebody removed told why and given no way back; the
Discussion tab withheld from a stranger entirely; a participant posting, the instructor seeing it
and being notified with a link back; a public thread readable by an outsider who is told joining is
what lets them post and gets **no composer**; the discussion turned off taking the tab with it; the
per-course mute saved server-side; the account-wide setting row. Every context reads Polish content
(the course is Polish), and the public-thread reader is the removed member rather than the stranger
because the stranger's earlier anonymous reads are in the 60 s read cache.

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

**`e2e/classroom-overhaul.mjs` (37 checks)** — running a course with more than one person, through
the current management page (rewritten 2026-09-10). Ola creates a public, open course with the
contribution policy set on the create form; the owner is listed and locked on `/courses/{id}/manage`;
julia is made an administrator by account id, is offered the management page herself, and cannot
touch the owner; two chapters through the manage page's form, one opening in 60 days, drawn locked
with the staff wording and the participant wording; bartek joins, sees the locked chapter with its
opening time and no management link, files a corpus material through the title picker with a note
and sees it marked pending; a signed-out visitor sees none of it while staff see "1 waiting"; the
**co-admin** accepts it from the queue (which names the contributor and the note), after which the
contributor, the course and a visitor all see it; an invite link minted by the co-admin, read
signed-out (whose course, "Log in to accept", nothing else leaked), accepted by michał who lands on
the course as a participant, its use counted; revoked, it stays listed as Revoked and refuses a
fresh visitor. The four signed-in accounts are given Polish content through the API for the run and
put back afterwards — a signed-in profile's own `content_locales` overwrite the localStorage extras
once it loads, which is how the picker first came back empty.

**`e2e/polls.mjs` (15 checks)** — polls end to end (`HISTORY.md` §17BI.E). Kasia hosts a scratch
event (she is both its manager and, as staff, an eligible member), creates a two-option poll
through the real create form, opens it, votes for the first option, closes it with a decision
note, and reads the results back both on the `ManagementPanels` panel (mounted on the event page)
and on the full-size `/polls/[id]` route. Checks: the panel mounts; the poll is created as a
draft with exactly two options (verified through the API); opening flips it to `open`; voting
records a ballot and is reflected as `has_voted` on reload; the vote is actually tallied for the
chosen option (`GET /api/polls/{id}/results/`, read as the manager, since results are hidden from
non-managers while a poll is open); closing flips it to `closed`; the decision note and a result
bar showing one vote for "Sobota" render on the panel; a turnout line ("Zagłosowało 1 z 1")
renders; the same decision note and results render on `/polls/[id]`; the scratch event is removed
afterward; and no console/page errors. Ran against real dev servers on ports 8125/5225.
The poll itself (and its options/ballot/vote rows) is left behind once the event is deleted — a
`GenericForeignKey` has no cascade, and `DELETE /api/polls/{id}/` refuses anything past `draft`
(`409 not_draft`) — the same "scratch data left behind" precedent as the claim scripts (trap 19).
The dangling row is inert: `decisions/rules.py: poll_node` returns `None` for a missing node, so
every endpoint 404s on it.

**`e2e/booking.mjs` (54 checks under `TZ=Europe/Warsaw`, 53 elsewhere)** — three people in three contexts, because the entire feature is
about the same grid of buttons meaning two different things. A tutor publishes one 14:00–17:00 Tuesday
rule through the real form (having first been told, correctly, that nobody can book them without one)
and it becomes three one-hour slots. The same window is captioned differently on a `derived` and a
`declared` listing. A student requests an hour and is told it is a **request**, not an appointment. That
hour then vanishes from the derived listing and stays on the declared one; a second person asks for it
anyway and is accepted. **The clock** (2026-10-15, `ux/tz-warsaw`): the API's first slot must be the rule's `T14:00:00+0X:00`, the browser must draw it on its own clock, and under `TZ=Europe/Warsaw` that must be 14:00 — the hour on the tutor's rule list (it read 16:00 while `TIME_ZONE` was UTC). Run it with `TZ=Europe/Warsaw` for that proof; the script prints the zone and the hour it saw either way. Its contexts are English (`english.mjs`) since the same day; it had been failing at check 2 on the Polish default. The tutor is warned the hour is contested, confirms one, is **refused** on the
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

It had also been failing its very first tab check since the interface went Polish by default
(2026-09-23, `e2e/CLAUDE.md` trap 24) — every check names English copy — and since WP14a
(2026-10-15) its people read the English interface through `englishContext`. The student's tab is
"Booked by me" now: the page is "My bookings" / "Moje rezerwacje", one name everywhere.

**`e2e/wp14a-flows.mjs` (66 checks, WP14a, 2026-10-15)** — the first-visitor audit's broken flows,
each driven the way a person meets it, once in Polish on a 390 px touch screen and once in English at
1280. `/submit`: the success notice is scrolled into view and focused, and links to `/submit/mine`;
kasia rejects the submission with a reason through the real moderation endpoint, and `/submit/mine`
lists it as not accepted with that reason; the rejection notification links to the same list;
`/users/{me}/unpublished` counts what is waiting and no longer says everything is published. A
tapped tutoring slot keeps a readable selected state under the touch screen's sticky `:hover`;
"See your bookings" opens `/bookings?tab=mine`, the page is "Moje rezerwacje" / "My bookings" and
opens on "Booked by me", and a tab click writes `?tab=` into the address. Settings' standing and USOS
sections carry no English developer text in Polish, the register form names the institutional
provider in the interface language and Apple's card has a mark, an exercise's rating line agrees with
its number ("3 recenzje", "3 reviews"), and saving to the working set says "added". Signs in by token
(`E2E_OLA_TOKEN`, `E2E_KASIA_TOKEN`; it falls back to logging in, which spends the throttle), deletes
its two submissions through the API and cancels its two booking requests (a booking has no delete),
both confirmed by an authenticated re-query. `E2E_LISTING` (default 7) is a listing with published
hours that ola does not own; `E2E_RATED_EXERCISE` (default 1) one with exactly three reviews.

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

**`e2e/course-content-links.mjs` (23 checks)** — linking real content from the chapter/lesson edit
dialogs, and the two new actions on a comment. The section is rendered INSIDE a dialog that is already
a `<form>`, so one check is that it brings no nested form of its own: browsers resolve that by
silently dropping the inner one, and the "Add link" button would then submit the dialog and save the
chapter instead. Then a **pasted address** becoming a real `CourseItem` (asserted through the API, not
from the page redrawing), nonsense refused in words with nothing filed, and the comment menu offering
Save / Link to a course / Copy link — each acting on **the comment this run created**, located by its
own `#comment-<id>` anchor, because a real exercise page already has a thread on it and `.first()`
silently acted on somebody else's comment for two runs.

Two traps it encodes. Waiting for the login form to be *visible* is not waiting for it to be
interactive — the input is in the server-rendered HTML, so a click can land before hydration and be
handled by nobody, which then looks exactly like "the curator's buttons are missing"; the script
asserts it is actually signed in before going further. And it counts, then ignores, 403s on
`/@fs/…` paths: Vite refuses to serve outside the project root, so a checkout whose `node_modules` is
a symlink (a git worktree) 403s on KaTeX's fonts — an artifact of where the checkout is, not of the app.

**`e2e/known-issues.mjs` (23 checks)** — the six entries from HISTORY.md §17V.7 that were real defects
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

**`e2e/material-claims-rework.mjs` (28 checks)** — a claim's popover shows ONE reading (a `covers`
claim never shows a "prior knowledge" line and vice versa), a requirement is proposed as a structured
claim with an exactly-typed level and appears bucketed with a requirement word, the accuracy and the
importance vote are tallied separately, a comment posts into the claim's thread and its score moves
1 → 0 → -1 through the arrows, an importance upvote moves a claim to the front of the list **and the
order survives a reload**, and the browse card's Requires chip opens the same popover. Creates one
`requires` claim (plus votes and a comment) as `ola` on material 1 — delete them with
`MaterialCoverage.objects.filter(kind='requires', proposed_by=ola).delete()` and the importance vote
before re-running, or the duplicate refusal (correct behaviour) fails the add step. Do not run
`npm run check` against a live dev server right before it: `svelte-kit sync` leaves Vite in a
"next HMR update reloads" state that breaks the script's next navigation.

**`e2e/course-claims.mjs` (13 checks)** — the covers/requires claims on a user-run course: both groups
render, no add button signed out, a covers and a requires claim proposed through the real form land
with the right depth words, the requirement popover shows only the prior-knowledge line, accuracy and
importance votes land through the course endpoints, a comment posts into the claim's thread and can be
upvoted, and the claim's comment count survives a reload. Needs a public course with at least one
subject branch (`E2E_COURSE`, default 6); creates claims as `ola` — delete
`CourseClaim.objects.filter(proposed_by=ola)` before re-running. The one console 404 it tolerates is
the course page's own `GET /courses/{id}/attachments/` for a non-member, which predates it.

**`e2e/exercise-claims.mjs` (12 checks)** — the shared claim groups on an exercise page: both groups
render, the free-text requirement editor is gone, no add button signed out, a covers and a requires
claim proposed with the right depth words, the popover worded for an exercise, accuracy + importance
votes through the exercise endpoints, a comment posted and upvoted, and the count surviving a reload.
Creates claims as `ola` on the exercise — delete `ExerciseClaim.objects.filter(proposed_by=ola)` first.

**`e2e/taxonomy-other.mjs` (8 checks)** — the navbar says Exercises; on `/submit`, choosing "Other…"
for the discipline reveals a name box and forces the branch to "Other…" too; with both named, the
title and a statement, the form submits, and the API then lists the named discipline and branch as
`pending`. Creates `e2e-other-*` nodes and one exercise submission — delete them before re-running
(a second run hits "already exists").

**`e2e/fcp.mjs` (11 checks)** — First Contentful Paint on the production build, localhost and a
throttled link: on every measured route something paints well before the app has booted, the boot
shell is gone once it has, and with JS disabled a fallback route still shows the brand bar. Needs a
static server for `build/` that falls back to `200.html` (`python3 -m http.server` does not); the
throttled numbers are the ones that mean anything.

**`e2e/exercise-card-click.mjs` (11 checks)** — the whole exercise card opens the exercise, and
everything inside it that owns its own click keeps it: a click on the badges row and one on the
card's empty padding both navigate; the title link navigates and pushes exactly ONE history entry
(two would mean the card handler fired underneath it); the save trigger, the open panel's padding
and a real row in that panel all leave the page where it was; a ctrl-click does not navigate this
tab (the real link handles "open elsewhere"); and a drag that selects text is not a click. Signs
nobody in — the one save it performs goes to the anonymous working set in localStorage, so it
leaves no server state behind. Reads the target exercise off the first card rather than hardcoding
an id.

**`e2e/login-return.mjs` (5 checks)** — signing in returns to the page "Log in" was clicked on: from
the header on a deep page, from a login link inside a modal, across the login → register → login hop
(query string kept), a cold `/login` still landing on home, and a cross-origin `?next=` refused.

**`e2e/profile-exercise-counts.mjs` (10 checks)** — the profile's Exercises tile is the stored
counter, not the size of the feed's 50-row slice, and only the owner sees "+ N unpublished" linking
to `/users/{id}/unpublished` (a stranger and another signed-in user both get neither the link nor
the list). Needs an account with more than 50 exercises — the done.md entry for this work has the
`manage.py shell` snippet that seeds 57 (and note that a scratch `Exercise` needs an
`ExerciseSource` row, or the card mapper throws on `source.type`).

**`e2e/issue-reports.mjs` (34 checks)** — "Report issue": the link under the logo measured as drawn
over the bar with a hit area larger than its text; the modal pre-filling path/title/type; a guest's
anonymous public report (no reporter stored, checked via the API); a signed-in private report
404ing to its own reporter and listed for staff; a comment under a public one; staff resolving with
a note and the reporter's notification linking to the report; the phone drawer; and the kill switch
removing every link, the page and the API. Deletes nothing — remove `e2e-issue-*` rows afterwards.

**`e2e/solution-entries.mjs` (27 checks)** — the solution/hint pool (root `HISTORY.md` §17AH): the
anonymous reveal with counts and the pinned corpus originals; a plain user's (ola) entry queueing
with the composer's live KaTeX preview, visible to its author and to a verified contributor
(michal) but not to a stranger; one inline accept publishing it; a weighted (2×) vote; a verified
author's English entry publishing immediately and sitting behind "Show 1 more in other languages";
an edit suggestion sent by michal and APPLIED by the entry's own author; the moderation queue's
"Solutions & hints" tab with reject-needs-a-note; the author reading the rejection note; the
homepage Activity tab; and API cleanup back to the two pinned corpus rows. **Resets its own scratch
through the real API at the start using all three accounts' tokens** — a rejected entry is visible
to its author alone, so kasia's view cannot find ola's rejects. Each account signs in exactly once
(the login throttle). Two of the queue's pending entries are the migration's own (a pending
translation's hint/solution), so the tab count is asserted as a live number, not an exact one.

**`e2e/activity-feed.mjs` (20 checks)** — the real activity feed (root `HISTORY.md` §17AI): the
public feed page; publishing a post through the actual composer (branch anchor + an exercise
attached via the search picker); the anchor chip opening the feed filtered to that anchor; the
kind filter; the post's own page with its thread and the author's `comment_reply` notification
carrying `post_id`; Followed's honest empty state; the home-tab slice; delete-as-tombstone with
the feed forgetting the row; and the `posts` kill switch removing the composer, the filter option
and every post row from the feed API. Resets by tombstoning any earlier run's posts as staff.

**`e2e/pickers.mjs` (10 checks, zero page errors)** — lists instead of pasted ids (root `HISTORY.md`
§17CT, 2026-10-21). The edit form's "Part of" course picker moving a subcourse under another root
(the current parent as a chip, "change", a title search, the match chosen, the save, the API agreeing);
the manage page's person picker (the suggestions list or its honest empty line, the account-id
fallback, the add landing on the staff list); the chapter dialog's "Another course on EdMat" picker
filing a course item; the ask form's optional course. Tokens, not the login form. Deletes its three
courses at the end. Screenshots to `e2e/screens/pickers/`.

```
LD_LIBRARY_PATH=<extracted libs>/usr/lib/x86_64-linux-gnu E2E_BASE=http://localhost:5173 \
E2E_API=http://localhost:8000/api E2E_TOKEN=<michal> E2E_PLAIN_TOKEN=<ola> \
CHROME=<chrome-headless-shell> node e2e/pickers.mjs
```

Backend: `manage.py test config.test_people` (2 — the neutral `/api/people/suggestions/`: the
caller's rosters and nobody else, 401 signed out, unaffected by the `contests` switch).

**`e2e/subcourses-and-board.mjs` (27 checks, zero page errors)** — the course tree, outside content in a
course's programme and the course board (root `HISTORY.md` §17CS, 2026-10-21). A root course by API,
then a SUBCOURSE through the real form (`/courses/new?parent=<id>&as=subcourse`: the heading, the
"A subcourse of …" line, the kind question still asked), the new page's "Subcourse" pill and its
breadcrumb, the root's Subcourses panel with "Add a subcourse" for the owner and without it for a
stranger; by API, a chapter with three new item kinds (another course, an outside link, with `ftp://`
refused); the Board tab empty, "Post about this course" → `/ask?course=`, the form saying which course,
a question with a tag and a LINK attached, the landing back on the board with the post and "1 attached",
the post's page with the attachment, the ROOT's board gathering the subcourse's post, the post filed
into the programme; the content tab's Course / Link (new tab) / Post rows as a stranger; and the
`posts` switch off for a NON-staff account — no Board tab (restored in a `finally`). Tokens, not the
login form (trap 30); `E2E_TAG` must be an existing tag whose full name is typed (a five-letter prefix
of `granice` has more than eight prefix matches and the picker shows eight). Deletes its courses and
its post through the API at the end. Screenshots to `e2e/screens/subcourses-and-board/`.

```
LD_LIBRARY_PATH=<extracted libs>/usr/lib/x86_64-linux-gnu \
E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000/api \
E2E_STAFF_TOKEN=<kasia> E2E_TOKEN=<michal> E2E_PLAIN_TOKEN=<ola> E2E_TAG=granice \
CHROME=<chrome-headless-shell> node e2e/subcourses-and-board.mjs
```

Backend: `manage.py test courses.test_subcourses` (12 — the tree: the parent's-staff rule, the depth
cap, loops, moving and detaching, the cut breadcrumb, a class, both children kinds under `?parent=`,
the materials index over the subtree), `courses.test_content_links.CourseLinkAndPostItemTests` (6),
`activity.tests.PostCourseBoardTests` (3), `attachments.tests.PostTargetTests` (3); `test_kind.py`'s
one-level tests were rewritten for the tree.

**`e2e/course-licence-collab.mjs` (48 checks, zero page errors)** — a course's licence, one item's own
audience and collaborators from the create form (`HISTORY.md` §17DB). The real create form (CC BY-SA
picked, an address in "Invite by email"; the founder starts UNCONFIRMED, so the course is made and
the page stays to say why the invite did not go), then the address is confirmed through
`manage.py shell` and the manage page's email form sends it (sent / not an address / your own
address, exactly three answers; the invite list's "Sent to …"; the mail logged with `[[link]]`, not
the token). The course page as owner (the licence line, a corpus material's `unclear` note, the
"Staff only"/"Participants only" pills), as a participant and as a stranger (each sees what its
audience admits), the visibility select changing an item for real, the join page's licence line, a
Polish 390 px page with no overflow, and (§17DC) a course file's own audience: a staff-only upload through
the Files tab, a participant's staff-only homework, both lists, the row select, the file page's
licence line. Deletes its course at the end and re-queries.

```
LD_LIBRARY_PATH=<extracted libs>/usr/lib/x86_64-linux-gnu \
E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000/api \
E2E_TOKEN=<michal, verified> E2E_PLAIN_TOKEN=<ola> E2E_MATERIAL=<a published material, licence unknown> \
CHROME=<chrome-headless-shell> node e2e/course-licence-collab.mjs
```

Backend: `manage.py test courses.test_licence_privacy` (33 — `compare_to_container`, the course
licence on create/PATCH/widen, linked items' relations, attachment licences, the item audience through
the list, the lesson serializer, the materials index and the search, mailed invites and their
refusals, retention, a file's and a pinned set's own audience).

**`e2e/ask.mjs` (59 checks)** — "ask a question in a tag" (root `HISTORY.md` §17CO, WP15): in both
interface languages, the hero's "Ask a question" (signed out → a sign-in prompt; signed in → the
composer), asking through the real form (question, the folded tag search, the audience band), the
landing on `/tags/<tag>` with the question first, the same question in the activity feed, the Add…
menu's entry, the exercise tag chip's "Questions in this tag" link, a reply from a second account
with the list's reply count and the asker's `comment_reply` notification, and no sideways scroll at
390. Then: the picker mid-search and the tag page in the dark theme; a minor's question HELD (the page
says so, neither the tag page nor the feed lists it); and the `posts` switch off for a NON-staff
account — no hero link, no Add… entry, both pages "unavailable", no chip link, the API 403 — restored
in a `finally`. Tokens, not the login form (trap 30). Screenshots to `E2E_SHOTS`.

**`e2e/pdf-preview.mjs` (7 checks)** — the in-browser PDF preview (root `HISTORY.md` §17AJ): the
collapsed Preview section, nothing mounted before asking, a real page count, the canvas holding
genuinely painted OPAQUE pixels (the probe must require alpha — a transparent unpainted canvas
reads as "dark" under a red-channel-only check and passed vacuously once), paging, zoom growing
the rendered width, hide unmounting. Stateless; signs nobody in.

**`e2e/topic-threads.mjs` (14 checks)** — topic threads (root `HISTORY.md` §17AK): a covers claim
chip's popover linking "Posts about {topic}"; the topic-filtered feed rendering SCOPED (rows or
the honest empty state — an arbitrary topic can have zero retained rows, so asserting rows fails
on honest data); the composer pre-anchored with its "change" escape; publishing into the thread;
the post's anchor chip naming the topic and the API confirming the anchor; the link proven on a
material BROWSE card's chip and a course page's claim group too (live, not assumed from the
shared component); the exercise page's topic pills linking to their threads; no duplicated topic
row in a subtopic-less popover; the tag-chip menu's "Posts about this tag" (checked on an
exercise page — material cards don't render TagChips). Tolerates exactly the course page's known
pre-existing attachments-404 console error. Cleans up by marker text only, never wholesale.

**`e2e/audience-bands.mjs` (21 checks)** — the audience band (root `HISTORY.md` §17AL): a scratch
tutoring listing marked "Primary school" created through the API; the homepage chip row narrows the
Tutoring and Exercises tabs (exact counts), "Everything" restores them, a guest's choice survives a
reload, a signed-in click lands on `/api/auth/me/`'s `audience_filter` and shows ticked in Settings,
Settings saves a different list, and all four submit forms carry a required "Who is this for?"
select with no default. Cleanup is verified through an AUTHENTICATED request — the anonymous
`?audience=` list URL is served from the 60 s read cache and can still show the deleted row.

**`e2e/audience-browse.mjs` (47 checks)** — browse by audience first (owner, 2026-11-02; root
`HISTORY.md` §17DE). Read-only, as a guest, at 1280 and 390 in Polish plus one English pass. Every
expected number comes from the `counts` on `/api/disciplines/` and `/api/branches/` — the same
API the page reads — with the lens rule mirrored from `lib/utils/audienceCounts.ts`, so it holds on
any corpus that has `matematyka` → `analiza-matematyczna` and content in two bands. It covers:
"Dziedziny" and the "Dla kogo szukasz?" chips; on a first visit no lens line and no fold; a band
with nothing anywhere folds every card, the fold opens itself, Matematyka leads the fold, and a
folded card names who it IS for; a small band leads with the lens's own counts and the line says how
much it leaves out; "Pokaż wszystko" clears both the store and the address; a shared
`?audience=` link sets the lens on arrival; the branch page asks its lists through the lens and a
chip there refetches both tabs; the exercise breadcrumb is Home › Matematyka › Analiza; "Przeglądaj"
in the nav. Screenshots go to `E2E_SHOTS` (default `/tmp`). **Run it on a freshly started dev
server**: a Vite server that has lived through many edits served a Settings page whose checkboxes
ignored the profile (§17DE), and that reads exactly like a regression.

**`e2e/audience-radio.mjs` (41 checks)** — the chip row after it became single-select (Piotr,
2026-09-23: "selecting one audience on the home page should display content only for the selected
audience and work as radio button not as checkbox as it is rn"). Two scratch exercises, one
`primary` and one `secondary`, are created through the REAL submission endpoint — kasia is a
verified contributor, so `/api/exercise-submissions/` auto-publishes AND writes the published
English translation; a row posted straight to `/api/exercises/` has no translation and is invisible
to an English reader (§17AQ), which made every count zero against zero. Then, as a guest: one chip
checked at a time, `localStorage['edmat.audienceFilter']` holding a ONE-element list, the exercises
tab re-asking with `?audience=<band>`, every card badged with that band or "Everyone", the card
count matching the API for the very URL the page asked for, re-clicking the checked chip NOT
clearing it, "Everything" restoring the full list, and Arrow/Home moving the selection with focus.
Then, signed in as Ola with two bands pinned through `/api/auth/me/`: no chip checked and a
"Bands: 2 — set in Settings" hint, and one click collapsing the pin to a single band on the profile.
Screenshots at 1280 and 390 px. Two traps it pays: a fresh context reads the POLISH interface
(`baseLocale`), so it sets the `PARAGLIDE_LOCALE=en` cookie; and the anonymous read cache serves the
PREVIOUS run's list for 60 s with no write invalidation, so it waits the TTL out before the browser
ever opens the page.

**`e2e/event-programme.mjs` (23 checks)** — the programme (root `HISTORY.md` §17AM): a multi-day event
made through the API, then on the page: a track added inline, a session with a speaker and two
links pasted as addresses (an unreadable one refused in words), rendered under its day heading with
the pasted exercise resolved to its real title and links grouped by role, the week grid, a reviewer
added through the staff panel (API agrees); Ola bookmarks (button flips), adds the session's
exercises to My Set, asks a question, sees the session on /events/agenda, downloads the .ics (read
back from disk: BEGIN:VEVENT + the title), sees "On a programme" on the exercise page; moving the
session notifies her. Signed-out logins use `networkidle` (no SSE stream yet) — that is what waits
out Vite's cold compile of new components; a fixed settle did not.

**`e2e/event-registration.mjs` (26 checks)** — registration (root `HISTORY.md` §17AN): a form event
with capacity 1 and the public list on; Kasia adds a required question and a two-option choice
through the editor (API agrees); Ola sees "Register", the hybrid attendance question, a required
answer flagged before sending, then is going with her answers (baseline keys included); Michał sees
"Join the waiting list" and lands at position 1; a stranger sees "Ola N." and never "Ola Nowak";
Ola withdraws → Michał's page shows the offer with its deadline and "Claim my seat", claiming seats
him, the offer arrived as a notification; Kasia checks him in and undoes it; the CSV download
(read back from disk) carries the question column and both answers. Then approval mode: "Ask to
join", the pending count, Accept seats her and tells her. Then a capped session: "Take a seat"
becomes "Seat taken · 1/1", and somebody not going is refused (`not_going`). Cleanup withdraws the
scratch attendees before deleting (a delete with people going is refused by design) and cancels
what still cannot go. Starts with one throwaway navigation to warm Vite's cold compile.

**`e2e/event-contributions.mjs` (19 checks)** — the call for contributions (root `HISTORY.md` §17AO):
Ola proposes a talk with a co-author through the real form and sees it Submitted; a stranger's
list is empty; Michał (reviewer) starts reviewing and asks for revisions with a note; Ola reads the
reason and the note and never who decided, edits, and it stays Submitted; Michał accepts (staff see
"decided by"; a reviewer has no schedule button); Kasia schedules it and a real session appears
with Ola and the co-author as speakers; Ola was notified at each decision; a second proposal is
declined with a reason the author sees without a decider; the public list carries the scheduled
talk only (fetched with a cache-busting query — the anonymous read cache still holds the empty
list from earlier in the run). Warms Vite once; fails loudly with the throttle hint if a login
returns no token.

**`e2e/guardian-accounts.mjs` (17 checks)** — guardian accounts (root `HISTORY.md` §17AP): the register
form refuses an under-16 in words and makes nothing; Kasia creates a child in Settings (API agrees);
the child signs in by username and has no Messages icon, no avatar or tutoring section, a locked
privacy toggle with its sentence, and an Add menu without hosting or tutoring; the child's comment
is held and cannot message; the guardian reads the held comment in the panel, registers the child
for a hosted event (API, `registered_by`) and for another host's event through the page's
"Register a child" select; deleting the account removes it from panel and API. One tolerated
console line: the refusal under test is a 400. Clear `backend/cachedata` before a run, not during —
a delete under the server's feet is a stale-file-handle 500 that looks like an app bug.

**`e2e/sorting-and-languages.mjs` (15 checks)** — sorting and the content-language rule (root
HISTORY.md §17AQ): the API hides the Polish corpus from an English-only reader and the header says
how many; `sort=title` orders A→Z and `dir=desc` flips it; a fresh English-interface visitor sees
the hidden-count notice on the homepage, "Show them" reveals more and the choice survives a reload;
the branch page's sort goes into the URL, the first card matches the API's first, the flip adds
`dir=`, and a shared `?sort=title&dir=desc` URL renders that order; a Polish exercise under the
English interface shows the banner and one click adds Polish; Ola's Settings save an extra language
on her profile (press the Save in THAT section's form — the settings page has several); the listing
form asks for a language defaulting to the interface's.

**`e2e/comment-attachments.mjs` (10 checks)** — pictures and small PDFs on comments (root
HISTORY.md §17AR): the composer's picker, two chips queued, a comment posted with a generated
2000×1000 PNG and a minimal PDF, the thumbnail genuinely loading (`naturalWidth > 0`), the PDF chip
opening the in-page viewer, the API holding a `.webp` smaller than the upload, a disguised
executable refused in words while the comment itself still posts, a reply (through the "⋯" menu)
carrying a picture. Generates its files in a temp dir; deletes its marker comments.

**`e2e/age-gate-flag.mjs` (19 checks)** — the `age_verification` kill switch: a moderator turning
off the age gate on self-registration. Shaped as much around what must NOT change as what does. With
the gate on, `/register` asks for a year of birth, says why, and an under-16 is refused **with the
reason** (ask a guardian, Settings → Children) and no account is made. A moderator then signs in,
opens `/moderation` → Flags — checked for the drift that has crashed that tab twice, so every row
must carry a real label rather than a raw key, `galleries` and the new age gate among them — and
flips it off. In a **fresh anonymous context** the field and its hint are gone and the same under-16
registers fine. Then the part that matters: Settings → Children is still there, because the flag was
never allowed to touch the minors regime. Finally it is flipped back and the question returns.

Needs no fixtures — it signs in as the seeded staff account (`kasia@edmat.example` / `password123`)
and registers two throwaway accounts, so it spends **two of the ~10/hour/IP register throttle**
(§trap 1); restart the backend if a later script starts failing oddly.

```sh
CHROME=$(find ~/.cache/ms-playwright -name chrome -path '*chrome-linux*' -type f | head -1) \
  E2E_BASE=http://localhost:5173 E2E_SHOTS=/tmp node e2e/age-gate-flag.mjs
```

It also found the bug it now guards: `/api/feature-flags/` was on the anonymous response cache's
allowlist (`config/cachemw.py`, TTL 60s, no write invalidation), so with the flag off the form went
on asking. Every kill switch was affected, not just this one.

**`e2e/galleries-and-applications.mjs` (26 checks)** — pictures on content and applying to look
after them (root `HISTORY.md` §17AY). Shaped around the interlock rather than around the two features
separately: a reader adds two real PNGs through the actual form, the thumbnails **genuinely load**
(`naturalWidth > 0`), the stored files come back as bounded WebP, she can caption her own picture and
has **no reorder control at all**, she applies through the real dialog, staff find it in the queue
with her words and her name, declining with no reason is refused in words, approving clears it, and
back on the material she is told she looks after it, the reorder buttons are now there, the order
really changes and survives a reload. Then the lightbox, then a signed-out reader seeing the pictures
but no upload control. Needs two scratch accounts and a published material:

```sh
cd backend && ../.venv/bin/python manage.py shell -c "
from django.contrib.auth import get_user_model
from materials.models import Material
U = get_user_model()
for n, staff in (('gal-anna', False), ('gal-boss', True)):
    u, _ = U.objects.get_or_create(username=n, defaults={'email': n + '@edmat.example'})
    u.email, u.is_staff = n + '@edmat.example', staff
    u.set_password('scratchpass123'); u.save(); print(n, u.pk)
print('E2E_MATERIAL', Material.objects.filter(published=True).first().pk)"
```

Afterwards, remove the accounts, the pictures it added and the grant it earned:

```sh
cd backend && ../.venv/bin/python manage.py shell -c "
from django.contrib.auth import get_user_model
from galleries.models import Gallery, GalleryImage
for i in GalleryImage.objects.all(): i.image.delete(save=False)
GalleryImage.objects.all().delete(); Gallery.objects.all().delete()
get_user_model().objects.filter(username__startswith='gal-').delete()"
```

**`e2e/material-open-and-titles.mjs` (33 checks)** — the 2026-09-18 asks (root `HISTORY.md` §17AX):
the get-the-material button under the title and summary, at the summary's own left edge, in the
card's left half, above the claim groups, still a 44px target; a picture material previewed inline
and **genuinely loaded** (`naturalWidth > 0` — a broken `src` passes a selector check and fails a
reader); a PDF still getting its collapsed toggle and no picture block; six pages named `EdMat: …`
with **exactly one `<title>` element** each (two is silent, and the first wins); a detail page named
after its own record; and a message sent through the real compose form and read back word for word
by its recipient. Needs a picture material and two accounts — it makes neither, so set
`E2E_PICTURE_MATERIAL` and `E2E_SCRATCH_RECIPIENT` to what this makes:

```sh
cd backend && ../.venv/bin/python manage.py shell -c "
import io
from PIL import Image, ImageDraw
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from materials.models import Material, MaterialTranslation
from taxonomy.models import Branch
img = Image.new('RGB', (900, 600), (250, 250, 252))
ImageDraw.Draw(img).rectangle([40, 40, 860, 560], outline=(20, 110, 90), width=8)
buf = io.BytesIO(); img.save(buf, format='WEBP')
m, _ = Material.objects.update_or_create(
    branch=Branch.objects.filter(published=True).first(), slug='scratch-picture-preview',
    defaults=dict(type='other', published=True, author='Scratch fixture', audience='university'))
m.file.save('scratch-picture-preview.webp', ContentFile(buf.getvalue()), save=True)
for loc, t in (('en', 'Scratch picture material'), ('pl', 'Zdjeciowy material testowy')):
    MaterialTranslation.objects.update_or_create(material=m, locale=loc,
        defaults=dict(title=t, description='A picture, to check the inline preview.'))
U = get_user_model()
for n in ('scratch-anna', 'scratch-piotr'):
    u, _ = U.objects.get_or_create(username=n, defaults={'email': n + '@edmat.example'})
    u.set_password('scratchpass123'); u.save(); print(n, u.pk)
print('E2E_PICTURE_MATERIAL', m.pk)"
```

Remove all of it afterwards — deleting the two accounts takes their messages with them:

```sh
cd backend && ../.venv/bin/python manage.py shell -c "
from django.contrib.auth import get_user_model
from materials.models import Material
get_user_model().objects.filter(username__startswith='scratch-').delete()
Material.objects.filter(slug='scratch-picture-preview').delete()"
```

**The half a browser cannot see** — that the stored column holds `edmat1:…` and not those words — is a
column, not a pixel:

```sh
cd backend && ../.venv/bin/python manage.py shell -c "
from postman.models import Message
from messaging.crypto import decrypt_text
m = Message.objects.order_by('-pk').first()
print('stored  :', m.body[:60]); print('decrypts:', decrypt_text(m.body)[:60])"
```

**`e2e/notebook-anchors.mjs` (35 checks)** — notebooks and comments on one part (§17DI): a
phrase of exercise 2's statement selected → "Comment on this" beside it → the composer says what it
is about → stored with `anchor = {block: 'statement', quote}` → the comment's "On the statement"
line flashes the statement and sets the `edmat-anchor` highlight → the statement's gutter counts it
and the count narrows the thread to exactly those comments; a three-block notebook comment (text,
formula, code) stored with ids, the formula typeset and a `<b>` in the code shown as text; a reply
on the formula block names it and its parent, its line says "On the formula", the block counts it; editing the notebook
through the menu opens it as a notebook and keeps every block id, so that reply stays attached;
a notebook solution written through the API draws three blocks and a comment on its second step
lands in the entry's thread with the step's id; zero page errors (KaTeX font 403s in a worktree
filtered, trap 26). Screens `e2e/screens/notebook-{1..5}-*.png`. Backend half:
`manage.py test community.test_notebook` (29).

**`e2e/comment-input-kinds.mjs` (33 checks)** — the six ways into a comment (root CLAUDE.md
§17AV, extended by §17BA): the strip under the composer offers Markdown file / LaTeX / JSON /
Chemistry / Picture / PDF and no chemistry library is downloaded until asked; a LaTeX panel
previews with KaTeX and inserts a displayed equation; invalid JSON is refused in words and valid
JSON lands as a pretty-printed fenced block; a Markdown file is read into the body.

**Picture** — picking one shows it and offers a description prefilled with the filename rather
than left empty; Insert uploads it through `/api/inline-images/` and puts an `<img>` pointing at
site media *into the body itself*, carrying the description, the intrinsic width/height and
`loading="lazy"`; nothing lands in the attachment row (an attachment is a document now); the
posted comment shows the picture in the text and it genuinely loads, still lazy and still
described; the stored body kept every attribute through bleach.

**Chemistry** — the dialog opens titled by what it makes and *not* by the tool, while Ketcher is
still credited in the licence line where the Apache 2.0 notice lives (only then is Ketcher
fetched); it reads reaction SMILES, "Add reaction arrow" appends a real KET arrow node; the
drawing is saved as KET + sanitized SVG with a reaction-SMILES caption and inserted as
`<img data-chem>`; the posted comment shows it genuinely loading beside the equation and the code
block; in rich mode the drawing is a live node and clicking it reopens the editor, while clicking
an ordinary inline picture opens nothing and throws nothing; the `chemistry` kill switch removes
the button and the API refuses a non-staff drawing. Deletes its marker comments (drawings and
inline pictures have no delete endpoint and are left behind). Screenshots of the posted comment
and the picture panel in `e2e/screenshots/`.

**`e2e/sketch.mjs` (29 checks)** — the freehand whiteboard (Excalidraw, MIT) as a content input.
The strip offers **Sketch** and nothing of the drawing library is downloaded until the button is
pressed; pressing it opens a board that genuinely covers the viewport, with Excalidraw's own
toolbar (so the pan/zoom are the library's, not hand-built) and the MIT notice in the footer.
The fonts come from this origin (`static/excalidraw/fonts/`), never from esm.sh — a stroke needs
no font, so the check provokes the fetch with `document.fonts.load` rather than waiting for one.
Clicking the toolbar's pencil selects the freehand tool and a **real mouse drag** —
down / move × 24 / up — leaves one `freedraw` element with many points; the XY space zooms.
Saving posts the scene JSON and the exported PNG to `/api/sketches/`, and the composer receives an
`<img data-sketch>` pointing at a re-encoded WebP under `/media/sketches/`, with its intrinsic size
and `loading="lazy"`. The posted comment shows the picture and it genuinely loads; the stored body
kept `data-sketch` and the class through bleach. In rich mode the drawing is a live node that keeps
its whole tag, and clicking it reopens the board **with the stroke still on it** (the scene JSON
round-tripped). With the `sketches` flag off the button leaves the strip for a non-staff account
and the API answers 403 while staff still reach an existing row. Deletes its marker comments; the
two sketch rows stay (no delete endpoint). Screenshots: `sketch-board.png` (the fullscreen board
with the stroke), `sketch-posted-comment.png`, `sketch-reopened.png`.

Two traps this script had to learn, both worth knowing before writing another: Excalidraw is a
**new** dependency, so Vite's optimizer reloads the page the first time it is imported (trap 22) —
the run opens the board once as a throwaway and reloads before believing anything; and the
freedraw **keyboard shortcut only fires once the board has focus**, so pressing `7` straight after
the dialog opened left the selection tool active and the drag that followed selected empty space
while the check still read "a stroke was drawn".

**`e2e/reading-comfort.mjs` (17 checks)** — reading comfort (root `HISTORY.md` §17AT): the hero
copy speaks to every age; a guest's "Aa" press sets `data-text-size` and really grows the root
font, twice, survives a reload (localStorage + the app.html restore) and wraps back; every visible
button inside `main` is at least 44px (the check prints the offenders — this is how the notice's
36px "Show them" was found); Ola's press is saved on the profile and the Settings select follows
it; saving larger + high contrast sets both root attributes at once, stores both, and both survive
a reload; the body colour genuinely differs under high contrast; unticking removes the attribute.
Waits for `networkidle` on the guest pages (the first page after a Vite restart is a cold compile,
and a press before hydration has no handler) and signs Ola in through the real login form. Resets
her `text_size`/`high_contrast` at the start and the end.

**`e2e/rich-editor.mjs` (11 checks)** — the rich editor (root `HISTORY.md` §17AS): Source by default
for an account that never chose; no tiptap/prosemirror request until Editor is clicked, then the
toolbar; typing, bolding a word, inserting a fraction from the palette; the posted comment's stored
body is HTML with `<strong>` and `\(\frac{a}{b}\)` intact; `editor_mode` on the profile; Editor
after a reload; Source one click back and remembered; the palette inserting into the source box.

**`e2e/account-menu.mjs` (82 checks, 2026-10-14, WP8)** — the account menu grouped under four
headings (Learning / Taking part / Working together / Your account) and "Help & manual" → `/about/guide`.
In both locales at 1280: the groups in order, each `role="group"` labelled by its heading, the heading
an `aria-hidden` span (never a `menuitem`, never focusable), the exact entries per group; then the
keyboard — Esc back to the trigger, ArrowDown on the trigger opening on the first entry, the arrows
walking only menuitems and wrapping, Home/End, Tab still moving entry to entry, Tab past the last
closing the menu; Help resolving. At 390 the drawer draws the same groups with no `menuitem` roles,
and a SIGNED-OUT visitor (who has no menu on the bar) gets Help in the drawer. Dark mode screenshots.
Then, as staff through the API, `flashcards` + `contests` off: the Learning group and its heading
leave the menu AND the drawer for michał (non-staff — trap 10), and one switch back brings the group
back with one entry; both switches restored in a `finally` and re-queried. Takes `E2E_TOKEN` (staff)
and `E2E_USER_TOKEN` (non-staff) so it does not spend the login throttle (trap 30); `E2E_SHOTS`.

**`e2e/phone-navbar.mjs` (14 checks)** — the 2026-08-26 phone bar: ☰ inside the bar (30×30,
borderless), tucking with it on scroll and returning on scroll up; the drawer's own bordered ✕;
the Report-issue link inside the bar; focus trapped in the drawer over 60 Tabs; Escape returning
focus to the ☰; since WP8 also a visitor's drawer offering Help & manual and no account groups.
Signs nobody in. (`events-and-nav.mjs` 92/92 and `known-issues.mjs` 23/23 are green
again as of 2026-08-26 — both had drifted from the event form: the exact-date scheduling mode and
public visibility now have to be chosen explicitly, `goto` had to stop waiting for `networkidle`,
and a drawer link is found by role because the icon span leaves its textContent as " Events".)

**`e2e/language-default.mjs` (30 checks)** — the language selector after 2026-09-23. Three things
at once: `/api/locale-hint/` answering 200 / `pl` / `country: null` / `Cache-Control: no-store` on a
machine with no GeoIP database; a fresh context landing in **Polish** with exactly ONE request to
the hint and none at all on the second load; a context the hint is answered for as `DE` being moved
to English and that answer being remembered as an offer rather than written down as a choice; a
stored choice (Paraglide's cookie, or its localStorage key) winning with no request; and, at
390×844, the picker sitting in the drawer's top 120px beside the ✕, staying there with the drawer
scrolled to its end, and nothing needed hiding under an injected 60px "Messenger bar" — in the
drawer or at the end of the document. Finishes by switching language through the picker and
reloading. Signs nobody in; creates nothing; screenshots to `e2e/screens/language-*.png`.

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

### The 2026-09-09 full run — every script, against a fresh dev server (commit after `6ca6ce2`)

Backend 8011 (`EDMAT_USOS_MOCK=true`), Vite 5183 (`--mode e2e`), `E2E_API=http://127.0.0.1:8011`
(every script now accepts it with or without a trailing `/api`), `backend/cachedata/*` cleared before
each script. The static-build pair ran against `vite preview` on 5174 of a fresh `npm run build`.

| Script | Result | Notes |
|---|---|---|
| activity-feed | 20/20 | reference picker is language-narrowed (§17AQ): the script now gives ola Polish content |
| audience-bands | 21/21 | listing created as `language: 'en'`; Settings Save targeted by `form.edit-form` |
| booking | 51/51 | Settings Save targeted by `form.edit-form` (the guardian panel's form came first) |
| classroom | 56/56 (2026-09-10) | rewritten against the current page — see its entry above |
| classroom-overhaul | 37/37 (2026-09-10) | rewritten; **found the invite links minted at the dead `/classroom/join/…` path** — fixed |
| comment-attachments | 10/10 | |
| course-claims | 13/13 | picks an unclaimed topic; tolerates the known attachments-404 console line |
| course-content-links | 23/23 | |
| course-lessons-linking | 29/29 | chapter dialog fields are textareas; filing goes through the title picker |
| course-search | 24/24 | **a real backend fix** — see below |
| education-auth | 42/42 | birth year on the register form; the education card is a dialog on the profile now |
| event-contributions | 19/19 | |
| event-programme | 23/23 | |
| event-registration | 26/26 | |
| events-and-nav | 92/92 | a full event waitlists instead of refusing (§17AN); event form needs a band; guest reads Polish |
| exercise-claims | 12/12 | picks an unclaimed topic |
| exercise-card-click | 11/11 | new; needs `edmat.contentLocales` = pl, which it sets itself |
| fcp | see log | static build, throttled — numbers in `scratchpad/e2e10/fcp.log` of the session |
| guardian-accounts | 17/17 | |
| issue-reports | 34/34 | login field locator; the "Aa" button matched to the bar's 36px icons |
| known-issues | 23/23 | two `datetime-local` inputs now (`runs_until`); event form needs a band |
| login-return | 5/5 | |
| material-claims | 14/14 | |
| galleries-and-applications | 26/26 | needs two scratch accounts + a published material; see its entry |
| material-open-and-titles | 33/33 | needs a picture material + two scratch accounts; see its entry |
| material-claims-rework | 28/28 | picks an unclaimed topic; the anonymous "empty" check tolerates an earlier run's claim |
| navbar-stages | 51/51 | stamped rows created as `language: 'en'` |
| pdf-preview | 7/7 | |
| phone-navbar | 12/12 | |
| prerender-check | see log | static build on 5174 |
| reading-comfort | 17/17 | new this release |
| rich-editor | 11/11 | |
| schedule-editing | 36/36 | |
| solution-entries | 27/27 | the homepage Activity tab's row classes (§17AI rebuilt the feed) |
| sorting-and-languages | 15/15 | |
| taxonomy-other | 8/8 | `/submit` needs a band |
| topic-threads | 14/14 | `change` matched by exact name (the "Aa" label also says "change") |
| profile-overhaul, profile-exercise-counts, tutoring-* | not run | need their own seed / env (see their headers) |

**The one real bug this run found — `courses/views.py`.** The site-wide `?q=` browse filter (§17AA)
was applied to every action of the course viewset, and the per-course `search` action reads the
same `q` for the term it looks for *inside* the course while resolving the course through
`get_object()` on that queryset — so any term absent from the course's own title 404'd. This is what
the "26 failing `CourseSearchTests`" pre-existing note in §17AC was; the filter is now list-only and
the suite is 31/31 (courses app 350/350).

**Drift classes this run repaired across the scripts, none an app bug** (all also in
`e2e/CLAUDE.md`): the login field is `input[autocomplete="username"]`; the register form requires a
birth year; every submit form requires an audience band (`form select:has(option[value="university"])`);
lists are narrowed to the reader's languages, so a script that reads Polish rows in an English
context must give the account `content_locales: ['pl']` or create its rows in English; the settings
page has more than one form (target `form.edit-form`); positional `.field select` indices shifted
when the composer gained language and band selects; the course page's management drawers moved to
`/courses/{id}/manage`; `/classroom` is `/courses`.

**Cleaning up after the claim scripts** (they cannot delete their claims — there is no delete
endpoint — and a second run must not find them): from `backend/`,

```sh
../.venv/bin/python3 manage.py shell -c "
from materials.models import MaterialCoverage, MaterialCoverageVote, MaterialCoverageImportanceVote
from courses.models import CourseClaim
from exercises.models import ExerciseClaim
from django.contrib.auth import get_user_model
ola = get_user_model().objects.get(username='u-ola')
claims = MaterialCoverage.objects.filter(material_id=1)
MaterialCoverageVote.objects.filter(coverage__in=claims, voter=ola).delete()
MaterialCoverageImportanceVote.objects.filter(coverage__in=claims, voter=ola).delete()
MaterialCoverage.objects.filter(material_id=1, kind='requires').delete()
CourseClaim.objects.filter(course_id=6, proposed_by=ola).delete()
ExerciseClaim.objects.filter(exercise_id=51, proposed_by=ola).delete()"
```

**`classroom.mjs` and `classroom-overhaul.mjs` were rewritten the next day** (2026-09-10) against the
current page — see their entries above. The rewrite found one real bug the four newer course scripts
had never driven: `CourseInvites` built every link at `/classroom/join/…`, the route from before the
app was renamed, so every invite link the panel minted was a 404 (now built through `resolve()`). It
also found a signed-in non-member of a public course discussion being shown a composer whose submit
did nothing (`DiscussionThread` gained `canPost`; the read-only branch passes `false`).

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
- **`/api/auth/login/` takes `username`, not `email`** — the field holds either (it resolves an
  address to its account), so a hand-written probe that posts `{"email": …}` gets
  `401 Invalid credentials` for a perfectly good password, and reads as "the seeded passwords are
  wrong". They are `password123`; the payload key is what was wrong. Cost a real detour on
  2026-09-18.
- **Clicking Log in before the page has hydrated submits the form natively.** The handler that
  calls `preventDefault` is not attached yet, so the browser does a GET to `/login?`, sends
  nothing, and the script times out waiting for a navigation that looks exactly like a rejected
  password — with no `POST /api/auth/login/` in the server log, which is how to tell the two apart.
  Wait for a request the page only makes once hydrated (`/api/auth/providers/` on `/login`) before
  filling anything.
- **A navigation made straight after signing in can race `authStore.init()`** and render the
  signed-out branch of the page. `e2e/material-open-and-titles.mjs`'s `openAndWait()` is the shape
  that survives it: wait for the selector, reload once, look again.
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
npm run check:plain   # no *emphasis*, _this_, backticks or [links](…) in the manual's / showcase's plain-text strings (WP11); no servers needed
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

---

## Conference step F — the cloakroom desk

`backend/cloakroom/tests.py` covers the desk that takes coats in against an anonymous bearer token
(`CONFERENCE-BRIEF.md` §3.F). Refusals first, because every one of them is a coat that would
otherwise go home with the wrong person: a stranger and an attendee are both refused a deposit; a
taken hook is a 409 with `rack_taken` and a hook the desk does not have is a 400 with
`unknown_rack`; a closed desk takes nothing more; an unknown token is a **verdict**, not a 404;
a coat only ever leaves once; the ticket somebody lost is blacklisted the moment its coat is handed
back by exception; and an exception return with no description, or with no kind of identity named,
is refused. Then the happy paths: a deposit mints an 8-character ticket and holds the hook, a
return frees it, reconciliation turns everything still hanging into `unclaimed` and closes the
desk, and the CSV export has six columns and not one person's name in it. `RuleModuleTests` asks
`cloakroom/rules.py` directly, so the integration change §5 plans for `can_operate` (a confirmed
`cloakroom` station on step E's rota) has a test that fails if it changes meaning.

```sh
cd backend && ../.venv/bin/python3 manage.py test cloakroom
```

The browser half is `frontend/e2e/event-cloakroom.mjs`: an organiser opens a desk with six hooks,
takes three things in, hands one back against its typed ticket, hands a second back through the
exception dialog, is refused when that lost ticket is presented afterwards, and closes the desk
with one item still on a hook; an attendee is told there is a cloakroom and is given no way into
the desk and nothing about what is on the racks; and neither `qrcode` nor `@zxing/browser` is
fetched by a page that never draws a ticket (house rule 11). It leaves three screenshots in
`e2e/screens/` — `cloakroom-slip.png` is the one worth looking at, because a ticket with no QR code
on it still passes every assertion that is not about the picture.

```sh
E2E_BASE=http://localhost:5206 E2E_API=http://127.0.0.1:8106 node frontend/e2e/event-cloakroom.mjs
```
## Conference step A — venues (`venues/tests.py`, `frontend/e2e/venues.mjs`)

**Django: `../.venv/bin/python3 manage.py test venues events`** — 53 venue tests, refusals first.
What they pin, in the order a reader of `venues/access.py` will want them: a stranger reading a
building (allowed — an address and a seat count are not secret) but not its staff list or its
booking queue; a non-administrator refused a room edit and a booking decision; `seated > fire`
refused, including on a PATCH that only touches one of the two; `over_fire_capacity` as a 400 and
`room_busy` as a 409, the second one both when the room is asked for and again when the building
approves (two organisers may both have asked while it was free); back-to-back bookings **not**
colliding; a second decision on a decided booking as `already_decided`; `not_applicable` without a
reason and on an item the building never allowed it on; an organiser refused an item the building
signs off, and allowed to mark it `in_progress`; the sign-off itself refused to everybody but a
venue administrator; the snapshot surviving a template edit and `sync` adding only what is new; and
the publish block in five shapes — no venue publishes as before, a merely `requested` booking blocks
nothing, a pending mandatory item gives 409 `checklist_pending`, `in_progress` does not block, and
**the block lifts entirely when the `venues` kill switch is off**. The `events` half is run with it
because this step's one edit to another app is in `EventViewSet.update`.

**Browser: `frontend/e2e/venues.mjs`** — 33 checks against the real servers:

```sh
cd backend && DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5201,http://127.0.0.1:5201 \
  ../.venv/bin/python3 manage.py runserver 127.0.0.1:8101
cd frontend && PUBLIC_API_BASE_URL=http://127.0.0.1:8101/api npx vite dev --port 5201 --strictPort
cd frontend && E2E_BASE=http://localhost:5201 E2E_API=http://127.0.0.1:8101 node e2e/venues.mjs
```

It drives the real forms: the Venue panel on the event page asking for a room and printing the
fire-capacity refusal **in words**, the building's desk approving it with a note, the Checklist panel
starting a snapshot and spelling the publish block out, and the `venues` kill switch taking the
panels, the footer link and the pages away **for a non-staff visitor** (trap 10) while `/api/events/`
keeps working. It also asserts the Add… entry from **both** sides — a venue administrator has
"Venues you run" in the menu, somebody who runs no building does not — because an entry that appears
for everybody is the same bug as one that appears for nobody.
Screenshots land in `e2e/screens/venues-*.png`; `venues-killed.png` is the one worth
opening, because the first run of this script passed every assertion while the page carried two grey
"this feature is unavailable" paragraphs where the panels had been — a house-rule-3 failure that only
looking found. It signs in as the seeded demo users (kasia is the staff account that creates a
building and pulls the flag) and removes everything it made through the real API at the end.

## Event documents and the briefing gate (`documents/`, conference step C)

`backend/documents/tests.py` — 40 tests, refusals first, each class with its own temporary
`MEDIA_ROOT`. It covers the visibility ladder per role (stranger, attendee, promoted seat holder,
declined, volunteer, organiser, anonymous), the 404-below-the-tier rule on both the metadata and the
protected file endpoint, who may upload and retire, the upload refusals (a text file, a script named
`.pdf`, an oversized file, and a polyglot PNG whose appended payload is gone from the stored WebP),
the `Content-Type`/`Content-Disposition` of the file endpoint, versioning (a replacement makes an old
acknowledgement stop counting; acknowledging a superseded or withdrawn document is a 409), the
organiser's read-receipt table and its "not yet" half, the check-in gate (409 `briefing_unread` then
allowed once acknowledged), and the kill switch — with `event_documents` off the endpoints 403 a
non-staff caller, a moderator still passes, and check-in works exactly as before.

```sh
cd backend && ../.venv/bin/python3 manage.py test documents
```

The browser script is `frontend/e2e/event-documents.mjs` (20 checks). It signs in as the seeded
`kasia@edmat.example` (organiser), `ola@edmat.example` (volunteer) and `michal@edmat.example`
(attendee), password `password123`, creates and removes its own scratch event through the API, and
asserts what each of the three sees, the refusal interstitial at check-in and the read receipts
afterwards. It also asserts that pdf.js is absent from `build/_app/immutable/entry/*.js` when a
build exists (house rule 11), so run `npm run build` first for that check to mean anything. The one
expected console error is the deliberate 409 on the refused check-in; every other one still fails
the run.

```sh
cd frontend && E2E_BASE=http://localhost:5203 E2E_API=http://127.0.0.1:8103 node e2e/event-documents.mjs
```

## 6. Exports, minimisation and retention — conference step G (2026-09-23)

`backend/events/test_exports.py` (25 tests, `CONFERENCE-BRIEF.md` §3.G). Refusals first: the needs
summary and the export log are organisers-only and a stranger, an attendee, a volunteer and a
reviewer are each turned away by name; the door list is every staff member and nobody else; the
**full registration CSV, which was every staff member, is organisers-only now** — that one line is
the whole of the change and has its own test. Then the minimisation itself:
`test_a_volunteer_sees_no_answers_no_note_and_no_account_id` asserts the volunteer's row is exactly
`{id, attendee, status, checked_in, checked_in_at}` and that `attendee.id` is `null`, and it is
checked against `exports.WITHHELD_FROM_NON_ORGANISERS` so a field added to the full serializer
later has to be put on one side of the line or the other. A companion test checks that the narrow
row is still *enough* — a volunteer undoes a check-in from it. Then the aggregates (seat holders
only, a declined row's accessibility note never reaching the count, per-option counts for a choice
field, `answered`/`unanswered` and never the text for a free-text one, and an onsite event not
reporting everybody as "did not say"), the `ExportLog` rows the two file downloads write and the
aggregate read deliberately does not, and finally the purge: a dry run that reports and writes
nothing, a real run that blanks the accessibility note and the free text and nulls `checked_in_by`,
a run that leaves status, `checked_in_at`, the choice answers and the event itself alone, a recent
event untouched, the window as a flag, and a second run that is a no-op.

```sh
cd backend
../.venv/bin/python3 manage.py test events            # includes test_exports.py
../.venv/bin/python3 manage.py purge_event_data --dry-run    # prints what it would blank, writes nothing
```

**`e2e/event-exports.mjs` (24 checks)** — Kasia hosts a hybrid form event with a choice question
and a free-text one, Ola registers with an accessibility note, Michał is the volunteer. Half the
script is API probes (a volunteer's `/registrations/` body has exactly five keys and contains
neither the access note nor the affiliation; 403 on the needs summary and on the full CSV; 200 on
the door list, whose header row is `name,status,checked_in`), and half is the page: the organiser's
Exports card renders the needs table with the right counts and the free-text question as
"1 of 1 answered" with its text nowhere on the card, the export log already carries Michał's API
download (which is the point of a log), the door list downloads and Kasia's row joins it newest
first; then the same page as the volunteer, which has the door-list button and no needs table, no
log, no full-CSV button and no profile link on the registration row.

```sh
E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/event-exports.mjs
```

Two screenshots land in `e2e/screens/`: `event-exports-organiser.png` and
`event-exports-volunteer.png`. The second is the one worth looking at — it is what the
minimisation actually looks like.

## Conference step E — the volunteer rota (`shifts`)

`backend/shifts/tests.py` — **48 tests**, refusals first, because a rota is mostly refusals and the
thing that would fail silently is not "a volunteer claimed a shift" but "a fifteen-year-old claimed
the 23:00 door shift and nobody noticed". Covered: not a volunteer; an organiser told to assign
themselves rather than that they are not a volunteer; a full shift; an overlap; a gap under 15
minutes; a minor on a station that forbids minors, on a shift touching 22:00–06:00, over the 7-hour
daily cap, and with no guardian consent recorded; a drop inside the four-hour cutoff (and an
organiser dropping anyone through it); a non-organiser assigning; a volunteer reading the coverage
grid or the safeguarding records. Then the happy halves: a supervised station landing a minor's
claim as `claimed` pending an adult, the `post_save` signal that moves a session-bound shift when
the session moves (and leaves a shift with its own hours alone), the coverage `COUNT`s, hours with
and without an organiser override (and the 400 when a big override carries no note), `my-shifts.ics`,
the first-name-plus-initial masking, the `shifts` kill switch with its neighbour still answering, and
the `booking/availability.py` coupling (a confirmed shift blocks a tutor's hours, a claimed one does
not). Run it with `cd backend && ../.venv/bin/python3 manage.py test shifts`, and with
`shifts events booking notifications moderation` for the neighbours.

`frontend/e2e/event-shifts.mjs` — **28 checks**. Kasia (host, seeded staff) builds a station and a
shift through the real panel and sees the coverage grid draw a red `0/1` cell; Ola (volunteer) takes
one shift, is refused the overlapping one with the reason in words, prints the wall rota and the
bilingual certificate, and finds the event on `/volunteering`; the hours override is refused without
a note and accepted with one; `my-shifts.ics` is a real calendar; and the `shifts` kill switch is
asserted **as Ola**, who is not global staff — with the flag off the panel is gone, the API refuses
her, and the event page keeps working. Run it with
`E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/event-shifts.mjs` (adjust the
ports); it creates and deletes its own event and puts the flag back.
## 7. The events permission matrix and the conference personas (CONFERENCE-BRIEF.md §3.B)

`backend/events/test_permission_matrix.py` is one declarative table — `(persona, method, path,
body, expected status, why)` — driven through `subTest`, covering event CRUD, the staff list and
its writes, programme writes, registrations, the CSV export, accept/decline, check-in, the
contribution decisions, `my-agenda`, and the `/api/<thing>/undefined/` rows that prove the
router's numeric detail segment (`backend/config/routers.py`; those were 500s before it). Each row
runs inside its own savepoint which is then rolled back, so a row that writes cannot change what a
later row sees, and the table stays order-independent. Adding an events endpoint means adding
rows, not writing a new file; the file's own header says so for the parallel conference steps.

**411 rows since integration** (148 before it). The added 263 cover every endpoint the conference
layer exposes — `venues` (buildings, rooms, room bookings, checklist templates, instances and
items), `documents` (the five tiers, the protected file, acknowledgements, replace), `shifts`
(stations, shifts, claim/drop/assign/confirm/no-show/done, the records, `my-volunteering`),
`cloakroom` (the desk, deposit, both returns, reconcile, export) and `events/exports.py`
(`exports/needs`, `exports/door-list.csv`, `exports/log`) — plus an `undefined` row per new router.
Two personas exist only for this table and are built in its own fixture rather than in
`make_personas()`: **`venue_admin`**, who runs the building and is not event staff, and
**`clerk`**, a second volunteer who has not acknowledged the mandatory briefing (the persona the
`409 briefing_unread` desk row needs — the ordinary volunteer cannot carry it without turning
every check-in row into the same 409). It found one real bug: two cloakroom nested-id routes
answered **500** rather than 404 on `/items/undefined/…` — `HISTORY.md` §17BF, "Matrix rows for A,
C, E, F, G".

**690 rows since the management layer went in** (431 before it). The added 259 cover every endpoint
`organizations`, `tasks`, `needs`, `plans`, `decisions` and `work` expose, plus the two shared
node-seam views in `config/views.py` (`GET /api/nodes/{kind}/{id}/` and `…/staff/`) that all six
hang off — on all four node kinds, because `config/nodes.py` answers each from a different roster:
the Sandbox event, a public course, a material with a co-authoring project (and a bare one with
none) and an organisation. A row's expected value may now be a **`(status, refusal word)` pair**
rather than a bare status, and `test_matrix` then checks `response.data['detail']`: this layer has
twenty-five distinct refusal words and a 403 alone passes just as happily on the wrong one. One
more persona is built in the fixture, **`participant`** — enrolled on the course and on no staff
list anywhere, which is the tier that answers "may a member see the task board" (no) and "may a
member vote in an `eligibility: members` poll" (yes). It found four real bugs: `PUT /api/needs/{id}/`
skipped the manager check entirely (`UpdateModelMixin` binds both verbs and only `partial_update`
was overridden), every `eligibility: members` poll was visible to anybody who could see the node,
`GET /api/polls/{id}/results/` had the same hole with the tally in the body, and
`POST /api/polls/{id}/options/` 500'd on the second option when the body named no `order` —
`HISTORY.md`, "Matrix rows for the management layer".

**746 rows today** (2026-10-07, `HISTORY.md` §17BU.B), and the count above had drifted: 690 was
right when the management layer went in, the learning cycle's integration added 15 and closing step
B 17, and nobody updated the number — 690 + 15 + 17 + 24 = 746, countable per block against the
block comments in the file. Recount it, never increment it (house rule 5). The last 24 are the three
bullets closing step B named and left: the **four founding paths** `config/creation.py` governs,
pinned from the side the gate lets *through* (`POST /api/{courses,events,services,organizations}/`
— until now the table proved only that an unverified adult is refused, and would have read the same
if the gate refused everybody; `courses` and `services` had no founding rows at all), the **issuing
action** `POST /api/courses/{id}/completions/` with all four of its refusal words plus the 201, and
the **`already_revoked`** 409 that needed a second, pre-revoked `CourseCompletion` in the fixture
for a different participant. Three more fixture people come with them — `graduate` (both lessons
done), `halfway` (one of two, which is what pins `not_done` on something other than the "no lessons
at all" clause) and `revoked` — all `make_viewer`, because nothing signs in as them. The 24 rows
found no bug; each was instead **mutation-checked** (eight expectations falsified in a scratch copy,
run came back `FAILED (failures=8)`), which is how a row that passes because nothing reaches the
endpoint gets caught.

Its personas come from `backend/testing/personas.make_personas()`, which is also what
`../.venv/bin/python3 manage.py seed_conference_personas [--password X]` runs — seven accounts
(`persona.organiser@edmat.example` … `persona.stranger@…`, plus `persona.child`, a real minor made
through the guardian flow) on one published multi-day "Sandbox conference", default password
`persona-pass-2026`. It is idempotent and prints a who-can-do-what table. Run it before
`frontend/e2e/event-preview.mjs`, which signs in as the organiser persona, turns the preview on,
and asserts — by intercepting every outgoing request — that **no `Authorization` header leaves the
page** while the preview fetches, and that no button, link or form control is rendered inside the
preview view:

```sh
cd backend && ../.venv/bin/python3 manage.py seed_conference_personas
cd frontend && E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 node e2e/event-preview.mjs
```

The script creates one scratch draft (to show that a signed-out visitor previews it as nothing at
all) and deletes it through the real API at the end, confirming by re-query.

**One trap about running any of this.** `manage.py test … | grep … | tail` reports the exit status
of `tail`, not of Django, so a piped run says `EXIT=0` however many tests failed. Run it unpiped
into a file and read the `OK` / `FAILED (…)` line out of that file. This was caught here after two
suite runs had already been recorded as passing on nothing but a pipeline's exit code.

## The published school demo — `/dziennik` (HISTORY.md §17BO)

Two scripts in `school-management-demo/scripts/`, and they answer different questions.

**`record-snapshot.js`** drives a real instance over the DevTools protocol through a recording
proxy and keeps every successful API GET, keyed by role. Completeness is defined by the app's own
navigation: it signs in as a role, reads back the hash links the app rendered, and visits each. That
is deliberately not `smoke.js`'s matrix — the matrix pairs each screen with the user who owns it,
which is right for a smoke test and wrong for a page where a visitor picks any role and clicks
anything. Chrome is driven over CDP rather than with `--screenshot`/`--dump-dom` because neither
flag ever returns for this app: its screens keep timers running, so the page never reaches the quiet
state they wait for.

**`verify-static.js`** is the regression test, and the one to run before publishing. It serves the
BUILT files with **no server running anywhere** and walks every role over every route that role's
navigation offers, failing on a snapshot miss, a console error, an uncaught exception, a missing
`<h1>`, or a literal `undefined`/`NaN`/`[object Object]` in the rendered text. A snapshot recorded
correctly and then built wrongly looks identical until somebody clicks; this is what clicks.

```sh
cd school-management-demo
EDMAT_CHROME=<path-to-chrome> node scripts/record-snapshot.js     # ~6 min, writes public/demo-snapshot.json
node scripts/build-static.js --out dist-static --base /dziennik   # bakes it in; refuses a build that can still reach the network
EDMAT_CHROME=<path-to-chrome> node scripts/verify-static.js       # ~15 min, 0 problems is the bar
```

`build-static.js` is itself a check: it counts `fetch(` in everything it ships and refuses unless
the total is exactly **one** — `snapshot.js`'s forward to `/api/issues/`. That guard found
`print.js`, a second outbound call (`/api/pdf?probe=1`) that bypasses `rawFetch` entirely.

**Two traps worth knowing before debugging this.** `python3 -m http.server` is single-threaded, and
a browser opens several connections at once, so the page never finishes loading behind it — serve
the build with a threaded server (`verify-static.js` has one). And a headless run under
`--virtual-time-budget` never terminates here, because the snapshot answers instantly and any poll
timer re-schedules forever in virtual time; that is a testing artifact, not a bug in the page.

## The demo conference — `seed_conference_demo` (HISTORY.md §17BK)

`backend/events/test_conference_demo.py` (17 tests) exercises `testing/conference_demo.py`, the
builder behind `../.venv/bin/python3 manage.py seed_conference_demo`. It freezes `timezone.now` at
15:00 on a fixed day one, so that the door log, the lunch-time returns and the morning shifts have
all happened and the event is not over, and then asserts the two things a seed can silently get
wrong: a second run leaves one of everything, and the rows written directly agree with the rule
modules that read them (`claim_block_reason` says `already_assigned` and nothing else for every
live assignment, `coverage()` agrees on the short count, `briefing_block_reason` blocks exactly
`persona.clerk` and the stale reader `conf.volunteer.09`, `can_operate` admits the desk clerks, a
future day one has no scans and no coats). Content is not asserted.

The command itself: run it against the real database whenever the conference pages need to look
lived-in (screenshots, onboarding, QA). Idempotent; ~8 s. `--day-one` moves the conference,
`--reset` removes it and its `conf.*` accounts; the personas stay. Everything the plan dates after
*now* is left unapplied, so a run at 08:00 has an almost empty door log — re-run later, or pass
yesterday. Accounts and the password are printed at the end.

```sh
cd backend && ../.venv/bin/python3 manage.py seed_conference_demo
cd backend && ../.venv/bin/python3 manage.py test events.test_conference_demo
```

### What the seed promises about itself (2026-09-25)

Two guarantees, added when this seed became something to run on the **live** database rather than
only on a dev box. Both are enforced in the builder, inside its own transaction, so a seed that
cannot keep them leaves nothing behind — and both are covered by `DemoIsMarkedAsFakeTests` and
`DemoAccountsAreContainedTests` in the same file.

- **Every seeded event is titled `TEST=FAKE …`.** `FAKE_PREFIX` lives in `testing/personas.py` and
  `conference_demo.py` imports it, so the two seeders cannot spell the marker differently. Asserted
  over `Event.objects.all()` rather than over the two constants: the point is that nothing the
  seeders create escapes the marker, and a third seeded event would otherwise slip through.
- **No seeded account holds authority outside the demo** — `assert_contained()`. Platform-wide
  (`is_staff`, `is_superuser`, groups, per-user permissions), another object of the same kind
  (`EventStaff` only on a *marked* event, `VenueStaff` only on the demo venue), or a different
  surface entirely (`CourseStaff`, `OrganizationMember`, `ProjectMember`, `NodeGovernor` — none at
  all). The refusal half is tested too, which is the half that matters: a containment check nobody
  has watched refuse may only be an expensive way of returning True.

**A dev box that has run `frontend/e2e/` will fail the containment check**, and correctly so: the
preview script leaves events hosted by `persona.organiser` behind, and those are authority outside
the demo. Delete them and seed again —

```sh
# events a persona hosts that the seeders do not own (local leftovers; never on the server)
Event.objects.filter(host__username__startswith='persona.').exclude(title__startswith='TEST=FAKE ')
```

An installation seeded **before** 2026-09-25 also holds a `Sandbox conference` row under the old,
unmarked title that `--reset` can no longer find. Rename it to the marked title first, then reset.

## Conference step D — tickets, the door and the badge sheet

`backend/events/test_tickets.py` (CONFERENCE-BRIEF.md §3.D) covers the ticket token, the scanner's
batch endpoint and the badge sheet, refusals first: a stranger asking for somebody else's ticket
(403), an attendee posting scans (403), a volunteer reading the scan log or the badge sheet (403),
a `pending` row told *which* refusal it is instead of being handed a ticket (409 carrying the
status), an unknown token logged as `unknown`, a second entry → `already_in`, two entries for one
token **in one batch** → the later is `collision`, an exit then an entry → admitted again, a
replayed `client_nonce` returning the same stored row with no second `ScanEvent`, `rotate`
invalidating the old token, a clock running fast that cannot stamp a check-in in the future, and
the shape assertions that `checkin-list` carries no ids and no contact data while the badge sheet
prints adults in full and minors as `Anna K.`. One test flips the `tickets` flag off and asserts
the whole surface 403s **while check-in by button still works** — house rule 3 from the other side.
Run it with `../.venv/bin/python3 manage.py test events` from `backend/`.

`frontend/e2e/event-tickets.mjs` drives the real pages: Ola's ticket page (the QR read back as
drawn pixels rather than a present element, the short code matching the API, the room named), the
scanner's **typed-code** path with its result banner turning from "queued" into "Come in", the name
search over the cached list, the registrations panel showing her checked in, the badge-sheet link
beside the CSV button, and the badge grid. The camera cannot be driven — Playwright can fake a
stream but not one holding a QR code in focus — so the camera button is asserted to exist and the
decode path is exercised through the code a volunteer types when it fails, which is the same
`queueScan()` → IndexedDB → batch path. A batch with an exit, a re-entry, a same-batch duplicate
and an unknown token goes through the API directly, because a batch is what the offline queue
actually sends and a browser only ever queues one scan at a time. It finishes with the house-rule-11
bundle assertion — `jsqr` and `qrcode` absent from `build/_app/immutable/entry/*.js` — which prints
a loud skip line rather than passing when no build is lying beside the source.

    cd frontend && E2E_BASE=http://localhost:5204 E2E_API=http://127.0.0.1:8104 node e2e/event-tickets.mjs

**`e2e/learning-record.mjs` (52 checks)** — the learning record on a public profile
(§17BR.B, 2026-10-05). Needs `seed_demo_users` + `seed_profile_showcase`, and signs in through the
API as kasia (staff, for the flag and her own consent) and as ola (non-staff, the guardian half and
the kill switch — `feature_gate` lets real staff through every switch, so kasia can prove nothing
about one being off: trap 10).

With both consents on it reads the record ANONYMOUSLY and pins the rule the feature exists for on
the wire, not just in the layout: no activity row carries an `average`, no grades row carries a
metric, so the two blocks cannot be concatenated into one table. Then it **recounts the `sets`
column itself** from her sets and those exercises' own branches and requires it to match row for
row — the check that caught `sets_by_branch` reading 21 for an account with five (`Meta.ordering`
pulled into a `distinct()`). `cards_reviewed` must be 0 everywhere until step A registers its
provider, asserted rather than skipped. In the browser: the row, its summary naming both blocks and
totalling neither, exactly two `section.block`s, an Average column in the first and none in the
second, and row counts equal to the API's. Consent withdrawn leaves the grades table untouched and
the EdMat block with **no table at all** and the words "Not shared". The owner gets `is_owner` back
with both blocks still withheld.

Then a real minor: ola creates a child through `/api/auth/children/`, the child makes a public set,
and an anonymous reader gets an empty `owner_display_name`, `owner_anonymous: true`, the child's
name nowhere in the body, the neutral sentence on the page and no link to the child's profile.
Finally the kill switch, off: 401/403 anonymously and 403 for a signed-in non-staff caller while
staff keep their tools, the profile row gone and the page still rendering, and the consent toggle
gone from `/settings` and back when the switch is. Everything it created is deleted and confirmed
gone through an AUTHENTICATED request (trap 12), and the flag and consent are put back as found.

Zero console/page errors, with the worktree KaTeX-font 403s filtered by URL and **counted out
loud** (trap 26). Three screenshots in `e2e/screens/record-*.png`, looked at — the Polish
"Udostępnione przez osobę uczącą się na EdMat" was only ever wrong (`przez` takes the accusative;
a name-shaped `{name}` slot cannot decline) in a screenshot.

    cd frontend && E2E_BASE=http://localhost:5232 E2E_API=http://127.0.0.1:8132/api node e2e/learning-record.mjs

**`e2e/about-page.mjs` (58 checks; 17 when rewritten 2026-10-08, extended by WP7 on 2026-10-15)** — `/about`
is the project's own organisation page (`OrganizationPage` for the `edmat` body; HISTORY §17BW.C), opened
by the "New here?" strip (`StartHere variant="about"`), then the
thirteen-card feature grid and ONE Explore section (`id="showcase"`: the manual band, then the showcase
index nested inside it). Polish desktop, anonymous: the h1 is the organisation's name, at least fifteen
goals (plan rows — the plans, tasks and polls folds are OPENED first, since a folded panel draws no
body), thirteen cards including flashcards / contests / help wanted / organisations, one `#showcase`,
Explore holding the manual and the twelve showcase cards, the strip before the h1 in the DOM and on
screen and reading the catalogue, one `<title>` shaped by PageHead, the footer link — and the open
board: the task panel drawn with no "add" button, the two polls drawn with no "Vote" button (scoped to
the polls fold: an unscoped `has-text("Głosuj")` matched a task titled "…głosuje"); since 2026-11-02
(§17DD, 60 checks) that nothing about the association is on the page and that the owner's open
decisions are among the polls, instead of the research thread's toggle that left with it. English at phone width: the same
h1, cards, headings, no horizontal overflow. Kill switches as a stranger (kasia's token via
`E2E_TOKEN`, else login), one at a time: tutoring, flashcards, contests, needs, organizations — each
card gone and twelve left, every switch back on afterwards (re-read through the API). With
`organizations` off `OrganizationPage` still asks for the body and gets a 401; those lines are counted
and printed, not failed (left open, WP7). The strip: in the server-rendered HTML before the
organisation's `.page` and with nothing but wrappers before it inside `<main>` (and in
`E2E_BUILD_HTML=build/about.html`, the prerendered file, when given); in both locales the middle door
scrolls THIS page to Explore with its heading clear of the sticky header, the guide door lands on
"Getting started" and the third on `/disciplines`; hide (English only — each `/about` load is ~20
anonymous requests against the 600/hour throttle) takes it away with no gap left, survives a reload,
hides the HOMEPAGE band too (one shared key), and clearing the key brings it back. Screens
`about-wp7-{1280,390}-{light,dark}-{top,explore}.png`. Needs `manage.py seed_edmat_project --owner
<username>` on the database first. Two back-to-back runs exhaust the anonymous throttle: clear it with
`manage.py shell -c "from django.core.cache import cache; cache.clear()"` (trap 30). Ran 2026-10-15: 58/0.

## Management step D — `plans`

`backend/plans/tests.py` (MANAGEMENT-BRIEF.md §3.D, HISTORY.md §17BI.D) — 41 tests, refusals
first: a stranger 404s on a draft plan's node-list entry and its detail (never 403 — for them it
does not exist), a non-manager 403s creating a plan or transitioning one, every illegal status
transition is `409 illegal_transition`, completing is blocked by `steps_pending` until every step
is `done`/`skipped`, a second level of step nesting is `409 nested`, a reorder naming the wrong set
of ids is `400`, a minor and an editor are both refused the suggestion box (`minor`/`own_plan`,
403) while a stranger on a non-active plan simply cannot reach it (404) and the SAME reader on an
active plan gets a clean `409 not_active`, accepting a suggestion creates a real `PlanStep` and
records `created_step`, deciding twice is `409 already_decided`, only a suggestion's own author may
withdraw it, `PlanStep.done_by`/`done_at` are set and cleared as `status` moves in and out of
`done`, and `work_items()` returns steps due within 14 days and pending suggestions only for plans
the caller may edit (never for a stranger). Run with
`../.venv/bin/python3 manage.py test plans config` (76 with `config`'s own suite).

`frontend/e2e/plans.mjs` (21 checks) drives the real pages against ports 8124/5224: Kasia opens a
scratch course's Plans panel (mount point D), starts a draft plan, adds two steps, reorders them
(read back from the DOM after the click, not just that it landed), activates it; Michał — no
standing on the course at all — opens the SAME plan by its URL, is refused the suggestion queue by
the API (403) and sees no editor controls in the browser, and sends a suggestion; Kasia's queue
shows it and accepting it creates a real third step, cross-checked through the API
(`created_step`); marking every step done lets the plan complete. Zero console/page errors — one
pre-existing, worktree-only 403 pattern (a KaTeX font requested through Vite's `/@fs/…` because
`frontend/node_modules` is a symlink to the repo root's shared install) is filtered by its exact,
URL-free console text, documented in the script, while a real `/api/` 5xx is still caught by a
separate `page.on('response')` listener. Two screenshots in `e2e/screens/plans-*.png`, looked at —
the second one caught a real bug (a duplicate-text step from accepting a short suggestion) that no
assertion would have.

    cd frontend && E2E_BASE=http://localhost:5224 E2E_API=http://127.0.0.1:8124 node e2e/plans.mjs

**`e2e/needs.mjs` (21 checks)** — the needs board, management step C (`HISTORY.md` §17BI.C). Kasia posts a need
on a scratch event from `NeedsPanel`; the board lists it; Michał opens it from the public board and
applies; Kasia accepts him from the need's own applications queue and the need flips to `fulfilled`
once accepted reaches `wanted_count`, which drops it off the anonymous board while it stays on
Kasia's own read as the node's manager. The `needs` kill switch is then flipped off and checked as a
NON-staff account (Michał — e2e/CLAUDE.md trap 10): the panel leaves the event page and "Help
wanted" leaves the nav, both restored afterward. Screenshots in `e2e/screens/needs-*.png`: the
manager's detail view, the public board, the fulfilled state. Scratch event removed through the API;
the orphaned `Need` row (no DELETE endpoint by design — tombstone, not hard-delete) becomes
unreachable through the API the moment its node is gone, which the script also checks.

    cd frontend && E2E_BASE=http://localhost:5223 E2E_API=http://127.0.0.1:8123 node e2e/needs.mjs

**`backend/tasks/tests.py` (54 tests) and `frontend/e2e/tasks.mjs`** — management step B, tasks on a
course, an event or a material (`MANAGEMENT-BRIEF.md` §3.B, 2026-09-24). The Django suite is
refusals first: a stranger, an event's attendee and an anonymous caller each get **404** on the
board and on a task id (a task board is the inside of a team); an unknown node kind and
`/api/tasks/undefined/` are 404s rather than 500s; who may edit, who may assign, who may delete;
the whole transition table including the **lost race** (a WHERE-anchored `update()` whose loser
sees `illegal_transition`); one level of subtasks (`409 nested`); the recounted `progress` and
`is_overdue`; the three list filters; the bleach pass on `description`; the proof that a PATCH
cannot set `status`; `mine`; `work_items`; and the kill switch with its moderator bypass. Run it
with `../.venv/bin/python3 manage.py test tasks config` from `backend/` (89 with `config`).
`frontend/e2e/tasks.mjs` drives the real pages as Kasia (host) and Ola (volunteer): the panel on a
real event page, a task written through the form with a due date already in the past, the assignee
picker fed by the shared `GET /api/nodes/{kind}/{id}/staff/`, the forward transition, a step folded
under its parent with the progress line, the volunteer's narrower set of buttons, `/tasks` and
`/tasks/{id}`, an anonymous reader getting **no panel at all** on the same public event page, the
`tasks` switch taking the panel, the account-menu entry and the page away and giving them back, and
four refusals asserted straight against the API. Two screenshots in `e2e/screens/tasks-*.png`.

    cd frontend && E2E_BASE=http://localhost:5222 E2E_API=http://127.0.0.1:8122 node e2e/tasks.mjs

**`backend/organizations/tests.py` (70 tests) and `frontend/e2e/organizations.mjs` (27 checks)** —
management step A, organisations (`MANAGEMENT-BRIEF.md` §3.A, `HISTORY.md` §17BI.A). The Django
suite is refusal-weighted and every class opens with who is told no and with which word: `minor`
(founding is closed to an under-16), `last_owner` on both the remove and the *demote* path,
`not_org_manager` / `not_org_owner`, `not_node_manager` and `not_linkable` on the link path,
`already_linked`, `already_member`, `no_such_user` — plus a dissolved body being 404 to a stranger
and open to its own roster, a link whose target the reader cannot see being left out of the list,
the kill switch closing the whole surface for a signed-in non-staff caller while
`/api/nodes/{kind}/{id}/` keeps answering, and the `work_items` provider's shape. Its last class is
the node seam: `config/nodes.py` gained the `organization` kind in this step, so the four functions
it dispatches to are exercised here rather than in `config/test_nodes.py`, which six parallel
branches would otherwise all have appended to. Run it with
`../.venv/bin/python3 manage.py test organizations config` from `backend/` (106 tests with the
`config` half). The browser script founds an organisation through the real form, checks the
directory's search narrows to exactly one card, links a course its owner runs and is refused **in
words** when she tries somebody else's, proves the last owner cannot leave, finds the badge in the
management panel on the course's own page, and then flips the `organizations` flag off **as a
non-staff visitor** and checks that both header entries, the panel and the page all go while the
course page keeps working. It leaves two tombstoned organisations behind on a real database, because
dissolving is not a delete.

    cd frontend && E2E_BASE=http://localhost:5221 E2E_API=http://127.0.0.1:8121 node e2e/organizations.mjs

## Management step F — the personal work dashboard (`work/`, MANAGEMENT-BRIEF.md §3.F)

`backend/work/tests.py` — 10 tests, refusals first: anonymous gets 401, authenticated gets 200 with
the `{sections, unavailable, generated_at}` shape, a provider that raises is caught and named in
`unavailable` rather than failing the request, a provider behind an off flag is skipped and never
even called, and each of the six built-in providers (events hosted/staffed, courses with pending
enrolments, a material project with a pending version, an upcoming shift, an upcoming tutoring
booking) appears with the right `kind` given a small real fixture. Run with
`../.venv/bin/python3 manage.py test work config` from `backend/` — `work` alone exercises the app;
`config` is included because `config/test_nodes.py` (the shared course/event/material node seam
every management step reads) is the thing that endpoint actually depends on.

`frontend/e2e/work.mjs` (15 checks) — Kasia signs in, an event she hosts starting in 7 days is
created through the real API so there is something to see, and cross-checked directly against
`GET /api/work/` before touching the browser at all (so a later failure is known to be a rendering
bug, not a missing fixture). `/work` then shows it under "Events I'm hosting" with a working
urgency dot, a formatted due date, and a node link that actually resolves to the real event page
(`/events/{id}` — a node's `kind` from `config/nodes.py` is singular, the frontend routes are
plural, and building the link directly from `kind` 404s). A second account — the first of Kasia's
fellow seeded demo users whose OWN `/api/work/` genuinely comes back with zero sections, probed
through the API rather than assumed, falling back to a freshly registered scratch account only if
none of them are empty — then signs in and `/work` shows the whole-page "Nothing is waiting on you"
state instead. Zero console/page errors is part of the pass condition. Two screenshots
(`/tmp/work-dashboard-kasia.png`, `/tmp/work-dashboard-empty.png`), meant to be looked at.

```sh
cd backend && ../.venv/bin/python3 manage.py test work config
cd frontend && E2E_BASE=http://localhost:5226 E2E_API=http://127.0.0.1:8126 node e2e/work.mjs
```

**`frontend/e2e/work-labels.mjs` (15 checks, 2026-10-15, WP9)** — `/work` speaks the reader's
language. Against Kasia's real dashboard (`E2E_TOKEN` skips the throttled sign-in, trap 30): the API
sends a status CODE and a separate int `count` (never `'3 due'`), and in BOTH locales every status
pill is the catalogue's own words for its (kind, code, count) — the expected text is computed from
`messages/<locale>.json` with `Intl.PluralRules`, so the Polish plural forms are checked, not just
"non-empty"; an undeclared code and a count-less counted row (injected by intercepting `/api/work/`)
read "Status unknown"/"Status nieznany", never raw; no horizontal scroll at 390. Screenshots
`e2e/screens/work-labels-{pl,en}-{1280,390}.png`. The backend half is
`work.tests.StatusVocabularyTests`: one world with a row of every one of the 17 kinds, every row held
to `providers.item_problems` (declared code, count exactly where `COUNTED_KINDS` says), plus a drift
check of the declared sets against the model enums they were copied from.

```sh
cd frontend && E2E_BASE=http://localhost:5206 E2E_API=http://127.0.0.1:8056 E2E_TOKEN=<kasia> node e2e/work-labels.mjs
```

The per-SECTION empty state (`work_section_empty` in `+page.svelte`) is not exercised — the backend
never returns a section with zero items in the first place (`work/providers.py: collect()` only
appends a section `if items:`), so that branch is unreachable through the real API rather than a
gap in the script.

## Management integration — the merged tree (2026-09-24)

The six management steps' own suites and scripts are described in their paragraphs above. At
integration everything was run once more on `ux-and-whiteboard` with all six merged: the whole
backend suite (**2 354 tests, OK** — allow ~9 minutes for the test database to build first, or pass
`--keepdb`), `organizations tasks needs plans config` 231 OK, `work` 12 OK, the permission matrix
(690 rows, one `subTest`-driven method — see `backend/events/test_permission_matrix.py`), svelte-check
0/0, `npm run build`, and the e2e scripts one at a time against servers on 8128/5228 with
`backend/cachedata/*` cleared before each: `organizations` 27, `tasks` 36, `needs` 21, `plans` 21,
`polls` 15, `work` 15, `event-registration` 26, `coauthoring` 52, `materials-coop` 47,
`material-claims` clean, `events-and-nav` 90/92 (the two pre-existing `events` kill-switch checks).
Two scripts were taught to wait for the element they check (`work.mjs`, `events-and-nav.mjs`): the
event page draws five management panels now, and a read the instant `goto` returns sees "Loading…".
The first pass's 38 five-hundreds were `no such table: decisions_poll` — run `manage.py migrate` after
merging a branch that adds a model, before starting the servers. `HISTORY.md` §17BI is the record.

---

## 2026-10-01 — the owner's list (`ux/mission-nav-tutoring-volunteering`, `HISTORY.md` §17BQ)

**New backend suites.** `services.tests.ServiceDescriptionSanitizeTests` (7) — the refusal set that
rendering a listing's description owes: a script tag, an event handler, a `javascript:` URI, a
surviving plain link, untouched LaTeX delimiters, a chemistry drawing that keeps its `class`, and
the PATCH path as well as the POST. `exercises.test_solution_entries.EntryAttachmentTests` (8) —
the PDF round trip, a photographed page re-encoded to WebP under a random name, a disguised
executable refused, a stranger refused, the fourth file a 409, a removed entry refusing, the
shared upload allowance, and who may take one back. `needs.tests.VolunteeringOfferTests` (12) —
who may post, the minor refusal, both kill switches, a paused offer's visibility, PUT as well as
PATCH, and the two language axes (`?content_locales=` on what the offer is written in, `?speaks=`
on what the volunteer can help in).

Run: `manage.py test services exercises community needs moderation accounts`. All green at the
time of writing — `services` 76, `exercises community` 200, `needs` 44, `moderation` 119,
`accounts` 128.

**`moderation.tests.FeatureFlagTests` was already failing on this branch** before this work:
`school_demo` was seeded on 2026-09-25 and never added to its expected key set. It now lists both
that and `volunteering`. A new flag means a line there as well as the three files the root
`CLAUDE.md` names.

**Browser scripts changed, and NOT run** (they need both servers and seeded demo users; `node
--check` passes on all eight). `navbar-stages.mjs` needed real surgery — three of its stages went
with the links they collapsed, About took stage 0, and Events is an icon at every width, so the
widest-width check now makes an exception for it. `events-and-nav.mjs` no longer expects
"Wydarzenia" as nav TEXT (it is an aria-label now) and pins the four removed Add-menu entries as
absences. `about-page.mjs` matches `/tutoring` **or** `/korki` and counts nine cards (eight with tutoring off).
`booking`, `tutoring-modals`, `tutoring-cache`, `audience-bands`, `sorting-and-languages`: browser
navigations move to `/tutoring`. **Their `api('/services/')` calls are untouched and correct** —
the Django app is not renamed, only the frontend route. `scripts/check_accessibility.ts` likewise.

**What was actually driven in a browser**, against `./run.sh` on 8000/5173, signed in as `kasia`:
an offer posted through the real form and found again by its spoken language and not by one nobody
speaks; `/korki` ↔ `/tutoring` rewriting live as the language picker moves, with no reload; the
solution composer offering Markdown, LaTeX, JSON, Chemistry, Sketch, Picture and PDF; a real PDF
attached to a real solution and opened in place; the inbox preference taking the envelope away and
giving it back; and three PDFs picked at once on `/submit-material` becoming three material
projects, with the third renamed in its own title row and keeping that name. 40 checks, 0 failures, no console errors, screenshots looked at — which is how the
one real bug of the pass was found (a 150px hole in the offer form that every automated check
passed).

**Learning step E — take-home decks and event ↔ course** (`learn/e-events`, 2026-10-05).
`backend/events/test_takehome.py` is 24 tests in five classes, refusal-weighted: who gets 404 on an
unannounced event's session, what a **private** linked set contributes through the session (and that
the set itself stays 404 to the same reader), that an unpublished exercise is dropped from both the
list and `takehome_count`, that the two surfaces agree, and — for `GET /api/events/{id}/
related-courses/` — that an unlisted course is absent for a stranger and present for its own staff,
that a dissolved organisation takes its courses off the panel, that `organizations` off answers
`[]` with a 200 while the event itself still answers 200, and that `events` off still 403s. Run it
with `../.venv/bin/python3 manage.py test events organizations config --keepdb` from `backend/`
(354 tests with its neighbours, ~5½ min on a warm `--keepdb`). The browser half is
`frontend/e2e/take-home.mjs` — 53 checks against both real servers on this branch's ports:
`rm -rf backend/cachedata/*; E2E_BASE=http://localhost:5235 E2E_API=http://127.0.0.1:8135/api node
e2e/take-home.mjs`. It builds its own event, session, private set, organisation and two courses
through the real API and deletes them again, so it needs no seeder beyond `seed_demo_users`
(`kasia`, `ola`, `michal`, password `password123`). **It mocks `POST /api/decks/` with
`page.route`** — that endpoint is learning step A's and does not exist on this branch — and asserts
what the request carried rather than what came back; the real call is verified at integration. Its
four screenshots land in `e2e/screens/take-home-*.png`. If a count check fails, suspect the script
before the app: the first run failed three on counting before the panel's own fetches had landed
(`e2e/CLAUDE.md` trap 8), which is why every count is now behind a wait for real text.

## Learning step G — the design showcase under `/about/<feature>`

**`e2e/showcase.mjs` (119 checks, new 2026-10-05, HISTORY.md §17BR.G)** — the seven prerendered
pages that show this cycle's designs with sample data. It opens each in **both** interface languages
and checks the `<h1>`, exactly one `<title>`, the "nothing here is live" notice, the expected number
of sample frames and the six links to its siblings; it collects every link a reader can actually
follow (excluding the ones inside an `inert` sample, which are part of a picture) **by resolved
pathname, not by `href` attribute** — SvelteKit's relative paths emit `../about` and the raw
attribute differs by page depth — and refuses anything outside an allowlist of routes that really
exist. It then proves the three claims these pages make about themselves: that they need no backend
(the set of API paths requested must not exceed the root layout's own three boot requests), that an
`inert` sample cannot be clicked through (it clicks a sample `ExerciseCard` with `force` and asserts
the URL did not move), and that the one live sample — the flashcard — flips, reveals its hint, takes
a grade and costs nothing. Finally three pages at 390px with a `scrollWidth` overflow check, the
dark theme, and a plain `fetch` of `/about/exercises` asserting the server-rendered HTML carries
typeset KaTeX (≥ 4 `.katex` nodes) and its `figcaption`s rather than just the shell.

**Extended 2026-10-14 (261 checks)** when the pages gained real screens and ways out (`ShowcaseShot`,
the "Try it yourself" row, the manual link): all **eight** pages now (`/about/contests` was missing,
and the index expected seven cards of eight); per page the expected count of "Try it" links,
screenshots and the manual chapter it names; every screenshot scrolled into view and checked to
decode at the pixel size its `width`/`height` claim, lazy, with alt text and **outside** any inert
frame; every followable link and every PNG fetched from the dev server (200, `image/png`; `/dziennik/`
excepted — it is the vhost's, not the app's); the manual link cross-checked against the manual
itself, by opening every chapter the `/about/guide` hub lists and reading which showcase page it
links (`hrefs.ts: SHOWCASE_GUIDE` is hand-kept and says why); a kill-switch pass that rewrites the
flag list **in the browser** with `page.route` (no database row touched, signed out so no staff
bypass) and asserts the `/flashcards` and `/concepts` links leave while the pictures, `/my-set` and
the manual link stay; and a real click on a screenshot's "Open the real page". The "no API beyond
the boot requests" check still holds — the pictures are static files.

**Extended again 2026-10-14 (426 checks), the four module pages (WP5)** — `/about/goals-and-work`,
`/tutoring`, `/materials`, `/conference`: their h1s, one sample frame each, "Try it" counts (the
goals page's `/work` link is drawn only for a signed-in reader, so a signed-out run expects three,
and `E2E_TOKEN` adds a signed-in check for the fourth), screenshot counts, and how many screenshots
carry a link (the conference's ticket, scanner, rota and cloakroom pictures carry none — those pages
need an event id and a staff right). The tutoring and materials pages must link `/korki` and
`/materialy` in Polish and the canonical paths in English. A second kill-switch pass turns off
`tutoring`; `needs`+`tasks`+`organizations`; `coauthoring`+`attachments`; and
`events`+`venues`+`tickets`+`cloakroom`, asserting each page's links leave, its page-wide notice
appears only when its main feature is off, and each section whose own feature is off says so in one
line. **The "no API beyond the boot requests" check was VACUOUS until this pass**: it was read straight
after `load`, before hydration, so it never saw `/api/discussions/` (every showcase page asks for its
discussion policy) nor `/api/disciplines/` + `/api/branches/` (the root layout's
`taxonomyStore.preload()`, on every page). Adding a wait for the flag request turned all sixteen
checks red. It now waits for hydration, counts those two as boot requests, and allows exactly one
discussion-policy request for the page's own `about/<slug>` key.

    cd frontend && E2E_BASE=http://localhost:5237 E2E_API=http://127.0.0.1:8137/api node e2e/showcase.mjs

**Extended 2026-10-15 (507 checks), the account and licences pages (WP6)** — `/about/account` and
`/about/licences-and-data`, the same module shape: h1s in both languages, one sample frame each (a
deletion timeline; a licence history), five and three screenshots. The account page's "Create an
account" and "Log in" links are `SHOWCASE_LIVE.signedOut` — drawn only for a signed-out reader — so a
signed-out run expects four "Try it" links and five screenshot links, and the `E2E_TOKEN` pass (9c)
now also asserts a signed-in reader gets two (`/settings`, `/settings/account`) and no screenshot
link to `/register` or `/login`. Section 9d turns off `social_login` (the providers section says so,
no link moves — none answers to it) and `exercise_submissions` + `material_submissions` +
`client_errors` (`/submit` and `/submit-material` leave, `/terms` and `/privacy` stay, the error-report
section says so). Phone overflow for both, a dark-theme shot of `/about/account`, and a raw-HTML check
that the licences page's prose (the CC BY 4.0 suggestion) is in the server-rendered page.


**`e2e/showcase-screens.mjs` (new 2026-10-14)** takes the module pages' pictures into
`frontend/static/showcase/<slug>/` with the guide script's shapes (English interface, clipped shots,
the 400 KB budget). It signs in from DRF tokens in a JSON file (`E2E_TOKENS`, trap 30) rather than
the login endpoint. The development database had no goal anywhere, so it writes ONE through the real
API — on the seeded `TEST=FAKE Dni Dydaktyki Fizyki 2026` conference, as its organiser, found by title
so a re-run does not add a second. The tutoring page reuses `static/guide/tutoring/01–02`, checked
against today's screen; `03`/`04` were not reused because the reviews panel under the booking box has
changed since. Last run: 13 pictures, 921 KB in total, largest 135 KB. **WP6 (2026-10-15)** added `account`
(register, login, a guardian's Settings cards, the data and deletion page in two crops) and
`licences-and-data` (the licence picker on `/submit` with its "Suggested" tag, a CC BY 4.0 licence line
and a corpus "rights not yet clarified" line) — eight pictures, 547 KB, largest 157 KB. They need the
token-file keys `persona.guardian`, `julia` and `ola`; `julia` is used because her deletion plan has
"EdMat only" content and no blockers, so the page draws its whole plan, the keep-or-remove choice and
the confirm form. Nothing is written — the delete button is never pressed. The CC BY line is
exercise 748 on the development database (an `e2e/licences.mjs` row, cropped to its statement so its
test title is out of the picture; `E2E_CCBY_EXERCISE` overrides it), the corpus line exercise 1
(`E2E_CORPUS_EXERCISE`). `ONLY=account,licences-and-data` skips the conference arrangement.

Thirteen screenshots in `e2e/screens/showcase-*.png`, meant to be looked at — three real defects in
this step were found that way and by nothing else (a lost space in a deck tile, a table column cut
mid-digit at phone width, a bullet list with no bullets). **They are deliberately not committed**,
unlike the 46 older ones beside them: thirteen full-page renders are 6.6 MB, which would nearly
double the tracked weight of that directory just as step H starts adding a manual's worth, and this
script regenerates all thirteen in one command against nothing but the two dev servers — no seeded
data, no account. Run it and look.

**Two traps, both specific to running this in a WORKTREE.** `frontend/node_modules` is a symlink to
the main checkout, which is outside Vite's `server.fs.allow` root, so the dev server answers **403**
for KaTeX's own font files and every page with maths logs console errors; the script allows exactly
those by name rather than widening its check, and `check_accessibility.ts` reads them as "this page
failed to load" on `/about/exercises`, `/about/flashcards`, `/about/concepts` and on the existing
`/exercises/{id}` and `/concepts/{slug}` audits alike. Separately, the backend logs
`no such table: telemetry_requestlog` per request, because a copied `db.sqlite3` does not bring the
log shards.

**`scripts/check_accessibility.ts` grew the seven pages** as one contiguous block at the end of its
anonymous list (anonymous by definition — the whole point of these pages is what somebody who has
never signed in can see). `npm run check:a11y -- --base http://localhost:5237 --api
http://127.0.0.1:8137`: **0 violations on all seven**.

## 2026-10-05 — concept paths (learning cycle, step D)

**`backend/concepts/tests.py: PathTests`** (19 tests, inside the file's existing 146-test
`concepts` suite): `concepts/paths.py` and the three endpoints over it. Weighted at the three
bounds, because the bounds are what the feature IS — a chain walked past one hop, a chain longer
than four hops stopping, a cycle cut rather than looped (asserted both from the start of the cycle
and from inside it, which is where an unbounded walk spins). Plus: `depth`/`limit` clamped rather
than trusted, a shared prerequisite appearing once at its NEAREST distance, a `related` link not
counting as a prerequisite, and a query-count bound (≤ 10 for a five-deep chain) so the cost cannot
start depending on the size of the graph. Then the endpoints: `{slug, title, distance}` with the
title resolved for the caller's own band (a second article for a different audience must change the
name on the rung), a concept nobody can see dropped from the answer but visible to staff, 404 for a
concept that is not there, the union closure on `learn-first`, and the two different kill-switch
postures — `learn-first` answers `[]` (house rule 3's documented carve-out, the sibling
`?target_type=` list's posture), while `prerequisites` and `exercises` answer 403 because the page
that reads them is gone anyway. Run: `../.venv/bin/python3 manage.py test concepts config --keepdb`.

**`frontend/e2e/concept-paths.mjs`** (30 checks). Builds a real prerequisite chain through the
real picker on the seeded concepts — the relation select, the search, the Add button — and
deliberately closes it into a CYCLE, then reads it back in three places: the bounded closure from
the API, the path on the concept page (farthest first, ending where the reader is), and the flat
"before this, know…" row on an exercise linked from its own page. Also: an exercise with no
concepts renders nothing at all; an exercise about *every* concept in the chain honestly has
nothing left to learn first; the deck button posts every linked exercise in order with the concept
as its source; `flashcards` off takes the button and leaves the page; `concepts` off takes the row
and leaves the exercise page, with the endpoint answering `[]` rather than 403 to a reader who was
never signed in. **`POST /api/decks/` is mocked** — step A owns it and it 404s on this branch
(`prompts/README.md` §9). Scratch links are removed through the real API at the START as well as
the end, because a crashed run leaves them and `add_link` then answers 409 `already_linked` while
every later check passes against the previous run's data — a green closure over a red button.
Run: `rm -rf backend/cachedata/*; E2E_BASE=http://localhost:5234
E2E_API=http://127.0.0.1:8134/api node e2e/concept-paths.mjs`.

**Two environment traps this script found**, both worth knowing before reading a failure here as a
code bug. A git worktree made by copying `db.sqlite3` has **unmigrated log shards**, so every write
that records an `AuditEvent` (adding or removing a link) answers 500 *after* creating the row —
`for a in logs_0 … logs_anon; do manage.py migrate --database=$a; done`. And `node_modules` in a
worktree is a symlink outside Vite's `fs.allow` root, so every KaTeX font 403s on the dev server
only.

## 2026-10-05 — the creation gate (learning step F, `HISTORY.md` §17BR.F)

**`backend/config/test_creation.py`** (new, three classes). `CreationGateTableTests` walks the rule
itself with no HTTP in the way: five callers (anonymous as both `AnonymousUser` and a bare `None`,
minor, ordinary, verified contributor, staff) × the flag on and off × **all four kinds every time**,
because the rule is kind-independent today and the table should be what fails the day it stops
being. It also pins the two things that are easy to get wrong — a MISSING flag row keeps the
restriction on (`is_feature_enabled` fails open, and this flag is inverted), and
`Profile.is_verified_contributor` is the only signal. `CreationGateRequestTests` proves the word
arrives: `403 {"detail": "verification_required"}` at `POST /api/courses/`, `/api/events/`,
`/api/services/` and `/api/organizations/`, each paired with the 201 the flag turned off restores,
plus staff founding all four, a minor hearing `minor` at all four, an anonymous create still being
a 401 rather than this refusal, and reading/joining/enrolling untouched.
`CreationStatusEndpointTests` does the same for `GET /api/creation/`, which has to agree with the
four create paths or the Add… menu offers a button the server refuses. Run it with
`manage.py test config` (it needs `databases` for the log shards, like `config/test_nodes.py`).

**Six existing suites moved, and this is the paragraph to read if one of them fails.** The gate is
seeded ON, so every fixture that founded a course, an event, a listing or an organisation through
the API started answering 403. `courses/tests.py`, `events/tests.py`, `services/tests.py`,
`services/test_location.py`, `organizations/tests.py` and one test in
`exercises/test_sorting_locale.py` now make their acting user a verified contributor, each with a
comment naming `config/creation.py`; and `events/test_permission_matrix.py` carries two rows whose
answer genuinely changed — `stranger POST /events/` and `attendee POST /organizations/` are now
`(403, 'verification_required')`. **A suite failing with that word is this rule, not a regression in
the app under test** — give its fixture `is_verified_contributor=True` (or flip the flag off in
`setUp`) and say which you did.

**`frontend/e2e/creation-gate.mjs`** (new). Six sections, 57 checks: the endpoint for four callers
(signed out, ola, michal, kasia — the demo seed already has an ordinary account, a verified one and
staff); ola losing both Add… entries, all four hub create controls and the `/courses/new` form while
getting a sentence and a `/levels` link in their place; kasia keeping everything with no sentence
anywhere; the flag flipped off through the real API giving ola every control back; the Add… trigger
itself disappearing once the two submission switches are off as well; and a final section asserting
every switch it touched is back where it was. Absence is only ever asserted after something positive
has landed on the same page (trap 8). Run it with `rm -rf backend/cachedata/*` first:

```
E2E_BASE=http://localhost:5236 E2E_API=http://127.0.0.1:8136/api node e2e/creation-gate.mjs
```

Screenshots land in `e2e/screens/gate-*.png`. **Looking at them changed the code once**: the
organisations hub drew the refusal above its own introduction, so a reader met "you may not" before
"what this is". The script also re-learned trap 25 the hard way — filling and submitting the login
form before hydration performs a NATIVE form submission and lands on `/login?` with the fields
cleared, which reads exactly like a broken page; `signedIn()` now waits for the layout's own boot
request and retries the submit rather than believing the first attempt.

## 2026-10-05 — learning step C (courses: school mode, the completion certificate)

**`backend/courses/test_school_mode.py` (new, 58 tests)** is the suite for school mode, the
`CourseCompletion` certificate, `courses/record.py` and `seed_school_demo`. Its own file rather than
four hundred more lines in `courses/tests.py`, following the app's existing `test_claims.py` /
`test_content_links.py` precedent, and refusal-weighted like the rest of this backend: each of the
five refusal words with its own status code, a stranger **and** a classmate both getting 404 on a
certificate (never 403 — a 403 confirms somebody finished a course), revoking twice, `off` and
`supports` and a university and a dissolved school all answering "not a class", a revoked
guardianship reporting an absence rather than nothing, and the seeder's containment check refusing
both an outside `CourseStaff` row and an `is_staff` flag. **Two of its tests found real things**:
the control for the progress widening passes only if it asserts the response *contents* (a
status-code-only control passed against a response that named every participant, because staff are
members under `private`), and the certificate queryset was scoped so that a pupil who leaves a
private class — which is what a school runs — lost their own certificate. Run it with
`../.venv/bin/python3 manage.py test courses organizations config --keepdb` from `backend/`.

**`frontend/e2e/school-mode.mjs` (new)** drives the seeded school on ports 8133/5233 and needs
`manage.py seed_school_demo` run against the backend it drives first — otherwise every check fails
at a sign-in rather than on anything under test. Seven sections: the teacher's view of a class (the
"run by" line, the class notice, the register although `progress_visibility` is `private`, the roster
with its guardian column and under-16 badges), a scratch control course no school runs (made and
removed through the real API, which is what proves the widening is the *link* and not the role),
issuing a certificate and being refused one with the word, the holder's own view plus the print
preview under `emulateMedia({ media: 'print' })` and at phone width, a stranger's 404s, the
lesson→deck button, and both kill switches as a non-staff account. **`POST /api/decks/` is mocked
with `page.route`** — learning step A owns that endpoint and it 404s on this branch — and the script
says so twice in its own output; `/flashcards/[id]` is A's route and is asserted to exist rather than
followed. It signs in by writing the token into `localStorage` the way `token.svelte.ts` keeps it,
so no run touches the register throttle (trap 1), and every scratch row is removed through the real
API and confirmed with an authenticated re-query (trap 12).
**Since WP12 (2026-10-15)** the control course is founded through the creation gate, which refuses
the unverified seeded teacher: when `/api/creation/` says `verification_required`, the script turns
`creation_requires_verification` off as kasia for that one POST and back on in a `finally` (and checks
it is back). Sections 3 and 4 open the `completions` fold by its toggle, the way a reader does — the
panel has been folded since 3d9f613c and its body is not in the DOM while shut — and read the
heading from the fold. It accepts `E2E_TEACHER_TOKEN` / `E2E_STAFF_TOKEN` and signs each account in
at most once (trap 30). 65/65 on a DB copy, ports 8063/5213.

**`manage.py seed_school_demo`** is itself worth running as a check: it asks
`completion_block_reason` before writing its certificate and `progress_writable_by` before each
progress statement, so a hand-edited plan fails the command rather than seeding data the API would
refuse, and `assert_contained()` runs inside the build's transaction over its own
`CONTAINMENT_MODELS`. Run it, run it again, `--reset`, run it again: one of everything each time.

## 2026-10-05 — the user manual's screenshots (`frontend/e2e/guide-screenshots.mjs`)

`/about/guide` is written against the screens as they are, and its fifty pictures are taken
rather than drawn. All **eleven** chapters have pictures since 2026-10-06, when closing step C
replaced the flashcards placeholder with a written chapter and a `chapters.flashcards` block
(`static/guide/flashcards/`, seven pictures, 186 KB). **`frontend/e2e/guide-screenshots.mjs` is how they are re-taken** — after any UI
change that moves something a chapter points at, and as a matter of course before a release that
touches one of the surfaces it covers.

```bash
cd backend && ../.venv/bin/python3 manage.py migrate && \
  for s in seed_demo_users seed_demo_content seed_concepts seed_conference_demo seed_profile_showcase; do \
    ../.venv/bin/python3 manage.py $s; done
# both servers up on your own ports, then:
rm -rf backend/cachedata/*
cd frontend && E2E_BASE=http://localhost:5238 E2E_API=http://127.0.0.1:8138/api \
  node e2e/guide-screenshots.mjs
ONLY=exercises,submit node e2e/guide-screenshots.mjs    # one or two chapters while iterating
```

It writes `frontend/static/guide/<chapter>/<nn>-<name>.png`, **checks its own budget** (400 KB a
picture, 8 MB in total — `npm run build` copies `static/` verbatim into the deploy bundle) and
fails if either is exceeded. It deletes a chapter's folder before re-taking it unless `KEEP=1`.
Last run (2026-10-06, closing step C): 58 checks, 0 failures, 50 pictures, 2.39 MB, largest
105 KB.

Seven things about it that are not obvious, each of which has already cost a wrong picture:

- **It needs `vite.config.ts`'s `server.fs.allow` entry for the shared `node_modules`.** In a
  worktree that directory is a symlink, Vite refuses `/@fs/<realpath>/katex/dist/fonts/…` with 403,
  and every formula is drawn in a fallback face. Before the fix: 74 console errors and
  wrong-looking mathematics. After: 1.
- **It waits for hydration, not for an element** (e2e trap 25). The header's language picker reads
  `pl` in the server-rendered HTML even on an English page and flips to `en` when the runes take
  over; `hydrated()` waits for that, which is 3 s on a light page and 8 s on the home page.
- **Every shot is clipped and measured at scroll 0.** `boundingBox()` is viewport-relative, and a
  `fullPage` capture draws the sticky header wherever the page is scrolled to.
- **It asks for `pl` + `en` content** — through `localStorage` when anonymous and through
  `PATCH /api/auth/me/` when signed in (e2e trap 16), restoring the accounts afterwards.
- **It leaves marks.** One exercise submission per run (deliberate: it is the only way to photograph
  what the form says afterwards, and it gives the moderation chapter a real pending row), plus
  idempotent demo rows — the seeded course made public, one help-wanted posting, one volunteering
  offer, one message, one booking request.
- **It hides leftover rows rather than deleting them.** `hideScratch()` masks `asdasd`,
  `Linking check …`, `Published hours …` and friends before each shot; it does not own them.
- **A whole run exhausts a tired dev server, and the damage is silent** (e2e trap 3). On a loaded
  machine the second half of a run filled the console with `ERR_INSUFFICIENT_RESOURCES` and
  `Failed to fetch dynamically imported module`, the `events` chapter failed waiting for its
  Programme heading, and three pictures came out at a tenth of their usual size — every one of them
  still *passing* the budget check, because a blank page is a small PNG. On fresh servers the same
  commit produced 58/58. Restart both servers before a full run, and compare the file sizes with
  the committed ones afterwards: a picture that lost 90 % of its bytes is a picture of nothing.

`npm run check:a11y` now also audits `/about/guide` and all eleven chapter pages (they are in
`scripts/check_accessibility.ts`'s anonymous list). Nothing in the manual calls an API, so a chapter
page renders with the backend down.

**2026-10-14 (next loop, WP4): the twelfth chapter's pictures, the "Open this screen" links.**

- `chapters.contests` makes **three contests through the real API** (a finished `university` one by
  kasia with results and an answered complaint, a `challenge` taking entries, a `challenge` whose
  round is open with ania's half-written answer), idempotently by title, and shoots eleven pictures
  (1.2 MB). The wizard is driven to its last screen and never submitted. Its people screen is shot
  with the leftover `e2e-coop-…` / `E2E Circle …` reasons filtered out of the suggestion response in
  the browser (`withoutScratchSuggestions`) — `hideScratch()` one layer down — and kasia is given a
  private course roster (`Analiza matematyczna II — ćwiczenia`, Michał and Ola as staff) so the
  screen has a real reason to show.
- `PICTURES=start/02-header,…` re-shoots only the named pictures and leaves the rest of the chapter
  alone; `E2E_TOKENS='{"email":"token",…}'` replaces the ten sign-ins that otherwise trip the login
  throttle on a second run inside the hour.
- **`vite.config.ts`'s `fs.allow` entry is now the symlink's real path**, computed: the literal
  `/Projects/edmat/frontend/node_modules` was one machine's layout and allowed nothing under
  `/home/<user>/Projects/`, so KaTeX's fonts were 403 again in every worktree there.
- **The fonts in the pictures are the machine's** (`system-ui`): this one has only DejaVu, so the
  2026-10-14 pictures (contests, and start 01/02/05) are drawn in DejaVu while the older ones are in
  Noto. Same layout, different face — re-shoot everything on one machine before a release if that
  matters.

`frontend/e2e/guide-try-links.mjs` checks the manual's "Open this screen →" links
(`GuideStep.tryHref`, typed as SvelteKit's `PathnameWithSearchOrHash`, so a link to a route that does
not exist is a `svelte-check` error before it is anything else). It reads the declared links out of
`lib/content/guide/*.ts`, counts them on every chapter page signed out in Polish and in English, opens
every one (a heading, not the 404), checks `/tutoring` is written `/korki` for a Polish reader, that a
moderator sees the moderation chapter's links and a signed-in reader the contest wizard's, **turns the
`volunteering` switch off through the API and checks a non-staff reader loses that link but keeps the
`needs` one** (then puts it back), and photographs `start` and `contests` at 1280 and 390 in both
languages with a no-horizontal-scroll check (`e2e/screenshots/guide-*.png`, gitignored). Last run: 94/94, zero page
errors.

```bash
E2E_BASE=http://localhost:5203 E2E_API=http://127.0.0.1:8053/api \
  E2E_STAFF_TOKEN=<u-kasia> E2E_USER_TOKEN=<demo-ania> node e2e/guide-try-links.mjs
```

**`flashcards` (learning cycle step A, 2026-10-05).** `backend/flashcards/tests.py` is 64 tests in
eight classes, and the order is the point: `SchedulingTests` first, because `scheduling.review` is a
pure function and the only honest way to test an algorithm is a **table** of grade sequences against
expected intervals (`TABLE`, five sequences, plus the ease clamp at both ends and the interval cap);
then every refusal before any happy path — `VisibilityTests` (404 for a stranger and for an
anonymous caller, a placed deck reaching a course's participant, an event proving `config/nodes.py`
dispatches), `AuthorityTests` (a participant refused a rename on **PATCH and PUT**, refused a
delete, refused a card edit), `PlacementRefusalTests` (the four `place_block_reason` words, with
`already_placed` as 409 and the rest 403, plus a private node withheld from a stranger's read of a
deck's placements), `MinorTests` and `KillSwitchTests` (asserted as a NON-staff caller, with the
staff bypass and a neighbouring course endpoint each getting one of their own). Only then
`DeckCreationTests`, `CardTests`, `ReviewTests`, `CopyTests` and `ProviderTests` (the two hooks the
integrator registers — `record.activity_by_branch` and `work.work_items` — which nothing imports on
that branch, so this is their only proof). Run it with
`../.venv/bin/python3 manage.py test flashcards config --keepdb` from `backend/`.
`frontend/e2e/flashcards.mjs` is the browser half, 42 checks in seven sections: a deck made from a
saved set on `/my-set`, `/flashcards` and the deck page, a card flipped with **Space** and three
graded on **keys 1/3/4** with the resulting counts checked against what SM-2 should have produced,
the deck placed on a course and studied by a **participant** of it on their own schedule, the kill
switch taking the panel and the account-menu entry away (and section 5b putting them back, because a
kill-switch check that never saw the link present proves nothing), phone width, and the Polish
default. Run it as
`rm -rf backend/cachedata/*; E2E_BASE=http://localhost:5231 E2E_API=http://127.0.0.1:8131/api node e2e/flashcards.mjs`
with both servers up; it builds and removes all its own scratch state through the real API. One
thing it will print on any worktree: ~30 KaTeX font requests refused with 403 by the dev server's
`server.fs` allow list, because `frontend/node_modules` is a symlink to the main checkout. That is
environmental — the production build copies the fonts — and the script buckets and reports the
count rather than hiding it.

**`e2e/make-a-deck.mjs` (45 checks)** — the three "make a deck" buttons against the **real**
`POST /api/decks/`. Steps C, D and E each built one while step A still owned the endpoint, so all
three were verified against a `page.route` mock of the agreed §API shape (`take-home.mjs` and
`school-mode.mjs` still carry theirs) and nothing had ever pressed one for real. Six sections: a
course lesson pressed by the **instructor** (three cards in the lesson's own order, placed on the
course, and the course's Flashcards panel listing it); the same lesson pressed by a **participant**
(their own deck, deliberately unplaced, and the course's placements unchanged); a lesson whose
**generated name is longer than a deck name may be** (the regression test for the 400 this script
found — see `HISTORY.md` §17BU.D); a programme session pressed by the **organiser** ("Take home",
placed on the event); the same session pressed by a **visitor** (theirs, and the event's panel does
not grow a row); and a **concept**, whose confirmation now links to the deck and whose link is
followed to `/flashcards/[id]`. Each of the three is pressed a **second** time, because the design
answer is a second deck rather than a refusal (`already_placed` can only fire for a deck that is
already on that node). It builds its own course, chapter, two lessons, four course items, event and
session through the real API, uses the seeded concept `calka` read-only, and deletes every deck it
made from BOTH accounts before confirming through an authenticated re-query. Needs
`seed_demo_users`, `seed_demo_content` and `seed_concepts`. Run it as

    rm -rf backend/cachedata/*          # backend stopped
    cd frontend && E2E_BASE=http://localhost:5254 E2E_API=http://127.0.0.1:8154/api node e2e/make-a-deck.mjs

(the ports are whichever pair is up; `E2E_API` is accepted with or without the `/api` suffix).
Screenshots land in `e2e/screens/make-a-deck-*.png` and are meant to be looked at — the truncated
deck name and the underlined "Open it" on the concept page are both things only a screenshot shows.

**Run for the first time on 2026-10-06** (closing step D, `prompts/15-browser-pass.md`), on ports
8144/5244: **43 checks, 0 failed, 0 console/page errors**, and every screenshot looked at. It had
never been run against real servers before — it was written on `learn/a-flashcards` beside the app
it drives — and the first run found three faults, all in the script and none in the app: it signed
in eight times through the form and walked into `POST /api/auth/login/`'s **10/min per-IP throttle**
(it now drives the form once per account and reuses `storageState`); "the deck page lists the
placement" waited for a `.panel` whose SELECT carried the course's own title, so it passed before
the POST and screenshotted a page reading "Not placed anywhere"; and "offers a place-it-somewhere
select" counted every `select` on the page, including the header's language picker. The 43rd check
is new: the deck page at phone width, which is where the one real bug of the pass was (a `<select>`
sized by its widest option ran 69 px off a 390 px screen and cut the Place button in half — axe had
just called that page clean, because axe does not look at geometry). **Clear `backend/cachedata/*`
with the backend STOPPED**: emptying it under a running server leaves an entry the server still
holds open, and the next read answers `OSError: [Errno 116] Stale file handle` as a 500 on an
unrelated endpoint.

**2026-10-07, `after/a-frontend-fixes` (HISTORY.md §17BU.A).** `npm run check:a11y -- --base
http://localhost:5251 --api http://127.0.0.1:8151` now audits **48 pages, 0 with a load problem, 0
critical/serious and 0 moderate/minor violation nodes** — the last three pre-existing findings are
gone (`heading-order` on `/events` and `/tutoring`, `color-contrast` on `.badge--waiting` at
`/material-projects?tab=mine`). Two things to know before trusting a clean run of it. It takes
`--base`/`--api` as **CLI arguments** and not `E2E_BASE`, and it has defaults, so running it with
the env var alone silently audits an empty port and calls every page a load problem (`e2e/CLAUDE.md`
trap 29). And the badge check is only non-vacuous while some project the audited account (kasia)
belongs to has a **pending proposal** — with none, `/material-projects?tab=mine` draws no
`.badge--waiting` at all and the page passes without testing anything. `e2e/flashcards.mjs` re-run
on the same servers: **43 passed, 0 failed**.

## 2026-10-07 — the colour pass (`ux/colour-pass`, `HISTORY.md` §17BV)

Frontend only; no backend test changed. What was run, and how to run it again:

- **`frontend/e2e/colour-screens.mjs`** (new) — the screenshot sweep the pass was judged on: the
  home tabs, an exercise, a branch, every hub, search, login, and (signed in as kasia) home,
  flashcards, my set, settings, notifications, courses and `/work`, in light and dark at 1280 and
  light at 390. Not a check-counter: it writes PNGs and prints page errors, and the pass condition
  is that somebody looks at them (house rule 2). Run it twice around a theme or token change and
  compare the two folders:
  ```
  cd frontend
  E2E_TOKEN=<kasia's DRF token> E2E_BASE=http://localhost:5260 E2E_API=http://127.0.0.1:8160/api \
    CHROME=<chrome-headless-shell> node e2e/colour-screens.mjs /tmp/shots/after
  ```
  `CHROME` is the browser, as for every other script; unset, playwright-core picks its own
  (`E2E_CHROMIUM`, the name this script alone read until 2026-11-03, is still accepted).
  `E2E_TOKEN` is optional but the login endpoint is throttled (`e2e/CLAUDE.md` trap 30), so a
  sweep that is re-run several times should carry it.
- **`npm run check:a11y -- --base … --api …`** after the pass: 48 pages, see §17BV "Verified" for
  the numbers. A page reported as a load problem with `ERR_INSUFFICIENT_RESOURCES` or `Failed to
  fetch dynamically imported module` is the dev server, not the page: the first is another
  Chromium job running beside the audit, the second a dev server that has gone stale after a long
  day of hot reloads (restart it; `e2e/CLAUDE.md` trap 3).
- **`e2e/guide-screenshots.mjs`** was re-run so the manual's 50 pictures show the recoloured
  interface (63 checks, 0 failed over two runs — the same stale-server trap cost the first run two
  chapters).
- Contrast was measured, not guessed: every pair in the spec's table was produced by a small WCAG
  calculator (`contrast.py`, kept with the pass's working files outside the repo); the ratios that
  matter are recorded next to the token values in `_tokens.scss`.

**2026-10-07, `project/edmat-on-edmat` → `ux/colour-pass` (HISTORY §17BW, §17BW.B).**
`work.tests.EdmatProjectSeedTests` (7 tests, on a three-row history table and a three-item thread
so the counts are exact): the seed founds the organisation with its owner, one plan per goal with a
done, dated history step under the right goal, the three association plans (phase 2 a draft), the
phase-1 steps mirrored into tasks seated on the owner, the needs, the polls with their options, the
two research accounts with no usable password, and the thread's comments and replies dated to the
report; a second run creates nothing, keeps status / assignees / `done_by` / a need's status, and
refreshes every text (a history step's `done_at` follows the log); the anonymous and stranger
surfaces answer as the rule modules say (active plans and open needs yes, the draft plan 404, polls
and tasks none; the owner sees all, votes once — 201 — and 409 the second time); the deadlines are
empty until `FOUNDING_MEETING_AT` / `KRS_ENTRY_DATE` are patched in and then count from them, and
the founding meeting appears as a draft event linked to the organisation, once; the owner's
`/api/work/` lists every compliance task; the command prints the paths and refuses an unknown
`--owner`; and `all_seeded_text()` plus both JSON files pass `SECRET_SHAPES` / `DATA_FILE_SHAPES`.
`work.tests.EdmatHistoryTests` (4, `SimpleTestCase`): the parse of a sample log (skip-list,
reference, heading date, first-paragraph summary, goal, the twice-used references told apart by
heading), and — whenever `HISTORY.md` is present — that `work/edmat_history.json` equals a fresh
parse (run `manage.py export_edmat_history` when it does not) and that the thread file is whole.

**2026-11-02, `feat/about-decisions` (HISTORY §17DD).** The association and its thread are retired,
so `EdmatProjectSeedTests` (8 tests) changed with them: the seed writes one plan per goal and no
association row; every poll opens with its options in the file's order and reads in English
through `?lang=en` — its RESULTS too (`decisions/views.py: results` read the Polish column for
everybody until then); a database an earlier seed left the association in (both title shapes, a
sub-task, a comment under a task, a ballot, an application, the legal-report thread with a reply, a
draft founding meeting linked to the organisation) loses exactly those rows and their threads on
the next run, while a person's own task, the same title on another body and other `/about` talk
stay, and a third run retires nothing; `--dry-run` lists what it would retire and writes nothing;
and a run with no `--owner` reuses the organisation's owner (the first run without one is refused).
`EdmatHistoryTests` lost the thread-file check with the file. `translations.tests.SeedDeGluingTests`
holds the `RETIRED` titles to the one-`' / '` rule too.
Run `manage.py test work --keepdb` (23 tests). The seed itself was run twice against the
development database and the pages looked at (`/organizations/edmat`, a goal, `/work`, the thread
under `/about`).

**2026-10-08, the open board (`organizations/test_open_board.py`, 4 tests).** A body with
`open_board=True` beside one without: the field is read by anyone and set by a manager only (a
stranger's PATCH is 403); `node_ref` carries it; its tasks are listed and retrieved by an anonymous
reader and a stranger with `can_edit` false, while the closed body's stay 404, and a stranger's
create and transition are refused; its open and closed polls are listed with `can_vote` false and
`can_see_results` true, the draft and the closed body's poll 404, the results carry the tally and an
empty ballot list, and a stranger's vote is `409 not_eligible` while the owner's row says
`can_vote`. `work.tests` adjusted: the seeded organisation's board is open, so the anonymous and
stranger readings of its tasks and polls are 200 with no vote or edit. Run `manage.py test
organizations tasks decisions work --keepdb`.

## The "AI-assisted" mark and bilingual management text (2026-10-08, `HISTORY.md` §17BX)

### `provenance/tests.py` — 28 tests

**The formula first, with no database.** `rules._derive` is a function over an already-gathered row
for exactly this reason: the thing hardest to notice going wrong is not "a vote was saved" but "the
three-people icon lit on one person's opinion", and that is a table of numbers rather than a request.
Nine rows: nothing claimed, one confident vote (which must NOT light the community mark — that is
`MIN_VOTES_FOR_COMMUNITY_MARK`), enough votes above and below the threshold, the author's mark
reading 100 whatever the votes say, an author's denial NOT pulling the community reading down, and a
lock replacing the community reading while leaving the author's mark alone.

**Then the refusals, before any happy path:** the author voting on their own work (403
`author_marks_instead`), a stranger answering as the author (403 `not_the_author`), an anonymous
visitor reading but not voting, a confidence outside 0–100, a lock with no reason, an ordinary reader
locking, a removed comment **omitted from the batch rather than described** (house rule 4) and still
described to staff, an unknown kind dropped from a batch and 404 on a write, the kill switch closing
the surface to a non-staff reader, and a minor's mark counting while their free text does not.

Then: a vote as an upsert (the count is people, never opinions), retraction, three readers lighting
the community mark, the author mark recording who answered and at which version, "the author says no"
being a different state from "nobody has asked", a moderator locking and unlocking without erasing
who said what, a branch governor locking inside their own branch, one batch answering for four kinds
at once, the batch saying what this reader may do with each row, and the batch cap.

### `translations/tests.py` — 24 tests

**The resolution first, with no database and no models**: `resolve.pick` takes plain values, which is
why these are a table. (An earlier draft faked a *model* and got an empty heading, because
`targets.own_text` asks the registry what a row's text columns are called and a fake is in no
registry.) Six rows: a row with no versions reading its own columns and saying nothing else — which
is every management row written before this existed, and what makes the change additive; the reader's
own language when it exists; the original with `is_fallback` when it does not; **two languages
written together reporting nothing newer**; a newer version in another language reporting the gap in
seconds; and the reader already on the newest one being told nothing.

Then the refusals (an outsider gets 404 not 403 — writes are owner-scoped; anonymous; an unknown
kind; an **open poll** refusing 409 `poll_not_draft`, the same refusal `decisions/views.py` already
makes because an open poll's question is what people voted on; an original language missing from the
payload; an empty original heading), then the happy paths — including the end-to-end one that caught
a real bug: a task listed with `?lang=en` must answer `title` in English, which it did not until
`tasks/views.py` started passing `request` in the serializer context.

Also: changing which language is the original (the partial unique index is immediate, so the previous
original has to stop being one FIRST — an earlier draft of the service got this wrong), a blanked
translation being deleted while an unmentioned one is left alone, a task **assignee** translating the
thing they are carrying, every kind in the registry, a poll option's heading-and-no-body, an
organisation's body-and-no-heading, and the mirrored column being sanitized like the version row.

`SeedDeGluingTests` / `SeedLookupTests` cover `work/edmat_project.py`'s own splitting: the body rule,
the title separator (including `tak/nie? / yes/no?`, the case that made a naive split risky), an
assertion that **every** title in that file still splits into at most two halves, and the lookup
finding a row whether an earlier run left it glued or this run rewrote it to the Polish half — without
which a second run duplicates every task, plan, need and poll.

### `frontend/e2e/ai-assist-cards.mjs` — 14 checks

"N% AI" on every exercise and material CARD (HISTORY §17DG): every card on `E2E_BRANCH`'s list and
on `/materials` carries a label-chip reading `^\d+% AI$`; the list asks in batches (no request over
100 targets); kasia (the submitter of `E2E_EXERCISE`) marks it through the API, the reader opens it
and comes back, and the card reads "100% AI" — the site-wide holder pruning on navigation; one chip
on the material page; none inside an `/about` sample frame and no request about its invented ids;
no overflow at 390 px; zero console errors. Writes one author mark and deletes it, start and end.
The 80% line expects the three votes `ai-assist-and-bilingual.mjs` leaves on exercise 3.

```bash
E2E_BASE=http://localhost:5173 E2E_API=http://127.0.0.1:8000/api [E2E_KASIA_TOKEN=…] \
  node e2e/ai-assist-cards.mjs
```

### `frontend/e2e/ai-assist-and-bilingual.mjs` — 39 checks

Both features in one script because they land on the same two pages.

```bash
E2E_BASE=http://localhost:5183 E2E_API=http://127.0.0.1:8100/api \
  E2E_OWNER_TOKEN=<the EdMat organisation owner's DRF token> \
  node e2e/ai-assist-and-bilingual.mjs
```

Needs `seed_demo_users` and `seed_edmat_project --owner <username>`. Part C needs a token because the
organisation's owner is a real person's account rather than a demo one; without it those six checks
are skipped rather than failed.

- **A** — the content menu on the statement, a hint/solution and a review, with the ORDER asserted as
  an order (reply above the AI mark, report below it) and not as a set; the confidence slider writing
  a real vote; and the chip appearing only once **three** readers agree — one vote lights neither
  mark, so the script votes twice more through the API and then asserts that exactly one of the two
  icons is lit and that the label names the community.
  Since 2026-11-02 (§17DG) the chip is on the exercise ALWAYS and reads "N% AI" — with three readers
  at 80/90/70, "80% AI".
- **A3** (2026-11-02) — a material: "0% AI" unmarked, "100% AI" with the author's mark lit once kasia
  (its submitter, `E2E_MATERIAL`, default 1) marks it through the API, no page errors, and the mark
  is DELETED again so the material is left with no author answer. **Parts B and C fail on stale constants** (the organisation description from before
  the owner's rewrite of 2026-10-08); see §17DG "Left open".
- **A2** — the `ai_assisted` kill switch **as a non-staff reader** (trap 10): the AI item and the chip
  go, reply and report stay, because they belong to other features (house rule 3).
- **B** — `/about` in English and in Polish, asserting both that the right language is there and that
  the other one is NOT, which is what "glued" would look like.
- **C** — the owner's "Edit in both languages…" on the organisation description and on a need row,
  and the editor's two panes carrying the Polish and the English.

Three traps this script re-learned, each now written into it:

- the token key is **`edmat-auth-token`** (`token.svelte.ts`'s `STORAGE_KEY`); an earlier draft
  guessed `edmat.token` and the symptom was a menu with only "Reply" in it, because every other item
  needs `authStore.isAuthenticated`;
- it **resets its own vote through the API at the start**, or the second run finds the first one's
  and looks for a button that now reads "Change my opinion";
- an entry needs **two** clicks to reach — the reveal toggle, and "show N more in other languages",
  because the script reads the English interface and the corpus entries are Polish (trap 16, one
  layer in: it bites inside a page as well as on a list).

## Goals and their definitions of done (2026-10-08, `HISTORY.md` §17BZ)

### `goals/tests.py` — 31 tests

`../.venv/bin/python3 manage.py test goals`. One organisation is the node, because its three roles
map exactly onto the three tiers this app distinguishes: an `owner` manages it, a `member` is node
staff, a stranger may read it and touch nothing.

- **`DefinitionOfDoneTests`** — the derived `met` in every direction: a goal with no criteria stays
  open however often it is recounted; ticking the last of two meets it and records who and when;
  un-ticking re-opens it and clears the moment; ADDING an open criterion to a met goal re-opens it
  (the prefetch-cache bug — `Goal.criteria.count()` answered from the cache and the goal stayed
  met); removing the last OPEN criterion meets it; `abandoned` survives a recount in both
  directions; a hand-written `met` is 400 carrying *"tick the criteria"*.
- **`TransitionTests`** — `open ↔ abandoned` by hand; `met -> open` refused 409 while un-ticking
  works; a PATCH to the status a row already has is a 200 no-op while the rule module still calls it
  illegal (which is what a future status would hit).
- **`AuthorityTests`** — a manager writes and a stranger is refused `not_manager`; node staff tick
  but may not rewrite the goal or a criterion; a non-staff reader is refused `not_staff`; the goal's
  own author edits without managing the node.
- **`VisibilityTests`** — public on any node you can view, including one whose BOARD is closed (the
  line that separates a goal from a task); a dissolved organisation's goals are 404 to a stranger
  and 200 to its roster; an abandoned goal is still listed.
- **`KillSwitchTests`** — `goals` off closes the surface for everybody but staff.
- **`ServesGoalTests`** — a task and a plan may serve a goal on their own node and say its title; a
  goal on another node is 400 `other_node`; the link survives the goal being abandoned.
- **`ReorderTests`** — the whole list of criterion ids or 400.
- **`GoalDiscussionTests`** — `goals/<id>` answers, writes and creates its row; a goal nobody may
  see has no thread; the `goals` flag closes the thread with the surface.
- **deletion** — a goal nobody relied on deletes (204); one a task serves is 409 `has_work`; one
  with a comment under it is 409 `has_comments`; a stranger gets `not_manager`.

### `frontend/e2e/goals.mjs` — 30 checks, zero page errors

```bash
cd frontend
E2E_BASE=http://localhost:5173 E2E_API=http://localhost:8000 \
  E2E_OWNER_TOKEN=<token of somebody who MANAGES the edmat organisation> \
  node e2e/goals.mjs
```

**`E2E_OWNER_TOKEN` is required and cannot be logged in for** — writing a goal is a node manager's
act and `can_manage_node` has no `is_staff` bypass (`e2e/CLAUDE.md` trap 32). Unset, the script says
so and every goal write is refused `not_manager`.

Through the API: the derived `met` in both directions, the 400 on a hand-written `met`, the 409 on
`met -> open`, the goal's thread and the **organisation description's** thread (`organizations/edmat`),
a section under an organisation page refused 400, an unknown slug 404. In the browser: the Goals
panel on `/about` with the goal, its conditions as checkboxes and a collapsed thread line; the
description's own collapsed line; `/goals/<id>`; and `/plans/<id>`, where clicking a step's **Edit**
opens a form captioned with that step's title — the bug of §17BZ.C, which drew nothing at all.

It cleans up after itself: the goal it writes is deleted at the end, which the server allows only
because nothing points at it and nobody commented under it. It posts **no** comment for exactly that
reason — the collapsed line is drawn whether or not the thread has anything in it, so the check does
not need one.

Screenshots: `e2e/screens/goals-1-about.png`, `goals-2-goal-page.png`, `goals-3-plan-step-edit.png`.


---

## Folded panels on an event and a course page (2026-10-08, `HISTORY.md` §17CB)

### `backend` — `venues.tests.RoomBookingTests`, 15 tests

Five of them new with §17CA, around withdrawing a room booking:

- **`test_platform_staff_may_withdraw_a_booking_they_do_not_organise`** — the owner's report. An
  `is_staff` operator is shown every booking by `get_queryset`'s admin bypass and was then refused
  when they acted on one; seeing a row and acting on it are the same permission now.
- **`test_a_withdrawal_records_who_made_it`** — `decided_by` was null here while `_decide` set it,
  which is the one fact that makes a withdrawal auditable now that two kinds of person can make one.
- **`test_withdrawing_does_not_make_platform_staff_an_organiser`** — the bypass is one withdrawal,
  not a promotion: `Event.can_organise` is untouched.
- **`test_a_stranger_still_cannot_withdraw`** — 404, not 403: the queryset never showed them the row.
- **`test_the_building_cannot_withdraw_a_booking_it_already_approved`** — **a left-open written down
  as a test.** A venue administrator may answer a REQUEST and nothing else, so a granted room can be
  handed back only by the organiser or an operator. Changing that is a new status and a migration;
  this test is what makes changing it deliberate rather than accidental.

### `frontend/e2e/folded-sections.mjs` — 12 checks, zero page errors

```bash
cd frontend
E2E_BASE=http://localhost:5173 E2E_API=http://127.0.0.1:8000/api node e2e/folded-sections.mjs
```

The event and the course it looks at are **resolved from the API**, not hard-coded:
`seed_conference_demo --reset` re-creates the demo with a new id every time. `E2E_EVENT` /
`E2E_COURSE` override them.

Per page: every panel draws folded with a count; every one is shut on a first visit (the script
clears `edmat-open-sections` first, so a previous run cannot make it pass vacuously); opening the
first one grows the page and moves `aria-expanded` to `true`; the choice survives a reload **in both
directions** — still open after one reload, still shut after shutting it and reloading again.

`openPage` retries once: a long chain of full reloads exhausts the Vite dev server and times out a
navigation that works perfectly on its own (`e2e/CLAUDE.md` trap 3), which it did here twice before
the retry went in.

Screenshots: `e2e/screens/folded-event-shut.png`, `folded-event-one-open.png`,
`folded-course-shut.png`, `folded-course-one-open.png` — the event one is the check that matters and
is meant to be looked at: the whole demo conference as eight labelled lines on one screen.

### The admin, by hand (§17CC)

Not a suite, and worth re-running whenever a model is added on a shard. It opened every registered
changelist as a superuser and is how `RequestLog`/`AuditEvent` were found to be broken from the
moment they were registered (they live on the log shards; the admin reads one database):

```python
from django.contrib import admin
from django.test import Client
from django.urls import reverse
# force_login a superuser, then for every model in admin.site._registry:
#   reverse(f'admin:{m._meta.app_label}_{m._meta.model_name}_changelist') and assert 200
```

**162 changelists, 0 failures** as of 2026-10-08. `manage.py check` validates `list_display`,
`list_filter` and `raw_id_fields` against the model but does **not** open the page, so it passed on
both broken ones.

---

## Attachments on anything (2026-10-09, `HISTORY.md` §17CD)

### `backend` — `attachments`, 31 tests

Refusals first, as this app's own file says at the top, because it replaced three narrower tables
and what has to be proven is that every rule each of them carried still holds.

- **`TierTests`** — a stranger sees only `public`; an attendee sees `members` and not `staff`; staff
  see `members` too, because the ladder is a ladder; a manager sees everything including `venue`; and
  **the file endpoint 404s for a tier you do not have**, which is the one that matters, since a
  `/media/` URL would have made every other check decorative.
- **`WriteTests`** — a stranger cannot attach; a member cannot attach to the node (an attachment on
  an event page is the event's own pile of files, and a participant has the comment thread); staff
  can; **only a manager may make a reading mandatory**, because that is an instruction to everybody
  else; the `venue` tier is refused on anything but an event; an unknown kind is 404 and not 500.
- **`FileKindTests`** — a `.md` upload becomes TEXT whatever the caller said `kind` was; a PNG is
  re-encoded to WebP; a PDF is stored as-is and reports honestly whether a scanner saw it;
  **`.doc`/`.xls`/`.ppt` are refused by name**; a zip renamed `.docx` is refused by its member list;
  a real `.docx` is accepted and served with `Content-Disposition: attachment` and `nosniff`;
  anything else is refused with a sentence listing what was wanted; non-UTF-8 text says so.
- **`LifecycleTests`** — a replacement is a new row and the old one keeps its acknowledgements
  (which is what makes "who had read the fire plan that morning" answerable); replacing twice is a
  409; a withdrawal is a state and the row survives; acknowledging superseded text is a 409 that
  points at the new row; acknowledging twice is idempotent; only a manager reads the receipts.
- **`RowAndCommentTests`** — a board row inherits the node behind it; a comment takes only `public`;
  nobody attaches to somebody else's comment.
- **`KillSwitchTests`** — 403 signed in, 401 as a guest, 200 for platform staff, and the event page
  it is mounted on keeps working with the flag off (house rule 3 cuts both ways).

### `frontend/e2e/attachments.mjs` — 14 checks, zero page errors

```bash
cd frontend
E2E_BASE=http://localhost:5173 E2E_API=http://127.0.0.1:8000/api \
  E2E_OWNER_TOKEN=<token of somebody who MANAGES the edmat organisation> node e2e/attachments.mjs
```

**`E2E_OWNER_TOKEN` is required and cannot be logged in for** — attaching is a node staff member's
act and `can_manage_node` has no `is_staff` bypass (`e2e/CLAUDE.md` trap 32). The script says so and
exits rather than failing fourteen checks for the rule working.

It attaches a `.md` and asserts it is **rendered with its maths typeset** rather than offered as a
download; attaches a PDF and asserts the row says whether a scanner saw it; then drives the two
warnings — that the second says something **different** from the first, that it names this file's
own name, type and size, that cancelling either downloads nothing, and that the download fires only
after the second. It withdraws both attachments at the end and asserts they are gone.

Screenshots: `e2e/screens/attachments-list.png`, `attachments-warn1.png`, `attachments-warn2.png`.

### `frontend/e2e/needs-content-management.mjs` — 26 checks, zero page errors

```bash
cd frontend
E2E_BASE=http://localhost:5173 E2E_API=http://127.0.0.1:8000/api \
  E2E_NEED=13 E2E_ORG=3 E2E_TASK=13 E2E_PLAN=24 E2E_POLL=8 \
  E2E_OWNER_TOKEN=<token of somebody who MANAGES the edmat organisation> \
  node e2e/needs-content-management.mjs
```

Content management on the board rows (`HISTORY.md` §17CG). `E2E_OWNER_TOKEN` is required for the
same reason as the script above (`e2e/CLAUDE.md` trap 32), and the assertions read **Polish** copy,
because `pl` is the base locale (trap 24).

The check that matters most is the **reload**: it edits a need's title, description and wanted count
in one submission through the real `⋯`, then reloads and asserts the title is still the new one.
Until 2026-10-10 a plain edit of a translated row wrote a column `translations.resolve` never reads,
so the save came back correct in its own response and changed nothing a reader would see — a test
that only re-read the row through the same request would have passed. It also asserts the English
translation was **left alone** and reported as older, that the description is rendered (KaTeX in it),
that a `.md` attached to the need becomes rendered text, that a goal card on a board draws a
**deferred** panel which fetches only on the click that opens it, and that the task, plan and poll
pages each carry one.

It writes its own goal (the dev database has none, and a check that passes on an empty board is
trap 8), and everything it touches is restored in a `catch`/cleanup rather than on the happy path —
two early runs threw at a locator and left the need holding scratch text, and the next run then
"restored" it to that.

Screenshots: `e2e/screens/needs-edit-form.png`, `needs-attachments.png`, `needs-goal-attachments.png`,
`needs-poll-attachments.png`.

### The absorb command

```bash
manage.py absorb_legacy_attachments            # say what would happen, change nothing
manage.py absorb_legacy_attachments --apply    # do it
manage.py absorb_legacy_attachments --verify   # check every legacy row has a counterpart
```

Exercised by hand on the dev database, 2026-10-09: 11 event documents and 30 acknowledgements
absorbed, `--verify` clean, and a second dry run reported 11 already done. **It shares the file path
rather than copying bytes**, so while both rows exist, deleting either takes the shared file with it
— which is why `--apply` does not delete the legacy rows and why `--verify` should be clean before
anybody does.

---

## Contests, step B: the preset as rows, and the nine registries (2026-10-09, `HISTORY.md` §17CE.B)

Two new backend modules beside the prep's own `contests/tests.py`, which that file's docstring asks
for by name. **`contests/test_personalize.py` (29 tests)** drives `personalize.apply_preset` as one
sentence per test: a `school` contest with every flag on gets the plan with its timeline and real due
dates, the goal whose criteria are the preset's and whose status is derived, one task per checklist
item assigned by role and carrying its citation, its verification marker and "this is not legal
advice", the needs and one draft poll; a second call creates nothing and says `already_personalised`;
each of the five flags off on its own leaves exactly its own word in `skipped` and everything else
created; a prize-free `challenge` has no prize task, no prize criterion and no prize step anywhere; a
stranger creates nothing, a jury member creates only tasks (`tasks.rules.can_create` admits any node
staff), an unknown preset is a word rather than a crash, and a contest with no dates gets its rows
with no due dates at all. A `PresetDataTests` class checks the table itself with no database behind
it — every checklist citation resolves in `LAW`, every `LAW` row has a known marker and a Polish
citation, no preset advances by chance, and every bilingual pair in the file has both halves.

**`contests/test_registries.py` (41 tests)** is the nine registries, each with the test its
neighbours have: a `TableTests` class reading the lines straight off `TARGET_TYPE_BY_MODEL`,
`REPORT_KIND_MODELS`, `GALLERY_TARGETS`, `TRANSLATABLE_KIND_MODELS`, `PLACEABLE_NODE_KINDS`,
`MANAGEMENT_KINDS`, `work.providers._REGISTRY` and `identity.record.PLACEMENT_PROVIDERS` — the
cheapest possible guard on a line somebody drops in a merge — and then one class per surface
asserting that **a stranger 404s on everything hung off a draft contest** and that the same thing
opens once it is announced. The activity class is the one worth reading: a draft never announces
itself, an announced-and-public contest announces itself exactly once and not again on every save,
announcing a PRIVATE contest writes nothing, `results_published` is its own second row, and
cancelling or pulling it back to private forgets both.

Run them with the apps they touch:

```bash
cd backend && ../.venv/bin/python3 manage.py test \
  contests community moderation galleries translations flashcards activity work identity \
  tasks needs plans decisions goals config --parallel 4 --keepdb
```

### `frontend/e2e/contests-personalise.mjs`

```bash
export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH
E2E_BASE=http://localhost:5272 E2E_API=http://127.0.0.1:8172/api \
  E2E_OWNER_TOKEN=<a token for the account that founds the contest> \
  node e2e/contests-personalise.mjs
```

**It founds its own contest through the ORM and that is not a shortcut.** On step B's branch there
is no `POST /api/contests/` — step A is building it at the same time — so the script shells out to
`manage.py shell` in the backend beside the checkout, creates one `Contest`, calls `apply_preset`
twice and reads the two reports back as JSON. That is also the honest exercise of the seam step A
will call, invoked the way `ContestViewSet.create` will invoke it. `E2E_OWNER_TOKEN` is required and
cannot be logged in for (`e2e/CLAUDE.md` trap 32): every panel it drives is a node MANAGER's, and the
script reads `/auth/me/` so the browser's account and the ORM setup's can never disagree.

It then drives `/contests/<id>` — the prep's placeholder, which mounts `ManagementPanels` — and
asserts the count on each of the five folded panel lines is the number `apply_preset` reported,
opens all five and screenshots them; reads the rows back through the real API in both languages;
checks `/about/contests` draws ten preset cards, six law rows and a marker on each, with exactly one
prize-free chip and exactly two staff-only ones; checks `/about` now lists eight showcase cards and
the manual's hub lists the contests chapter; and loads `/work` and a profile. **Two checks are
deliberately negative and say so in the script:** none of the four contest work sections is drawn,
because `contests/work.py` is step A's and answers `[]`, and `collect()` drops an empty section. It
deletes the contest and every row it hung off it at the end and re-queries to prove it.

Screenshots: `e2e/screens/contests-personalise-1-panels.png` through `-5-profile.png`. The `/work`
one is NOT `fullPage` and the profile one is not either: with seventeen tasks and ten plan steps on
it that page is six thousand pixels tall and a full-page capture crashed the Chromium tab outright.
Every capture goes through a `shot()` helper that turns a failed screenshot into a failed CHECK
rather than an exception, so one flaky capture cannot throw away fifty checks that already passed.

**53 checks, 0 failures** on 2026-10-09 (ports 8172/5272). If `/work` comes back "Loading your
work…" and then the renderer dies, restart the Vite dev server before believing it: three runs
failed exactly that way against a server that had survived a disk-full event, and a restart fixed
it with no code change (`e2e/CLAUDE.md` trap 3).

## Contests (`contests`, 2026-10-09, step A)

Three backend modules and one browser script. `backend/contests/tests.py` is the prep's seven
assertions (the draft-404 rule, the four roles, the node seam, the flag, the creation kind).
**`backend/contests/test_rules.py`** is every refusal word in `rules.py` with the refusals first and
the happy path last — the eight that block an announce (including `chance_element`, provoked both
with and without the Polish diacritic, in a stage description and in the merit criteria), the
transition table, the eight that block a registration, `not_advanced` from a previous stage, the
scoring refusals, the top-N cut-off taking everybody tied, `advance` being idempotent, ties sharing a
rank, titles meaning nothing when the maximum is zero, and `ContestResult` rows existing only between
publish and unpublish. Those classes reach no endpoint and so stay on plain `TestCase` **without**
the log-shard declaration, deliberately: leaving them bare is what keeps
`testing/check_databases_declared.py` meaningful. **`backend/contests/test_api.py`** is the
endpoints, with one base class making the log-shard declaration for the whole file — the creation
gate's three answers, a non-staff founder refused `kuratorium`, the kill switch closing the surface
for a non-staff caller and bypassing for a moderator, a stranger's 404 on a draft, a participant of
a private contest seeing it because they are in it, `/api/contests/undefined/` answering 404 rather
than 500, announce refused 409 and then accepted, a stage's problems 404 before it opens, the stage
payload carrying no answer and no solution pool, the separate and revocable `publish-name` consent
that the organiser cannot set for somebody else, the anonymised jury view, initials on the published
list, the complaints window, and `every law key the panel cites exists in presets.LAW` with a marker
the frontend has a label for.

```bash
cd backend && ../.venv/bin/python3 manage.py test contests config --keepdb --parallel 4
../.venv/bin/python3 manage.py seed_contest_demo && ../.venv/bin/python3 manage.py seed_contest_demo
```

**`frontend/e2e/contests.mjs`** drives the whole thing in a real browser, in the order a contest
happens: the hub (and that every card names its organiser above the fold), the four-screen wizard
with **a suggested person put on the jury** and the "via" line that says why they were suggested,
announce refused for the missing claim deadline *and the sentence the page shows instead of a code*,
a registration whose `publish_name` defaults false, the problems 404 before the stage opens, an
answer typed and handed in, the jury's anonymised matrix, published results showing initials, a
complaint lodged and answered with reasons, and the compliance panel with its verification markers
and its "not legal advice" line. It takes **three tokens, not logins** (`E2E_ORGANISER_TOKEN`,
`E2E_JUROR_TOKEN`, `E2E_ENTRANT_TOKEN`) because four sign-ins would burn the login throttle
(`e2e/CLAUDE.md` trap 30), needs `seed_contest_demo` to have run, and leaves the contest it founds
**cancelled** rather than deleted — a contest people have entered is never deleted, which is one of
the things it checks.

```bash
E2E_BASE=http://localhost:5271 E2E_API=http://127.0.0.1:8171/api \
  E2E_ORGANISER_TOKEN=… E2E_JUROR_TOKEN=… E2E_ENTRANT_TOKEN=… node e2e/contests.mjs
```

Screenshots: `e2e/screens/contests-hub.png`, `contests-wizard-1.png` … `contests-wizard-4-law.png`,
`contests-detail-draft.png`, `contests-stage-answer.png`, `contests-judge-matrix.png`,
`contests-results.png`, `contests-manage.png`, and `contests-certificate.png` when the single entry
places above `participant`.

## Contests, integration (2026-10-09, `HISTORY.md` §17CE preamble)

What the merge of steps A and B added on top of their two sections above: **twenty contest rows in
the permission matrix** (`backend/events/test_permission_matrix.py`, the block headed "contests
(17CE)") — a stranger 404s on a draft and on the seam's ref, a juror of the *other* contest is a
stranger to this one, a registered participant is a member and not staff (404 on the roster
endpoint, 403 `not_staff` on the registrations list), a juror cannot announce (403 `not_manager`),
the compliance panel is 403 `not_staff` to a non-staff reader of a public contest and 404 on a draft, and `results/` is an empty 200 before
publication rather than a refusal. The fixture is one announced public `challenge` with the reviewer
on the jury and the attendee registered, and one draft. Run them with the rest of the matrix:

```bash
cd backend && ../.venv/bin/python3 manage.py test events.test_permission_matrix contests --keepdb
```

Both contest browser scripts take their ports from `E2E_BASE` / `E2E_API` (defaults 5271/8171 and
5272/8172, the two steps' own worktrees); on the integrated tree run them against whatever ports
its servers are on. `e2e/contests-personalise.mjs` founds its contest through the ORM and so still
runs after the merge, now against the real `apply_preset`; `seed_contest_demo` on the integrated
tree is the quickest proof the two halves met — its report lists the plan, goal, tasks, needs and
poll it created.

## Mail — `no-reply@edmat.net` (`mail/`, 2026-10-14, `HISTORY.md` §17CI)

**Backend, `manage.py test mail` — 21 tests.** Under the test runner the transport is `locmem` and
delivery happens inside the commit hook (`EDMAT_MAIL_DELIVER_INLINE`), so a test wraps the request in
`captureOnCommitCallbacks(execute=True)` and reads `django.core.mail.outbox`. They pin: register →
one confirmation message → its link confirms; a tampered token → 400 `invalid`; confirmation lapses
when the address changes; resend → 409 once confirmed; an unknown and a known address get the SAME
reset answer; a reset link works once, refuses a weak password with the validator's reason, deletes
every API token and confirms the address; **the logged body of a reset/confirm holds `[[link]]` and
no token**; a failed send is recorded and retried by `drain()`; a row is claimed once; a row stuck in
`sending` is picked up; mail sent around the queue is logged as `direct`; the digest needs opt-in, a
confirmed address and an hour, and never mails the backlog; the Mail-tab endpoints answer 401/403/403/
200 for anonymous/user/staff/superuser; lists leave bodies out; retry only a failed row; fetch without
a password → 503 `not_configured`; the IMAP fetch (a fake server that asserts `readonly=True` and
`BODY.PEEK`) stores decoded headers, HTML reduced to text with the `<script>` gone, attachment names
only, and is incremental.

**Against the real mailbox** (not a test — a command): `manage.py mail_check` logs in to SMTP and IMAP
and sends nothing; `--send-to ADDRESS` sends one message. With the password in the environment for
one command (`EDMAT_MAIL_PASSWORD=… manage.py mail_check --send-to no-reply@edmat.net`, then
`manage.py mail_cron`) the message goes out through OVH and comes back over IMAP.

**Browser, `e2e/mail.mjs` — 23 checks.** Forgotten password from `/login` → neutral answer → the reset
link → a used link refused → old password dead, new one works; Settings → E-mail: a completed reset
left the address confirmed, the digest switch survives a reload; an unconfirmed address → "send the
link again" → `/confirm-email` → confirmed; a tampered link refused; the superuser's Mail tab: the
orange "not sending" status, rows, a reset body showing `[[link]]` and no token, "fetch" without a
password says why; a plain account sees neither the tab nor the panel at `?tab=mail`; zero page
errors. The links are read from the **backend's stdout** (the console transport prints them), so
`E2E_BACKEND_LOG` must name the file `run.sh`'s output went to. The script's header has the one-line
reset to run before every run (un-confirm the superuser, clear the throttles) and the two accounts it
needs on the dev database.

On a machine without Chromium's system libraries (no `libatk`, `libgbm`, …) and no sudo: `apt-get
download` the packages, `dpkg-deb -x` them into a directory and run with `LD_LIBRARY_PATH` pointing
at its `usr/lib/x86_64-linux-gnu` — how this script was run on 2026-10-14.

## Sign in with Google / Apple / GitHub / Facebook (and Microsoft) (`sso/`, 2026-10-14)

**`manage.py test sso` — 110 tests** (+ `accounts.test_password`, 8 — set a first password without a
current one, change needs it, wrong/missing current, validators, audit row), keys generated per run (RSA for id_tokens, EC P-256 for Apple's
client secret); only `sso/http.py` is mocked. State forged / expired / reused / for another provider,
cancel, provider error, the token request's redirect_uri + PKCE verifier; id_token nonce, audience,
issuer, expiry, issued-too-long-ago, foreign signing key, unknown `kid` (one refetch), `alg: none`,
HS256-with-the-public-key, multiple audiences without `azp`; signup ticket (browser key, single use,
expiry, terms, under-16, age question required while asked, username rules, email taken meanwhile),
`email_in_use` never adopts, login code (single use, wrong tab, expiry, hashed, inactive), link /
unlink (wrong account, already linked elsewhere, last way in, audit row), the identity key
(provider, issuer, subject — Google's two issuer spellings, Microsoft tenants, tid/oid), Microsoft
verified-email rules and tenant modes, Apple form_post + ES256 secret, GitHub (primary-verified
address only, `/user`'s email never read, HTTP-200 errors, numeric ids, PKCE, link) and Facebook
(GET exchange, appsecret_proof, always unverified, version pin guard), the flag off, unconfigured
providers, the dev-stub guard (incl. settings refusing to load with DEBUG off, in a subprocess),
purge, and the SSO-only password reset.

**Browser, `e2e/sso.mjs` — 40 checks, zero page errors**, against `e2e/sso-stub.mjs` (a local stand-in
on :8049: signs RS256 id_tokens, echoes the nonce, checks PKCE, form-POSTs for Apple, and serves
GitHub's `/user` + `/user/emails` and Facebook's GET token exchange + `/me`).
The buttons on /login and /register (and the identity-app drafts for Google/Apple gone), a first
Google sign-in → /auth/sso/complete (under-16 and missing-terms refusals, then success, landing on
`?next=`), Settings → Sign-in methods (last-way-in refusal, link Microsoft, unlink Google), Settings →
Password (set a first password, mismatch, wrong current password on change), GitHub and Facebook
signups (verified vs unverified address; Facebook all the way to an account), a second
sign-in as a plain login, Apple → `email_in_use`, cancel, and a forwarded done-link opened in another
browser → `code_invalid`. Run it against THROWAWAY data — it creates accounts. How it was run:

```bash
S=<scratch dir>; cp backend/db.sqlite3 $S/db.sqlite3; cp backend/logdata/*.sqlite3 $S/logdata/
# a settings shim: `from config.settings import *; DATABASES['default']['NAME'] = '$S/db.sqlite3'`
# migrate the copy and every log shard (--database logs_0 … logs_anon), then:
EDMAT_LOG_DIR=$S/logdata EDMAT_CACHE_DIR=$S/cache DJANGO_SETTINGS_MODULE=<shim> \
  DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5192 EDMAT_SITE_URL=http://localhost:5192 \
  EDMAT_SSO_DEV_STUB_URL=http://localhost:8049 \
  EDMAT_SSO_GOOGLE_CLIENT_ID=x EDMAT_SSO_GOOGLE_CLIENT_SECRET=x \
  EDMAT_SSO_MICROSOFT_CLIENT_ID=x EDMAT_SSO_MICROSOFT_CLIENT_SECRET=x \
  EDMAT_SSO_APPLE_CLIENT_ID=x EDMAT_SSO_APPLE_TEAM_ID=x EDMAT_SSO_APPLE_KEY_ID=x \
  EDMAT_SSO_APPLE_PRIVATE_KEY_PATH=<any EC P-256 .p8> \
  EDMAT_SSO_GITHUB_CLIENT_ID=x EDMAT_SSO_GITHUB_CLIENT_SECRET=x \
  EDMAT_SSO_FACEBOOK_CLIENT_ID=1 EDMAT_SSO_FACEBOOK_CLIENT_SECRET=x ../.venv/bin/python3 manage.py runserver 8042
node e2e/sso-stub.mjs
PUBLIC_API_BASE_URL=http://localhost:8042/api npx vite dev --port 5192   # env beats frontend/.env
CHROME=… E2E_BASE=http://localhost:5192 node e2e/sso.mjs
```

A private `EDMAT_CACHE_DIR` matters: the signup is throttled as `register` (10/hour) in the shared
file cache, and a third run in an hour otherwise fails at "Create account" with a 429 (trap 1).

## Account deletion and data export (`accounts/erasure.py`, 2026-10-14)

**`manage.py test accounts.test_erasure` — 51 tests**: registry completeness (every FK to a person or
to `Profile` has a rule; every rule names a real field; no duplicates; the log-shard id columns are
listed), asking (plan readable first, wrong password / username / password-less / minor refused with
their reasons, switch-off revokes the token and withholds the profile, the cancel mail goes to a
confirmed address only and its log row keeps `[[link]]`, 409 on a second request, a course with
participants and a sole-owner organisation block), the grace period (login 403 `erasure_pending`, a
wrong password learns nothing, cancel by password signs back in, the mailed token cancels once,
nothing erased early, no cancel after the claim, `--now` needs `--user`), the erasure (tombstone,
contributions stay, private rows deleted, the other party keeps the conversation, a future booking
cancelled with a notification, a listing switched off, an enrolment ends as `left`, the audit log
pseudonymised, mail to the address forgotten, idempotence, a half-finished run completed, a child's
comments tombstoned), the guardian path (grace, the child cannot undo it, reactivating cancels,
sole-guardian children erased with the guardian, a second guardian keeps the child), the export
(messages decrypted, the other party by display name only, no secrets, own request-log rows, a minor
may download, 3/day → 429), retention (old rows go, recent stay, queued mail kept) and the
"EdMat only" choice (owner, 2026-10-14: counts per answer in the plan, no default answer —
`choice_required` / `choice_invalid`, `keep` leaves everything published, `remove` hides `edmat-only`
and `unknown` items while CC and co-authored ones stay, a guardian's delete removes, a minor is refused
server-side with `guardian_managed`).

**`frontend/e2e/account-erasure.mjs` — 28 checks, zero page errors** (both answers to the "EdMat
only" question — a third throwaway account takes "remove" — and a child's view of the page). DESTRUCTIVE: run it against a
copy of the database.** Copy `backend/db.sqlite3` and `backend/logdata/*.sqlite3` into a scratch
directory (sqlite `.backup`), write a settings module there containing
`from config.settings import *` and `DATABASES['default']['NAME'] = '<copy>'`, migrate it, and start
the backend with `PYTHONPATH=<dir> DJANGO_SETTINGS_MODULE=<module> EDMAT_LOG_DIR=<copy>/logdata
EDMAT_CACHE_DIR=<copy>/cache`. Pass the same prefix up to and including `manage.py` as `E2E_MANAGE`
(required): it attributes two published exercises to each erased account and runs
`erase_due_accounts --now --user <id>`. Three throwaway accounts and one child per run; screenshots
`account-erasure-{desktop,390,choice,scheduled,login-390,comment,minor-390}.png`.
`e2e/guardian-accounts.mjs` was updated the same day: the child's username is unique per run (a
deleted child keeps its username for 14 days) and step 5 asserts the pending state.


## The in-place exercise edit, the AI-assisted mark on `verified`, the bulk relicence (2026-10-21)

**`manage.py test exercises.test_editing` — 5 tests.** A stranger's PATCH is 403
`exercise_not_editor` and changes nothing (the write hole this closed), anonymous 401, PUT and
DELETE 405; the author edits text and structure in one PATCH and each text change is an approved
`EditSuggestion` row (an unchanged field records nothing); staff edit; `can_edit` on the detail per
caller; a topic of another branch and a bad difficulty refused.
**`manage.py test provenance` — 30 tests** (+2): a verified contributor's pinned solution makes
the exercise verified until the author's AI-assisted mark lands, a reviewer's accept gives it back,
deleting the mark gives it back; `declare_ai_assisted` dry-run marks nothing, the real run marks the
statement, the hint and the solution with the note and the author as `declared_by`, and a second
run says "already marked".
**`manage.py test licensing` — 35 tests** (+3): `relicense_content` dry run reports and changes
nothing; the real run moves `unknown` and the caller's own `edmat-only`, refuses another person's
`edmat-only` by id, leaves CC BY alone, carries the note on every row, and a second run moves
nothing; `--to unknown`, `--to edmat-only`, a missing note and a non-staff caller are refused.

**Browser, `e2e/exercise-edit.mjs` — 20 checks, zero page errors.** `E2E_EXERCISE` names an
exercise the `E2E_TOKEN` account wrote (the run that wrote this made one through the ORM). The
author sees Edit and no "Suggest an edit", the form is prefilled, a title/difficulty/tag edit lands
and the page comes back with "Saved."; the title change is an approved row in the history;
`/submit/mine` offers Edit on the approved row; a stranger sees "Suggest an edit", gets 403 from
PATCH and a refusal sentence at the edit address with no form; staff see Edit and the staff lead;
PUT and DELETE are 405; cleanup restores the exercise through the same PATCH. Screenshots under
`e2e/screens/exercise-edit/`. Note: the script needs the dev server to have been restarted after
the catalogue keys were added — a running Vite served the stale `_index.js` and the page threw
`m.exercise_edit is not a function`.

## Per-item content licences (`licensing/`, 2026-10-14)

**`manage.py test licensing` — 31 tests.** The registry (what a person may pick, `unknown` never;
the "at least as open" partial order — BY-NC and BY-SA incomparable; the derivative rule; the
`?licence=` parser); the data migrations' classification run against rows made the way real rows
were made (a corpus row a seed credited to a demo account stays `unknown` — only a kept
`ExerciseSubmission` makes an exercise `edmat-only`; a material file under `materials/` is
`unknown`); `/submit` carrying the licence onto the exercise, its translation and its founding
solution, `unknown` and stray keys refused, a hand-edited payload unable to publish `unknown`; a
translation keeping the licence it was written under when its exercise widens; the
`/api/licences/<kind>/<id>/` endpoint (widen + history + since, narrowing refused with
`licence_narrowing`, stranger 403, staff `unknown` marker needing a note, 404 for an unpublished
item, a material with a co-author's version refused); the importer's `licence:` key, `--licence`,
default `unknown`, a re-run that widens and records but never narrows; the solution, concept-article
and material-project create paths; the exercise list filter.

`coauthoring.test_submit_path.FoldMigrationTests` now reads its assertions through the HISTORICAL
models of whatever is applied (`_applied_apps`): it stops the schema at the 0003 fold, and the
licence column (`coauthoring 0004`) made its current-class queries select a column that was not
there yet.

**Browser, `e2e/licences.mjs` — 27 checks, zero page errors.** A corpus exercise and a corpus
material say "rights not yet clarified" (EN and the Polish default); `/submit` offers six licences,
never `unknown`, defaulting to "EdMat only"; a submission choosing CC BY-SA 4.0 carries it, the
moderation queue shows it, the approved page shows "© author · Licensed under CC BY-SA 4.0 since …"
linked to the deed; the author widens it to CC BY 4.0 from the page (only wider licences offered, no
stale "this translation" note afterwards), the API refuses a narrowing, the history has the row, a
signed-out reader sees no change control; the solution composer carries the folded picker; the
exercise page and `/submit` do not scroll sideways at 390 px. Needs `u-ola` and `u-kasia`
(password123). It leaves an approved `e2e-licence-…` exercise behind each run (house rule 12).

```bash
E2E_BASE=http://localhost:5195 E2E_API=http://127.0.0.1:8045/api \
  CHROME=~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell \
  LD_LIBRARY_PATH=<extracted libs>/usr/lib/x86_64-linux-gnu node e2e/licences.mjs
```

## Empty states that offer a next step (`ux/empty-states`, 2026-10-14)

### `frontend/e2e/empty-states.mjs` — 273 checks, zero page errors

`lib/components/shared/EmptyState.svelte` on thirteen hubs, in **both** interface languages (English
through `english.mjs`, Polish as the default). It registers ONE throwaway account and erases it at
the end through `POST /api/auth/me/erasure/`. Set `E2E_KEEP=1` to keep it, then re-run with the
`E2E_EMPTY_USER` / `E2E_EMPTY_TOKEN` it prints, so that a re-run does not spend the register throttle.

- **Honestly empty, as the fresh account:** my set, my tasks, notifications, the inbox and Sent,
  decks, the events "hosting" and "attending" views, the three personal contest tabs, "my"
  organisations, "my" tutoring listings, and the followed activity view. Each one draws its OWN
  sentence, which is compared with the catalogue for that language, so a key missing from one file
  fails here.
- **The creation gate, both ways:** where the next step is founding something, the button appears
  exactly when `GET /api/creation/` allows it. A fresh account is unverified, and
  `creation_requires_verification` is on, so the button is absent. With `E2E_ALLOWED_TOKEN` (kasia's,
  read as trap 30 describes), the contests hub shows "Announce a contest" leading to `/contests/new`.
  Signed out, the action becomes a sign-in link.
- **A filter that matches nothing** on concepts, needs, volunteering, contests, organisations and
  activity says "Nothing matches these filters" and offers "Clear filters", never a create button.
  Clearing really clears the URL or the inputs.
- **The in-page actions work:** events → "See what is coming up", and activity → "Show everything".
- **Every link resolves:** every link the empty states drew, plus every slug the component's
  `EmptyStateGuide` type allows, is opened, and must reach a real heading. A guide link must not land
  on the chapter page's "no chapter under that address" line.
- At 390 px there must be no horizontal scroll, and screenshots are written to
  `e2e/screenshots/empty-*.png` (light, dark and 390). Look at them.

`/contests` loads twice (once as a visitor, then again when the session resolves), so for a moment
the empty state is swapped for "Loading…". `expectState` waits for the state to hold across ~1 s
before reading it; without that, two runs each lost a different `/contests` check.

```bash
E2E_BASE=http://localhost:5198 E2E_API=http://127.0.0.1:8048 E2E_ALLOWED_TOKEN=<kasia's token> \
  CHROME=<chrome-headless-shell> node e2e/empty-states.mjs
```

## Where to start, the manual in the footer, three small fixes (`ux/wp2-start-here`, 2026-10-14)

### `frontend/e2e/home-start.mjs` — 57 checks, zero page errors

`lib/components/home/StartHere.svelte` under the homepage hero, the footer's "Manual" link, and three
fixes the empty-states pass found — in **both** interface languages (English through `english.mjs`,
Polish as the default). It writes nothing to the backend.

- **The band is in the HTML:** `GET /` (the dev server's SSR, which is what the prerender produces)
  carries `data-start-here` and all three doors. Its distance to the tab strip is measured at first
  paint (`waitUntil: 'commit'`) and after hydration and must not change, and the first row of
  exercises must still start above the fold at 1280×800.
- **The doors land:** "guide" on `/about/guide/start` (not the "no chapter under that address"
  line), "showcase" on `/about`, "try" on `/disciplines`, each by a real click in a fresh tab — one
  tab for the whole chain crashed Chromium on `/about`'s weight (trap 3).
- **Dismissal:** "×" removes it and writes `edmat.startHere.hidden=1`, a reload keeps it gone,
  removing the key brings it back.
- **The footer** says "Manual" / "Podręcznik" and opens `/about/guide`.
- **Fix (a):** signed out, `/contests` has no "New contest" in its header. With `E2E_TOKEN` (kasia's,
  read as trap 30 describes) it is drawn exactly when `GET /api/creation/` allows a contest.
- **Fix (b):** `/concepts` at 390 px — the Tag select, whose longest option in the dev database is
  44 characters, ends inside the window, and the page has no horizontal scroll.
- **Fix (c):** `/my-set` with three ids in the guest set and `/api/exercises/bulk/` held back
  1.5 s by `page.route`: a `MutationObserver` installed before the first byte records whether the
  empty state was EVER drawn (it must not be), the skeleton is, and then exactly three items. A fresh
  context with no set still draws the empty state and no skeleton.
- Screenshots at 1280 and 390, light and dark, in `e2e/screenshots/home-start-*.png`. Look at them.

```bash
E2E_BASE=http://localhost:5201 E2E_API=http://127.0.0.1:8051 E2E_TOKEN=<kasia's token> \
  CHROME=<chrome-headless-shell> node e2e/home-start.mjs
```

**Sub-exercises, step A (§17CV.A, 2026-10-21).** `exercises/test_parts.py` (21) pins the parts rules:
the read shape and the entry POST (from the prep), the derived `verified` for a set (whole solved /
every part solved / one part short, a part added or deleted recounts, AI-assisted only once reviewed),
`PATCH /api/exercises/{id}/` `parts` (every refusal word — `part_not_of_exercise`,
`part_label_duplicate`, `part_id_duplicate`, `parts_too_many` — with nothing written; create, update,
reorder, delete-with-entries, `[]`, the approved `EditSuggestion` records, sanitizing, verified
following the edit), an entry's `part` refused on PATCH (`part_immutable`) with the pool's visibility
and order unchanged, and the admin pages opening. `moderation/test_part_suggestions.py` (7): a part
edit suggestion's refusals (`part_and_entry`, `part_not_of_exercise`, `part_field_invalid`, an unknown
locale), the queue showing `part_label`, and approval writing — or creating from the fallback — the
part's row. `licensing/test_parts.py` (2): the licence endpoint and `relicense_content` over exercises
with parts. Run: `manage.py test exercises moderation licensing --parallel 4 --keepdb` (343, OK).

**`exercises/test_import_parts.py` — the importer's part sections (28 tests, §17CV.B; the 28th, from the integration, is the `MAX_PARTS` cap shared with the edit form).** Plain
`TestCase`s (no endpoint, so no log shards). The parser: labels kept as written, `Podpunkt`/`Part`
in any case, and every refusal by its sentence — no label, a label over 20, a duplicate label, a part
with no or an empty `## Treść`, a section named twice (the whole-exercise-section-after-the-parts
case), text straight under a part heading, unbalanced maths in a part, the shared statement still
required. The apply: create with pinned entries carrying `part`; an unchanged re-run prints `parts: 0
created, 0 updated, 0 removed.` and does not re-save an entry (`updated_at` unchanged); an edit
updates in place; a part beyond the file's count goes with its entries; the whole exercise's solution
coexists with the parts' (the pinned key has `part` — removing it fails this test); `--dry-run` writes
nothing, also when it would remove; a file without parts leaves parts alone; splitting a
one-solution file removes the old whole entries but not one somebody else pinned, nor one with a
comment or a vote; `--licence` moves part entries; and the worked example in
`.claude/skills/import-exercises/reference/format.md` is extracted and imported, so the doc cannot rot.
`../.venv/bin/python3 manage.py test exercises.test_import_parts --keepdb` (~3 s with a kept DB).

**`concepts/test_import.py` — `manage.py import_concepts` (§17CW, 2026-10-21).** Create (concept,
the author's article, a published revision, blocks split at `###`, the file's slug kept), links in a
second pass whatever the file order, a prerequisite also mentioned as `[[slug]]` kept as a manual
prerequisite, an exercise link; nothing in the feed or notifications; `batch.yaml` defaults incl.
`branch:`; an unchanged re-run writes nothing; a changed file is revision 2 on the same article;
tags added, branches replaced, links never removed; somebody else's article and concept untouched; a
community head, an open draft and a removed article each skipped with its reason; the licence
default/flag/file chain, widen-and-record, never narrow; every refusal by its sentence (and one bad
file imports nothing); `--skip-missing-exercises`; `--dry-run` (also with `--ai-assisted`) leaves
nothing; `--ai-assisted` and `declare_ai_assisted --kinds concept_article`; the provenance summary
answers for a published article and not for a waiting one; `dump_text_fields` carries concept heads.
`../.venv/bin/python3 manage.py test concepts.test_import`.

**`frontend/e2e/exercise-parts.mjs` — sub-exercises, the page and the editor (`parts/c-page`, 2026-10-21, 53 checks).**
Seeds a three-part exercise owned by u-michal through `manage.py shell` on the checkout's own
database (whole-exercise hint, a hint for (a), a solution for (c), a pending hint for (c) by ola),
reads the three tokens from the same shell, and deletes the exercise at the end. A stranger: three
`[data-part]` blocks in order with their labels, "for the whole exercise" on the whole stages, whole
hints before the parts and the whole answer after, (b)'s answer revealing alone, each part's hints
its own. michal: "For:" pre-set to (b) in (b)'s composer, the REAL entry POST carrying `part`, the
hint under (b) only. ola: "Part b — statement" in Suggest an edit. michal's Parts editor: add a
fourth part, reorder, remove one (Undo; the in-page confirm with entry counts), the PATCH payload
`[{id?, label, statement, answer}]` in order, a refusal said as a sentence. kasia: an ordinary
exercise's PATCH carries no `parts`; the moderation queue says "for part a". **Every request is
real since the integration (§17CV):** the PATCH, the suggestion POST and staff's PATCH are captured
with `waitForResponse` registered before the click (matched on the pathname — the PATCH carries
`?lang=`), their status asserted, and the script reads back through the API what the backend holds
(parts `b1,a2,d3` with kept ids, (c)'s entries gone by cascade, the set unverified, the suggestion
pending). Staff's edit is on a second seeded exercise, never a corpus row. **65 checks**, ~2 min.
Screenshots in `e2e/screens/exercise-parts/`.

```bash
E2E_BASE=http://localhost:5173 E2E_API=http://127.0.0.1:8000/api \
  LD_LIBRARY_PATH=… CHROME=<chrome-headless-shell> node e2e/exercise-parts.mjs
```

## Licences in bulk — `/settings/licences` (2026-10-22, `HISTORY.md` §17CX)

### `licensing/test_bulk.py` — 12 tests

The list is the caller's own POSTED items only (a draft and a stranger's exercise absent; a solution
on somebody else's exercise present), BY-NC offers only BY and CC0, a co-authored material offers
nothing and says `licence_other_contributors`; the bound sets `truncated`. The POST moves what the
rules allow and refuses narrowing and a co-author's work with their reasons (a duplicate counts once,
a `LicenceChange` row each, the exercise's own-language text follows); a second run is
`licence_unchanged`; a stranger's id, a draft and a missing id are all `licence_not_found` with no
licence in the answer; staff get no extra reach; `unknown` and `edmat-only` as targets are refused;
seven malformed shapes are 400 and change nothing; 501 items is 400 whole; the POST throttle is its
own scope and reading the list does not spend it. `manage.py test licensing --parallel 4 --keepdb`:
50 tests, OK (2026-10-22).

### `frontend/e2e/licence-bulk.mjs` — 21 checks

WRITES — run it against a COPY of the dev database. Registers one throwaway account, attributes three
unattributed published exercises (two EdMat-only, one BY-NC) and a new co-authored material to it
through `E2E_MANAGE`, then: Settings → the page; three exercises and one blocked material with its
reason; the licence filter; select-all; "Can move to it: 2 of 3" for BY-SA, "3 of 3" for BY; the
confirm step's irrevocability line and forecast; the result (2 changed, the BY-NC one kept with the
narrowing sentence); the API agrees and the item's own history shows the change; dark theme; a 390px
phone with no horizontal scroll; the Polish default; anonymous 401; zero console errors.
Screenshots in `e2e/screenshots/licence-bulk-*.png` (list/confirm/results light, list/confirm dark,
phone, pl).

```bash
E2E_BASE=http://localhost:5251 E2E_API=http://127.0.0.1:8151 \
  E2E_MANAGE='cd ../backend && ../../../../.venv/bin/python3 manage.py' \
  LD_LIBRARY_PATH=… CHROME=<chrome-headless-shell> node e2e/licence-bulk.mjs
```

## A person's bulk upload of exercise files (`exercises/bulk.py`, 2026-10-22, `HISTORY.md` §17CX.U)

**`backend/exercises/test_bulk.py`.** The preview (writes nothing; says `queue` or `publish`), both
switches closing it for a person and not for staff, every refusal word (`licence_not_selectable`,
`published_false`, `topic_not_in_branch`, `format`, `not_markdown`, `not_utf8`), an unknown or
unapproved branch, oversize / too many files / a 413 body, a traversal filename shown as its basename,
`!!python` tags and an alias bomb refused, a mapping where a value belongs, `number:` ignored and
never overwriting the exercise it names, `<script>`/`onerror` reported AND cut from the queued
payload with the maths intact; the commit (one submission per file, one batch id, nothing written
when one file is refused, a verified contributor's parts/licence/tags/AI mark, the AI mark keeping
`verified` off, a minor minting no tag, the commit throttle); the moderator's batch approve (pinned
part entries, idempotent second call, a governor of another branch skipped, a stranger 403, an
unknown batch 404); and `/submit`'s serializer holding a hand-built draft's `parts`/`ai_assisted`
to the same shape and stripping `bulk`.
`../.venv/bin/python3 manage.py test exercises.test_bulk`.

**`frontend/e2e/bulk-upload.mjs` — 31 checks, ~1.5 min.** Three tokens (an unverified account, a
verified contributor, staff), a discipline/branch/topic from the env. Unverified: the link on
`/submit`, one good and one refused file (unknown licence, a missing topic, an unknown heading,
`<script>`) said as sentences, the send button off until a clean check and off again when the files
change, "Sent 1 … to the moderation queue" and a pending submission with an `upload_batch` read
back; the refused report in the dark theme. Verified: two files, one with two parts, the AI box →
"Published 2", the exercise page opened from the result, two parts, unverified, `author_marked`.
Staff: a batch queued through the API, "Approve all 2 from this upload" on the queue, both approved.
The kill switch as the unverified account: no link on `/submit`, no Add… entry, no form, 403. Turns
`exercise_bulk_upload` back on in a `finally`. Screenshots in `e2e/screens/bulk-upload/`.

```bash
E2E_BASE=http://localhost:5173 E2E_API=http://127.0.0.1:8000/api E2E_PLAIN_TOKEN=… \
  E2E_VERIFIED_TOKEN=… E2E_STAFF_TOKEN=… E2E_DISCIPLINE=matematyka E2E_BRANCH=analiza-matematyczna \
  E2E_TOPIC=szeregi LD_LIBRARY_PATH=… CHROME=<chrome-headless-shell> node e2e/bulk-upload.mjs
```

`e2e/add-menu.mjs`'s expected content group now carries `/submit/bulk` after `/submit`.
### `licensing/test_default_licence.py` — 5 tests

`Profile.default_licence` round-trips through `/api/auth/me/` and blank clears it; `unknown` and a
made-up key are 400 with `licence_not_selectable` / `licence_unknown_key` and change nothing;
anonymous GET and PATCH are 401; a stranger's public profile does not carry it;
`rules.default_licence_for` resolves anonymous, blank and a stale `unknown` to `edmat-only`.

### `frontend/e2e/licence-default.mjs` — 22 checks

Changes one throwaway account's profile only. No default → `/submit` suggests CC BY; set CC BY-SA on
`/settings/licences` (saved, API agrees) → `/submit` prefilled, says so, tags "Your default", one
click changes it, a fresh form starts at the default again; naming a source moves it to EdMat only and
says the default is not applied, clearing the source brings it back; the hint composer on an exercise
page starts with it (dark mode); clearing the default restores the form's own suggestion; `unknown`
refused; anonymous 401; zero console errors. Screenshots `e2e/screenshots/licence-default-*.png`.

```bash
E2E_BASE=http://localhost:5251 E2E_API=http://127.0.0.1:8151 \
  LD_LIBRARY_PATH=… CHROME=<chrome-headless-shell> node e2e/licence-default.mjs
```

