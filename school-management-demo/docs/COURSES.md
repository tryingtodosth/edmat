# Courses (module `courses`)

A lightweight LMS that lives inside the logbook. Teachers publish structured learning content; students work
through it; the logbook keeps the evidence (progress, quiz scores, homework submissions, audit trail).
Everything is in the single-node prototype: no extra service, no npm dependency.

The module is registered in `server/modules.js` as `courses`; `server/routes/courses.js` maps to it through
`ROUTE_MODULE`, and `public/app/screens/courses.js` declares `module: 'courses'`. Turning the module off in
**Modules** hides the screen and makes every route answer `404 {code:'module_disabled'}`.

## How it maps to a teacher's workflow

| The teacher wants to… | In the app |
| --- | --- |
| prepare a revision course before a test | create a course (draft), add **units**, add **items** to each unit |
| release material week by week | set `availableFrom` on a unit — students see it locked until that date (`D.today(db)`, not the wall clock) |
| reuse what is already in the logbook | item kinds `material` (an existing `materials` row) and `assignment` (an existing or newly created `homework` row, same shape as `POST /api/homework`) |
| check understanding | item kind `quiz` — single-choice questions with points, an attempt limit and an optional time limit |
| give the whole class access | publish, then **enrol class** (all students of `classIds` / `groupIds`) |
| let anyone join | `visibility: 'open'` + `enrollmentOpen` — students self-enrol |
| see who is where | the **gradebook**: completion %, quiz scores, homework submission status |
| turn a quiz result into a real grade | one click — writes a `grades` row through the grades module's own `writeGrade`, category `quiz` |
| answer questions in one place | the per-course discussion; the teacher pins and locks threads |
| reward completion | a printable completion certificate once every required item is done |

Parents get a read-only view of their own child's progress and nothing else.

## Data model

All collections live in the JSON store; ids use the `co`/`cou`/`coi`/`coe`/`cop`/`coq`/`cot`/`cps` prefixes
(the seed uses readable `co_…` ids).

| collection | shape |
| --- | --- |
| `courses` | `{ id, title, description, subjectId, classIds:[], groupIds:[], teacherIds:[], visibility:'class'\|'open', enrollmentOpen, status:'draft'\|'published'\|'archived', createdAt, publishedAt?, archivedAt?, coverColor:'cat-1..8', language:'pl'\|'en' }` |
| `courseUnits` | `{ id, courseId, order, title, summary, availableFrom, lessonId? }` |
| `courseItems` | `{ id, courseId, unitId, order, kind:'text'\|'material'\|'link'\|'assignment'\|'quiz'\|'meeting', title, body, required, materialId, url, homeworkId, quiz, meetingId }` |
| `courseItems.quiz` | `{ questions:[{ id, text, options:[{id,text}], correctId, points }], attempts, timeLimitMin }` |
| `courseEnrollments` | `{ id, courseId, studentId, at, source:'class'\|'self' }` |
| `courseProgress` | `{ id, courseId, studentId, itemId, status:'done'\|'seen', score, at, gradeId? }` |
| `quizAttempts` | `{ id, itemId, courseId, studentId, answers:{qid:optionId}, score, maxScore, at, autoGraded:true }` |
| `courseThreads` | `{ id, courseId, title, byUserId, at, pinned, locked }` |
| `coursePosts` | `{ id, threadId, courseId, parentId, body, byUserId, at }` |

`body` is **markdown-light**: blank-line-separated paragraphs, `**bold**`, and `-`/`*` bullet lists. The client
renders it as React elements (never `innerHTML`), so any HTML in the text is escaped by React itself.

Shared collections are reused, never duplicated: materials come from `materials` (downloaded through
`/api/materials/:id`), assignments from `homework` + `homeworkSubmissions`, grades from `grades`.

Two things a course inherits from the rest of the logbook rather than re-implementing:

- **Attachments.** A `material` item hands a file to a whole class, so the file goes through the same
  gate as any other upload — `server/lib/uploads.js` (`validateUpload`): the declared type must match
  the `data:` header *and* the magic bytes, the size is computed from the base64 rather than taken
  from the client, and browser-executable types (HTML, SVG, scripts) are refused. A material that
  fails is rejected at `POST/PATCH /api/courses/:id/items` with `400 bad_upload` / `415 content_mismatch` /
  `413 attachment_too_large`, not stored and then served (S-13).
- **Due times.** An `assignment` item's `homework.dueAt` accepts `RRRR-MM-DD` or `RRRR-MM-DDTGG:MM`
  **in the school's local time** and is stored as an ISO instant carrying the school's offset, so
  "23:59" is 23:59 in `Europe/Warsaw` and not in UTC. The same `homework` row and the same rule as a
  logbook assignment (`server/routes/homework.js`).

## Access rules

- **Teacher**: may edit a course only if their user id is in `teacherIds` (owner or co-teacher).
- **Principal**: reads every course and its gradebook, but cannot edit content.
- **Student**: sees a course only if it is `published` **and** they have a `courseEnrollments` row
  (`403 not_enrolled` otherwise; a draft is `404 course_not_published`, so drafts leak nothing).
  A unit whose `availableFrom` is in the future returns `locked: true` and an empty `items` array; writing
  progress against it is `403 unit_locked`.
