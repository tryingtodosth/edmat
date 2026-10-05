# B. The learning record — brief for one agent

| | |
|---|---|
| **Model** | Opus (every step of this cycle runs on Opus, owner decision 2026-10-05) |
| **Branch** | `learn/b-record` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/learn-b-record/` |
| **Ports** | API `8132`, Vite `5232` |
| **Prep commit** | see `prompts/README.md` §3 |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, `prompts/00-DESIGN.md` (§1 rule 3 is the whole of this step),
`prompts/01-prep.md`, then `backend/identity/CLAUDE.md`, `backend/accounts/CLAUDE.md`,
`backend/study/CLAUDE.md`, `LEGAL.md` §on minors and personal data.

## The task
One new section on a public profile, the **learning record**: what somebody has SHARED about
their institutional results (grades per `taxonomy.Branch`, already consent-gated by
`share_grades`) in one block, and what they have DONE on EdMat (sets made, lessons they said they
finished, cards reviewed — **counts per Branch, never per item**) in a second block under a new
consent of its own, `share_activity`, off by default. The two blocks never mix: an EdMat count is
never drawn beside a grade as if it were one (`00-DESIGN.md` §1 rule 3). Plus the minors fix in
`study` the design names: a minor's public set must not expose their display name.

## What "finished" means
- [ ] `identity.EducationProfile.share_activity` (default False) + migration; settable through
      the existing `PATCH /api/education/me/`; a toggle in `EducationModal.svelte` next to the
      other three consents, with the honest sentence of what it shares.
- [ ] `identity/record.py`: `learning_record(profile_user, viewer) -> dict | None` and the
      provider registry (§Shapes). Counts are recounted on every read (house rule 5).
- [ ] `GET /api/users/{id}/learning-record/` behind `feature_gate('learning_record')`: `null`
      body when nothing is shared (not 404 — the profile exists; the record is withheld).
- [ ] The row + modal mounted at the `learning: learning record (B)` marker on
      `routes/users/[id]/+page.svelte`, behind `learning_record`; a per-Branch table with two
      clearly separated blocks; the owner sees a "what others see" note.
- [ ] `study`: a minor's set answers `owner_display_name` as the neutral word the catalogues
      already have for an anonymous learner (find it; if none, add `study_anonymousOwner`), and
      the set page draws no link to the owner's profile for a minor.
- [ ] Kill switch off: the section and the settings toggle are gone, the endpoint 403s a
      non-staff caller, the profile page still renders.
- [ ] i18n prefix `record_`, both catalogues; `HISTORY.md` §17BR.B; `test.md`; board entry.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| The three consents and the gated view | `backend/identity/models.py:108-160` (`EducationProfile`, `share_school/diploma/grades` at 156-158), `identity/standing.py:145-197` (`public_view` — None unless `share_school`; grades only if `share_grades`) | `share_activity` is the fourth flag of the same shape; your record function sits BESIDE `public_view`, not inside it |
| Grades per Branch | `backend/identity/models.py:217-245` (`CourseGrade.matched_course` → `taxonomy.Branch`), `standing.py:112-142` (`skill_seeds_for` — the existing group-by-Branch precedent) | the grades block groups by `matched_course` |
| The consent endpoint | `backend/identity/views.py:72-105` (`EducationView.patch`, the loop at 101-103 is where the fourth flag joins), `identity/urls.py:16` | |
| The public profile endpoint | `backend/accounts/urls.py:44` (`users/<pk>/`), `accounts/views.py:160-191` (`UserPublicView.retrieve`, calls `public_view` at 190) | your endpoint is a sibling path in `identity/urls.py`, not a change to this view |
| Branch | `backend/taxonomy/models.py:119-160` (`Branch.slug`, `BranchTranslation.title`) | titles are per locale — resolve as the taxonomy serializers do |
| The exercise's branch | `backend/exercises/models.py:79` (`Exercise.branch`, a direct FK — there is no topic model in between) | every count joins through it |
| Sets | `backend/study/models.py:22-67`, `study/views.py:37-43`, `study/serializers.py:41, 63-64` (`owner_display_name` — the minors gap) | sets per Branch = distinct branches of the set's exercises; the minors fix |
| Progress statements | `backend/courses/models.py:118-125, 1560-1595` (`LessonProgress`, `status` ∈ in_progress/stuck/done; the docstring says visibility lives on the course) | "lessons done" per Branch via the course's `subjects` (`courses/models.py:239-247`); READ-ONLY import — step C owns `courses` |
| Minors | `backend/accounts/minors.py:1-26` (docstring rule "no public profile", `is_minor`) | a minor's record is never public regardless of consent — say so in the modal |
| Verified contributor is NOT standing | `backend/accounts/models.py:84`, `identity/standing.py:41` (`ceiling_for`) | two different axes; do not conflate |
| Frontend profile page | `frontend/src/routes/users/[id]/+page.svelte:23, 63, 236-239, 365-374, 459-490` (education row + modal), `lib/components/profile/TranscriptView.svelte` (the per-year table to model yours on), `lib/services/identity.ts:159-234` (`mapPublicEducation`, `updateEducation`), `lib/types/identity.ts:99-154` | |
| Settings | `frontend/src/routes/settings/profile/+page.svelte:122-124, 164-165`, `lib/components/profile/edit/EducationModal.svelte` (the three toggles live here) | |
| Tests | `backend/testing/factories.py`, `backend/tasks/tests.py:37-41` (`databases` line) | |
| e2e | `frontend/e2e/CLAUDE.md`, `frontend/e2e/about-page.mjs` | write `frontend/e2e/learning-record.mjs` |

## Shapes fixed in advance — do not rename
```
identity/record.py
  ACTIVITY_PROVIDERS: list[Callable[[User], dict[int, dict[str, int]]]]   # branch_id -> {metric: count}
  register_activity_provider(fn)        # the integrator registers flashcards.record.activity_by_branch and courses.record.activity_by_branch
  sets_by_branch(user)                  # yours, from study
  lessons_done_by_branch(user)          # yours, read-only over courses.LessonProgress + Course.subjects
  learning_record(profile_user, viewer) -> None | {
      'grades':   None | [{branch: {slug, title}, average, count}]       # only if share_grades (and share_school)
      'activity': None | [{branch: {slug, title}, sets, lessons_done, cards_reviewed}]   # only if share_activity; metric keys = the union of what providers return, zeros filled
  }
```
Metric keys this cycle: `sets`, `lessons_done`, `cards_reviewed`. The viewer argument exists so
the owner's own view can say "shared" / "not shared" per block; it never widens what a stranger
gets. `GET /api/users/{id}/learning-record/` returns exactly that dict or `null`.

## Left open, by design
A time window ("this term"); per-course records; a record on the course roster for staff
(C's school mode may want it — name the seam); notifications.

## Verify
From `/Projects/edmat/.claude/worktrees/learn-b-record/`:
```
cd backend && ../.venv/bin/python3 manage.py test identity study config --keepdb
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
cd ../frontend && npm run check && npm run lint && npm run build
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5232,http://127.0.0.1:5232 ../.venv/bin/python3 manage.py runserver 127.0.0.1:8132   # backend/
npm run dev -- --port 5232 --strictPort                                                                                   # frontend/
rm -rf backend/cachedata/*; E2E_BASE=http://localhost:5232 E2E_API=http://127.0.0.1:8132/api node e2e/learning-record.mjs
```
The e2e: as a seeded user with grades, turn `share_activity` on, open your own profile signed out
in a second context and see both blocks; turn it off and see only grades; as a minor's guardian
confirm the set page shows no name. Screenshots, looked at. Numbers on the board.
