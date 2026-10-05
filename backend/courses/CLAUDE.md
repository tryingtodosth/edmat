# courses — user-run courses (the largest app; formerly named `classroom`)

A *kurs*: something a person runs over time and others join. **Not** `taxonomy.Branch` (a
university subject — that used to be called `Course`, and the root CLAUDE.md still says
"classroom"/"TaughtCourse" throughout). `/api/courses/` is THIS app.

Models: `Course`, `Lesson`, `Enrollment`, `CourseStaff`, `Chapter`, `CourseItem`,
`CourseInvite`, `CourseNote`, `Attachment` (+ `AttachmentReview`), `LessonReview`,
`ChapterReview`, `LessonExerciseSet` + `LessonSetExercise`, `LessonProgress`,
`CourseCompletion`.
Also `attachmentfile.py` (upload validation), `search.py` (in-course search with snippets),
`reports.py` (course-scoped reporting), `rules.py` (school mode + the certificate's refusals),
`record.py` (the per-Branch learning-record hook).

## Invariants

- `status` is one field (`draft → open → running → finished`), never booleans. **A draft is
  invisible to everyone but its instructor via queryset filtering** — absent from every listing
  for free; strangers get 404.
- **The owner `CourseStaff` row is real data created in `Course.save()`**, not in
  `perform_create` (that placement broke 16 tests — seed commands, fixtures and the admin create
  courses too, and every one would otherwise make a course nobody had permission over). A
  partial unique index enforces one owner per course. The owner can never be demoted/removed
  through the API (hostage-proofing). Roles: `assistant` curates content/participants; `admin`
  also edits the course + staff; `owner` additionally deletes. Use
  `can_administer`/`can_curate`/`is_staff_member` — never raw `instructor_id ==` checks.
- Promoting a participant to staff retires their enrolment (nobody counts twice against
  capacity). Capacity is enforced on BOTH the join path and the approve path; lowering it below
  current headcount is refused. `enrollment_block_reason()` returns *why* (six distinct
  sentences client-side) — keep refusals reasoned, not boolean.
- `Enrollment.status` five values; the three endings differ on purpose: **left** may re-join,
  **removed** may not, **declined** is a decision. One row per person per course, reused.
- `CourseItem` = one model for staff filing AND participant contributions (differ only in
  starting `status`; splitting would lose who submitted). `contribution_policy` defaults
  `approval` (the only value safe to pick on someone's behalf). Content is **referenced, never
  copied**. Pending items visible to staff + own submitter only; EVERY staff member notified
  (a one-person queue stalls). Two partial unique constraints (NULLs don't compare equal in SQL).
- **Five item kinds**, exactly one FK set per row: `material`, `exercise`, `attachment`, `event`,
  `discussion`. The last points at a `community.Comment` and needs two rules the others don't —
  it must be a **root** comment (a reply is half a conversation), and a thread private to ANOTHER
  course is refused (`community.targets.PRIVATE_TARGET_TYPES`), on exactly the reasoning that
  already refuses another course's attachment. `target_is_available_to` drops a linked thread once
  its opening post is removed/auto-hidden — for participants, not for curators, who are the people
  who can replace it. The response carries `discussion_target_type`/`_id`, because a comment has no
  page of its own and only the server can say which page it hangs off.
- `LessonExerciseSet` files into a lesson **or a chapter** (exactly-one check constraint), same
  reasoning as `CourseItem`: a set everybody does before week 3 belongs to the week. One pair of
  endpoints for both — `/{lessons|chapters}/{id}/exercise-sets/`. Its reorder group ids are
  therefore **prefixed** (`chapter:7`/`lesson:7`); a bare id still means a lesson, so payloads
  written before chapters were possible keep their meaning. The model keeps its `Lesson`-shaped
  name deliberately — renaming would rewrite six files to say what the docstring says better.
- `Chapter` holds the time gate (`unlocks_at`; NULL = never gated ≠ a passed date). A locked
  chapter still renders title/description/date — its contents don't. Deleting a chapter keeps
  content unfiled (`CourseItem.chapter` is SET_NULL). Known accepted gap: chapter locking
  doesn't reach a material also attached to a lesson.
- `CourseInvite`: addressed by bare token (`/api/course-invites/<token>/` — the holder has
  nothing else), bypasses the approval queue but **never capacity** (use count incremented under
  `select_for_update` — note: fine here since it's production-Postgres-intended and a single
  fast row; don't copy the pattern into multi-statement flows on SQLite). Revoke = timestamp,
  not delete. `owner` is deliberately not an invite role. Preview readable logged-out, thin,
  `noindex`.
- Lessons: title/description public; `participant_notes` **blanked, not omitted** for
  non-participants (stable response shape) — and a *pending* request unlocks nothing.
- Discussion reuses `community.Comment`. `discussion_mode` off/participants/public governs
  **reading**; posting is always participants-only. Default participants (the roster is private).
- Notifications: six distinct types via `notify_course_participants`, three mute layers (course
  `announce_*` settings → per-enrollment `notify` → account category). Joining an open course
  notifies nobody; pending requesters are never told about course internals.
- Behind the `courses` FeatureFlag (seeded on; reads gated; staff bypass).
- **Covers/requires claims** (`CourseClaim` + `CourseClaimVote` + `CourseClaimImportanceVote`,
  migration 0018): the same claims a material carries, inheriting `materials.ClaimBase`; the
  request handling (topic/subtopic resolution, duplicate 409, both vote upserts, the thread with
  its same-thread `parent` check) is shared in `materials/claims.py`. `GET|POST
  /courses/{id}/claims/` on the course viewset (its visibility queryset + gate), per-claim
  `/course-claims/{id}/vote|importance|comments/` scoped to `_visible_courses` (404 otherwise).
  A claim's topic must belong to one of the course's `subjects` branches. `community.targets`
  maps it to `courseClaim`. Frontend: `components/course/CourseClaims.svelte` reuses the
  material badge/popover/form unchanged — a claim's `ownerKind` picks the endpoint.

## School mode — a class is a course a school runs (learning step C, 2026-10-05)

`rules.py` is the whole of it. **There is no `SchoolClass` model and no `Course.is_class` column**:
an organisation of kind `school` with a `runs` link to a course makes that course a class
(`00-DESIGN.md` §1 rule 1 — a link between two surfaces goes through a hub, and
`organizations.Organization` is the hub that answers *who runs this*). Read-only use of
`organizations`; nothing here writes a link.

- **Two widenings, both about STAFF**, both `can_curate` (an assistant marks the register):
  `staff_sees_all_progress` and `staff_sees_guardians`. A participant's own view is identical in a
  class and out of one, and neither widening lets staff *write* a `LessonProgress` row — that is
  still the participant speaking about themselves.
- **They are one decision but deliberately not one rule.** `staff_sees_guardians` does not call
  `staff_sees_all_progress`: a guardian is who a teacher writes to about a child, which has nothing
  to do with whether the course keeps a tracker. The first draft coupled them and a class with
  tracking off lost its guardian column for no reason anybody could explain.
- **`progress_visibility='off'` is NOT widened.** The other three modes are narrowings; `off` is the
  course saying there is no tracker, and its own comment in `models.py` says it "blinds staff too".
  A school override would make that untrue, for children, after the fact. A class that wants the
  register turns tracking on — one visible setting.
- **The `organizations` kill switch does not reach school mode.** It takes the directory, the panel
  and the "run by" line (links and pages, house rule 3). Turning it off must not un-school a class
  mid-term and change what a teacher is shown about a child. Pinned by a test.
- `schools_running_courses()` is the bulk form, one query for the whole map, cached on the serializer
  context so a course directory pays it once. Honest limit: the map is loaded whole.
- `EnrollmentSerializer` answers `guardians: []` / `is_minor: false` to everybody the view does not
  put `guardian_map` in the context for. **Both fields always present** — `[]` with `is_minor: true`
  is the real and important state of a child with nobody on file.

## `CourseCompletion` — the certificate (migration 0020)

`(course, participant)` unique, `revoked_at` rather than a delete (house rule 12), `issued_by`
SET_NULL so a teacher deleting their account does not take away certificates other people hold.

- **Issued by hand, never derived.** `completion_block_reason` checks "every lesson done" at issue
  time from `LessonProgress` and `completion_note` freezes the count into `note` ("12 of 12 lessons,
  by the participant's own statements"), so the document carries its own basis and a thirteenth week
  added next term does not make an issued certificate a lie.
- **No grade, no mark, no rank.** There is no field for one and a test asserts there is none.
- A course with **no lessons** answers `not_done`: "0 of 0" is vacuously complete.
- `already_issued` counts a **revoked** row — re-issuing is `revoke`'s inverse and is not built.
- Refusal → status: `not_staff` **404** (this app's convention for a staff action), `not_participant`
  **400**, `not_done` / `already_issued` / `already_revoked` **409**. The map is
  `views._COMPLETION_REFUSAL_STATUS`; `frontend/src/lib/utils/labels.ts` has a sentence for each and
  names `rules.py` back (house rule 13).
- `CourseCompletionViewSet.get_queryset` admits the caller's **own** certificates and the ones they
  **issued** as well as those on courses they can see. Without that, a pupil who leaves a private
  class — which is what a school runs — lost their own certificate the moment their enrolment ended.
  Found by a test, not by reading.
- The printable sheet is `frontend/src/routes/courses/[id]/certificate/[completionId]/`: bilingual on
  one page, unsigned and saying so, printed by the browser. The `shifts` certificate's posture.

## `record.py` — the learning-record hook

`activity_by_branch(user) -> {branch_id: {'lessons_done': n}}`, the shape `identity/record.py`
(learning step B) registers. Counts only, grouped by `Course.subjects`, and a lesson counts once per
branch its course claims — picking one branch per course would be the server inventing a primary
subject the course never declared. This app never imports `identity/`; the integrator registers it.

## `seed_school_demo` — one lived-in school

`testing/school_demo.py`, `seed_conference_demo`'s shape and both of its promises: every seeded
course and the school carry `FAKE_PREFIX`, and `assert_contained()` (its own `CONTAINMENT_MODELS`,
scoped to this school and these classes) runs inside the build's transaction. A school, two classes
with different `progress_visibility` so the widening can be compared side by side, a teacher, a head
teacher, twelve pupils — eleven minors with guardians, one who has turned sixteen and has none — and
one certificate. `--password`, `--reset`, idempotent by rebuild. It checks the certificate it is
about to write against `completion_block_reason` and the progress it is about to write against
`progress_writable_by`, so a hand-edited plan fails the command rather than seeding data the API
would have refused.

## Verify

`manage.py test courses`. E2E: `classroom.mjs`, `classroom-overhaul.mjs`, `course-tabs.mjs`,
`course-search.mjs`, `course-add-chapter.mjs`, `course-lessons-linking.mjs`,
`course-content-links.mjs`, `course-claims.mjs` (names still say "classroom" — that's just history),
`school-mode.mjs` (needs `seed_school_demo` run against the backend it drives; its deck POST is
mocked because learning step A owns `/api/decks/`).
