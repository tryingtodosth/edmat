# courses — user-run courses (the largest app; formerly named `classroom`)

A *kurs*: something a person runs over time and others join. **Not** `taxonomy.Branch` (a
university subject — that used to be called `Course`, and the root CLAUDE.md still says
"classroom"/"TaughtCourse" throughout). `/api/courses/` is THIS app.

Models: `Course`, `Lesson`, `Enrollment`, `CourseStaff`, `Chapter`, `CourseItem`,
`CourseInvite`, `CourseNote`, `Attachment` (+ `AttachmentReview`), `LessonReview`,
`ChapterReview`, `LessonExerciseSet` + `LessonSetExercise`, `LessonProgress`.
Also `attachmentfile.py` (upload validation), `search.py` (in-course search with snippets),
`reports.py` (course-scoped reporting).

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

## Verify

`manage.py test courses`. E2E: `classroom.mjs`, `classroom-overhaul.mjs`, `course-tabs.mjs`,
`course-search.mjs`, `course-add-chapter.mjs`, `course-lessons-linking.mjs` (names still say
"classroom" — that's just history).
