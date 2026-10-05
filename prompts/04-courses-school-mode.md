# C. Courses — lesson → deck, school mode, the completion certificate — brief for one agent

| | |
|---|---|
| **Model** | Opus (every step of this cycle runs on Opus, owner decision 2026-10-05) |
| **Branch** | `learn/c-courses` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/learn-c-courses/` |
| **Ports** | API `8133`, Vite `5233` |
| **Prep commit** | `f90e221` (`prompts/README.md` §3; the worktree is on it) |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, `prompts/00-DESIGN.md` (§2 rows "lesson → deck", "course ↔
organization", "course → certificate", "school demo → EdMat"; §4.5), `prompts/01-prep.md`,
`prompts/02-flashcards.md` §API (you call it; it does not exist on your branch), then
`backend/courses/CLAUDE.md` (lines 13-77 are one long invariant list — read all of it),
`backend/organizations/CLAUDE.md`, `backend/events/CLAUDE.md` (the seeding contract),
`HISTORY.md` §17BO (the school demo) and §17BK (`seed_conference_demo`).

## The task
Four things on `courses`, the largest app:
1. **"Make a deck from this week"** on a lesson: every exercise in the lesson's items and linked
   sets, snapshot, placed on the course — one call to `createDeckFromExercises`.
2. **School mode**: an organisation of kind `school` that runs a course makes it a *class*:
   participants may be minors under `Guardianship`, staff see every participant's progress
   statements regardless of `progress_visibility`, and the roster shows guardians to staff.
   No new model for "class" — it is a course run by a school (`00-DESIGN.md` §1 rule 1).
3. **`CourseCompletion`**: issued by course staff, by hand, to a participant whose own
   statements say every lesson is done; printable like the shifts certificate; carries the
   course title, the organisation if any, dates and the issuer. **No grade, no mark, no rank.**
4. **`seed_school_demo`**: one lived-in school (a `school` organisation, two classes, a teacher,
   twelve pupils with guardians, progress, one certificate), the `seed_conference_demo` way.

## What "finished" means
- [ ] Lesson UI: a "Make a deck from this week" button (staff and participants alike — the
      placement is attempted only for staff), behind `flashcards`; the resulting deck opens.
- [ ] `courses/models.py`: `CourseCompletion(course, participant, issued_by, issued_at, note,
      revoked_at)` unique (course, participant); `courses/rules` additions (§Shapes); one migration.
- [ ] `GET|POST /api/courses/{id}/completions/`, `POST /api/course-completions/{id}/revoke/`,
      `GET /api/course-completions/{id}/` (the holder, the issuer, course staff; else 404);
      `/courses/[id]/certificate/[completionId]` prints it (browser print, bilingual, unsigned —
      the shifts certificate's posture).
- [ ] School mode: `is_school_course(course)` in `courses/rules`; `lesson_progress` and
      `participants` answer more to staff of a school course; the roster draws the guardian
      column; the course page says "run by <organisation>" (the line that is missing today) with
      a link, for every course with a `runs` link.
- [ ] `courses/record.py: activity_by_branch(user)` → `{branch_id: {'lessons_done': n}}` (B's
      registry; the integrator registers it).
- [ ] `seed_school_demo` + `testing/school_demo.py`, `FAKE_PREFIX`-titled, `assert_contained`,
      `--reset`, idempotent, password printed.
- [ ] Kill switches: `flashcards` off hides the button; `organizations` off hides "run by".
- [ ] i18n prefix `school_`, both catalogues; `HISTORY.md` §17BR.C; `test.md`; board entry.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| Lesson contents | `backend/courses/models.py:565-640` (`Lesson`), `775-972` (`CourseItem`, exactly one of five), `1389-1551` (`LessonExerciseSet` snapshot + `LessonSetExercise`, `visible_exercises` at 1515) | the deck's exercise ids = the lesson's exercise items + every linked set's visible exercises, in order |
| Progress and its visibility | `backend/courses/models.py:118-125, 295-297, 500-530, 1560-1595`; `courses/views.py:1008-1066` (`lesson_progress`) | school mode widens what STAFF see; a participant's view is unchanged |
| Roster | `backend/courses/views.py:338-404` (`participants`, `decide`), `models.py:642-721` (`Enrollment`, `CourseStaff`) | the guardian column |
| Authority | `backend/courses/models.py:419-423` (`can_administer`, `can_curate`) | issuing a certificate = `can_administer` |
| Guardianship | `backend/accounts/models.py:481-500`, `accounts/minors.py:22-29` (`is_minor`, `guardian_of`) | |
| The organisation link | `backend/organizations/models.py:39-42` (kind `school`), `68` (`LINK_KIND_CHOICES`), `158-180` (`OrganizationLink`, GenericFK + `kind` default `runs`), `organizations/access.py:128` (`link_block_reason`), `frontend/src/lib/services/organizations.ts:251` (`getNodeOrganizations` — exists, wired nowhere) | "run by" on the course page is `getNodeOrganizations('course', id)`; school mode asks "is there a `runs` link from a `school`?" — READ-ONLY use of `organizations`, no edit there |
| The certificate precedent | `backend/shifts/models.py:226-260` (`credited_hours`, `VolunteerRecord`), `shifts/views.py:556-591` (`MyVolunteeringView`), `frontend/src/routes/events/[id]/certificate/+page.svelte` (the whole file; the header comment and the `@media print` block) | copy the posture: bilingual, unsigned, printed by the browser, no WeasyPrint |
| Seeder contract | `backend/events/management/commands/seed_conference_demo.py` (93 lines, all of it), `backend/testing/conference_demo.py`, `backend/events/CLAUDE.md` (FAKE_PREFIX, `assert_contained`, `CONTAINMENT_MODELS`) | `seed_school_demo` keeps both promises |
| Course page | `frontend/src/routes/courses/[id]/+page.svelte` (1115 lines): imports 46-58, `<h1>` 445, enrol 475, roster 887-915, the markers after 952; `lib/components/course/CourseContent.svelte` (lesson bodies render here — the deck button goes beside a lesson's heading); `lib/services/course.ts` (`getLinkedSets` 477, `getLessonProgress` 976, `getParticipants` 395); `lib/types/course.ts:181` (`LessonExerciseSet`) | |
| The deck call | `frontend/src/lib/services/flashcards.ts` (`createDeckFromExercises({name, exerciseIds, source: {kind:'lesson', id}, placement: {kind:'course', id}})`) | the only flashcards code you touch is this import; the backend answers 404 on your branch — verify the button with a mocked response in the e2e, and say so |
| Minors on the record | `prompts/03-learning-record.md` §Shapes | your `courses/record.py` returns the dict shape B registers |
| Tests | `backend/courses/tests*.py` (the existing files — add to the right one), `backend/testing/factories.py`, `tasks/tests.py:37-41` (`databases`) | |
| e2e | `frontend/e2e/CLAUDE.md`, `frontend/e2e/course-tabs.mjs` | write `frontend/e2e/school-mode.mjs` |

## Shapes fixed in advance — do not rename
```
courses/rules (or the module the app already uses for refusals — look first):
  is_school_course(course) -> Organization | None      # the school running it, if any
  completion_block_reason(user, course, participant) -> 'not_staff' | 'not_participant' | 'not_done' | 'already_issued' | None
  revoke_block_reason(user, completion) -> 'not_staff' | 'already_revoked' | None
