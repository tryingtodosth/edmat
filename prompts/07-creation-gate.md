# F. The creation gate — brief for one agent

| | |
|---|---|
| **Model** | Opus (every step of this cycle runs on Opus, owner decision 2026-10-05) |
| **Branch** | `learn/f-gate` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/learn-f-gate/` |
| **Ports** | API `8136`, Vite `5236` |
| **Prep commit** | see `prompts/README.md` §3 |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 and §5, `prompts/00-DESIGN.md` (§2 row "creation → verification", §4.6),
`prompts/01-prep.md` (the stub and the four call sites are already there — read them), then
`backend/config/CLAUDE.md`, `backend/accounts/CLAUDE.md`, `LAUNCHCHECKLIST.md` §3 if it exists
(standing is a ceiling, never authority).

## The task
Until the USOS connection exists, **founding** a course, an event, a tutoring listing or an
organisation is for staff and verified contributors. Everything else — reading, joining,
enrolling, attending, booking, and everything already created — is untouched. One rule module,
`config/creation.py`, already asked by the four create paths and by `GET /api/creation/`; you
write its body, its tests, and the frontend that stops showing buttons the server would refuse.

## What "finished" means
- [ ] `config/creation.py` body: `anonymous` for a signed-out caller; staff pass; a minor is
      `minor` (the existing per-app minors refusals stay — yours comes after them); when
      `is_feature_enabled('creation_requires_verification')` and the account is not
      `is_verified_contributor` → `verification_required`; else None.
- [ ] `config/test_creation.py`: the table (anonymous / minor / ordinary / verified / staff ×
      flag on / off × four kinds), plus one request-level test per create path proving the
      word arrives as `403 {"detail": "verification_required"}` and that the flag off restores
      the old behaviour.
- [ ] `lib/services/creation.ts: getCreationStatus()` → `{course, event, service, organization}`
      each `null | reason`; a small store `lib/state/creation.svelte.ts` loaded when signed in.
- [ ] Header: at the `Learning-cycle flags` marker, `creation` state; at the `Learning Add…
      marker`, the "New event" and "New listing" `{#if}`s also require their kind to be `null`;
      the Add… trigger still disappears when nothing is left (`hasAnythingToAdd`).
- [ ] The four hubs' create buttons (`/courses` "Run a course", `/events` its create link,
      `/tutoring` its create link, `/organizations` "Found an organisation") hidden the same way;
      the four `…/new` pages show the reason as a sentence with a link to `/levels` (what a
      verified contributor is) when the page is opened directly — the `REFUSAL[reason]()` idiom.
- [ ] Both catalogues: `gate_reason_anonymous`, `gate_reason_minor`,
      `gate_reason_verificationRequired`, and the sentence on each hub explaining why the button
      is missing (short, honest: "Until the university sign-in exists, new courses are started
      by verified contributors. Ask a moderator.").
- [ ] `HISTORY.md` §17BR.F; `test.md`; board entry.

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| The stub and its call sites | `backend/config/creation.py`; `courses/views.py: CourseViewSet.create`, `events/views.py: EventViewSet.create` (after `is_minor`), `services/views.py: ServiceViewSet.create`, `organizations/views.py: OrganizationViewSet.create` (or-ed with `found_block_reason`); `config/views.py: CreationStatusView`, `config/urls.py` | you change the module body only — never the call sites |
| The flag's reading | `backend/moderation/services.py:845` (`is_feature_enabled` — fails OPEN, which for an inverted flag means "restriction on" when the row is missing: the safe direction, as `coauthoring/services.py:407-436` argues for `material_uploads_verified_only`) | |
| Verified contributor | `backend/accounts/models.py:84` (`Profile.is_verified_contributor`, staff-set, never client-writable — `accounts/serializers.py:150-151, 256`), `accounts/admin.py:31-38` | the ONLY signal; `identity/standing.py: ceiling_for` is a different axis — do not use it |
| Minors | `backend/accounts/minors.py:22`, `organizations/access.py:116` (`found_block_reason`), `services/views.py:244` (`PermissionDenied('minor')`) | the existing refusals you sit behind |
| Header | `frontend/src/lib/components/layout/Header.svelte`: `can` 61, flag lets 67-106 + the learning marker, `hasAnythingToAdd` 128, `createItems` 374-449 (events/new 398, tutoring/new 404), the two render sites 825 and 1036 | |
| Hubs | `frontend/src/routes/courses/+page.svelte:82,100`, `routes/events/+page.svelte`, `routes/tutoring/+page.svelte`, `routes/organizations/+page.svelte` (find each create link) | hide + the sentence |
| The `…/new` pages | `routes/courses/new/+page.svelte:5,18`, `routes/events/new/+page.svelte:5,19`, `routes/tutoring/new/+page.svelte:9,22`, `routes/organizations/new/+page.svelte:16,48,58` (`OrganizationRefusedError` — the precedent for a refusal reaching a form) | |
| The refusal idiom | `frontend/src/routes/courses/[id]/+page.svelte:521-523` (`REFUSAL[course.enrollmentBlockReason]?.() ?? m.common_error_generic()`) | |
| Auth store | `frontend/src/lib/state/auth.svelte.ts` (`isAuthenticated`, the user shape — does it carry `isVerifiedContributor`? if so the store can short-circuit; the server answer still wins) | |
| Tests | `backend/config/test_nodes.py` (the config test shape), `backend/testing/factories.py:18` (`make_user(is_verified_contributor=)`), `tasks/tests.py:37-41` (`databases`) | |
| e2e | `frontend/e2e/CLAUDE.md`, `frontend/e2e/about-page.mjs` | write `frontend/e2e/creation-gate.mjs` |

## Shapes fixed in advance — do not rename
`creation_block_reason(user, kind)`, `creation_status(user)`, `CREATION_KINDS`, the three words,
`GET /api/creation/`. Flag key `creation_requires_verification` (inverted). You do NOT touch
`accounts`, `identity`, `moderation` or any app's views.

## Left open, by design
The USOS connection itself; a "request verification" button (goes through `issues` today — link
to it from the sentence if a route exists); per-kind flags; a grace list.

## Verify
From `/Projects/edmat/.claude/worktrees/learn-f-gate/`:
```
cd backend && ../.venv/bin/python3 manage.py test config courses events services organizations --keepdb
../.venv/bin/python3 manage.py check && ../.venv/bin/python3 manage.py makemigrations --check --dry-run
cd ../frontend && npm run check && npm run lint && npm run build
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5236,http://127.0.0.1:5236 ../.venv/bin/python3 manage.py runserver 127.0.0.1:8136   # backend/
npm run dev -- --port 5236 --strictPort                                                                                   # frontend/
rm -rf backend/cachedata/*; E2E_BASE=http://localhost:5236 E2E_API=http://127.0.0.1:8136/api node e2e/creation-gate.mjs
```
The e2e: as an ordinary seeded user the Add… menu has no "New event"/"New listing", the four hubs
show the sentence, `/courses/new` opened directly shows the reason; as kasia (staff) everything is
there; flip the flag off as kasia and the ordinary user gets the buttons back. Screenshots,
looked at. Numbers on the board.