- **Parent**: `GET` only, restricted to `D.assertCanSeeStudent` — every write endpoint excludes the role.
  Anything that is a learning record of the pupil (a quiz score, a submitted assignment, a grade carried
  over from a quiz) is additionally subject to the shared read gate `D.assertMayReadPupilRecord` in the
  grades and homework modules: a guardian with `accessScope: 'info'` sees the course and its progress but
  not the grades it produced, and `'none'` sees nothing (S-10).

## Endpoints

| method + path | who | what |
| --- | --- | --- |
| `GET /api/courses` | all | staff: own (principal: all) courses + `context` (subjects/classes/groups the teacher may use); student: `courses` (enrolled) + `available` (open, not yet joined); parent: the child's courses |
| `POST /api/courses` | teacher, principal | create a draft |
| `GET /api/courses/:id` | all | full course: units, items, progress, discussion. Teachers see quiz `correctId`; students never do |
| `PATCH /api/courses/:id` | course teacher | title, description, visibility, audience, cover, language |
| `DELETE /api/courses/:id` | course teacher | drafts only (`409 not_draft`) |
| `POST /api/courses/:id/publish` | course teacher | `draft → published` (needs at least one unit); notifies enrolled students |
| `POST /api/courses/:id/archive` | course teacher | `→ archived` |
| `POST /api/courses/:id/units` · `PATCH`/`DELETE /…/units/:unitId` | course teacher | unit CRUD |
| `POST /api/courses/:id/items` · `PATCH`/`DELETE /…/items/:itemId` | course teacher | item CRUD; an `assignment` may carry `homework:{text,dueAt}` and the homework row is created on the spot |
| `POST /api/courses/:id/enrol` | course teacher | `{classId}` / `{studentIds}` / nothing (= the course's own `classIds` + `groupIds`); `source:'class'` |
| `POST /api/courses/:id/enrol/self` | student | open + `enrollmentOpen` + published only; `source:'self'` |
| `POST /api/courses/:id/items/:itemId/done` | student | mark `done` (or `seen`); returns the new progress and the certificate path when complete |
| `POST /api/courses/:id/items/:itemId/quiz` | student | submit `{answers}` → auto-graded: `score`, `maxScore`, `percent`, `suggestedGrade` and **per-question correctness** (returned only here, after submitting). `409 attempts_exhausted` past the limit; the best score lands in `courseProgress` |
| `POST /api/courses/:id/items/:itemId/grade` | course teacher | best attempt → a `grades` row via the grades module's `writeGrade` (points mode, category `quiz`, created on first use) |
| `GET /api/courses/:id/gradebook` | course teacher, principal | per student: completion %, quiz best score + grade, homework submission state |
| `GET /api/courses/:id/discussion` | staff, enrolled student | threads with posts |
| `POST /api/courses/:id/threads` · `/threads/:threadId/posts` | staff, enrolled student | new thread / reply; a locked thread rejects students with `403 thread_locked` |
| `PATCH /api/courses/:id/threads/:threadId` | course teacher | `pinned`, `locked` |
| `GET /api/courses/:id/certificate` | student, parent, course teacher, principal | print-ready HTML (`D.printHtml`) once every required item is done; `409 not_complete` otherwise |
| `GET /api/courses/child/progress` | parent (staff too) | read-only progress + quiz scores for one child |

Completion is measured over **required** items only (`required !== false`), across all units — a locked unit's
items still count towards the denominator, so a course with a future unit is not complete until it opens.

## Audit

Every write calls `ctx.audit(…)`: `course_create`, `course_update`, `course_delete`, `course_publish`,
`course_archive`, `course_unit_create/update/delete`, `course_item_create/update/delete`, `course_enrol`,
`course_enrol_self`, `course_item_progress`, `course_quiz_submit`, `course_quiz_grade`, `grade_category_create`,
`course_thread_create`, `course_post_create`, `course_thread_moderate`, `course_certificate`. Creating a
homework row from inside a course item also writes `homework_publish`, exactly like the logbook does.

## Seed and tests

`server/seed/18-courses.js` seeds two demo courses: *Ułamki zwykłe – kurs powtórkowy* (maths, class 7b,
j.nowak — three units, texts, a downloadable material, a five-question scored quiz, a homework assignment and a
pinned discussion thread; the third unit opens on 2 Nov 2026 to show date gating) and *Bezpieczeństwo w sieci*
(computer science, a.wojcik, open self-enrolment). Anna Kowalczyk has progress and two quiz attempts in both.

`tests/41-courses.test.js` covers the module end to end as `[courses.1]`…`[courses.10]`; `[courses.10]`
covers the `meeting` item kind, which creates a video meeting for the enrolled students and cancels it when
the item is deleted (`meetings` module). `tests/42-meetings.test.js` `[meetings.12]` checks the other side:
a course meeting is visible only to a student enrolled on that course.