courses/record.py: activity_by_branch(user) -> {branch_id: {'lessons_done': n}}
seed_school_demo --password --reset ; testing/school_demo.py: build_school_demo(), remove_school_demo()
```
A completion is **never** created automatically; "all lessons done" is checked at issue time from
`LessonProgress` and recorded in `note` as the count ("12 of 12 lessons, by the participant's own
statements") so that the certificate carries its own basis.

## Left open, by design
A gradebook (the demo has one; EdMat deliberately does not — `00-DESIGN.md` §5); guardian
sign-off on a certificate; a class timetable; linking the `/dziennik` demo at the data level
(forbidden by owner decision); notifications on issue.

## Verify
From `/Projects/edmat/.claude/worktrees/learn-c-courses/`:
```
cd backend && ../.venv/bin/python3 manage.py test courses organizations config --keepdb
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
../.venv/bin/python3 manage.py seed_school_demo && ../.venv/bin/python3 manage.py seed_school_demo --reset && ../.venv/bin/python3 manage.py seed_school_demo
cd ../frontend && npm run check && npm run lint && npm run build
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5233,http://127.0.0.1:5233 ../.venv/bin/python3 manage.py runserver 127.0.0.1:8133   # backend/
npm run dev -- --port 5233 --strictPort                                                                                   # frontend/
rm -rf backend/cachedata/*; E2E_BASE=http://localhost:5233 E2E_API=http://127.0.0.1:8133/api node e2e/school-mode.mjs
```
The e2e: as the seeded teacher open a class, see the roster with guardians and every pupil's
progress, issue a certificate to the one pupil who is done, print-preview it (screenshot), be
refused for one who is not (the word on screen); as a pupil see your own certificate and not the
others'; as a stranger get 404 on the completion. Screenshots, looked at. Numbers on the board.
