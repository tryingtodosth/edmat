# Prep — what the integrator landed before anyone started (2026-10-05)

This is the record of the prep commit, not a brief for an agent. Every agent's brief says "the
prep already did X"; this file is where X is listed, so a brief can point here rather than
restate it. Written by the orchestrating session (Fable 5.1) on branch
`ux/mission-nav-tutoring-volunteering`; the commit hash is in each brief's header block.

## Flags — `moderation` migration 0047, three keys, all seeded ON

| Key | Kind | Owner | Governs |
|---|---|---|---|
| `flashcards` | plain kill switch | A | every `/api/decks/…` endpoint, the account-menu item, the "make a deck" buttons (C, D, E), the placement panels |
| `learning_record` | plain kill switch | B | the record section on a public profile, its settings toggle, `GET /api/users/{id}/learning-record/` |
| `creation_requires_verification` | **inverted** (on = the restriction is on), like `material_uploads_verified_only` | F | whether `config/creation.py` refuses non-staff, non-verified accounts |

All three are in `frontend/src/lib/types/featureFlag.ts`, `frontend/src/lib/utils/labels.ts`
and both catalogues (`featureFlags_label_flashcards`, `…_learningRecord`,
`…_creationRequiresVerification`). Nobody adds a key.

## Backend seams

- `backend/flashcards/` — registered empty app (`apps.py`, empty `models.py`, `urls.py` with an
  empty `NumericPkRouter`), in `INSTALLED_APPS` and `config/urls.py`. Step A fills it.
- `backend/config/creation.py` — the creation gate as a STUB that refuses nobody:
  `CREATION_KINDS = ('course', 'event', 'service', 'organization')`,
  `creation_block_reason(user, kind) -> str | None`, `creation_status(user) -> {kind: reason}`.
  Wired into the four create paths already (`courses/views.py: CourseViewSet.create`,
  `events/views.py: EventViewSet.create` after the minors check, `services/views.py:
  ServiceViewSet.create`, `organizations/views.py: OrganizationViewSet.create` or-ed with
  `found_block_reason`), each answering `403 {"detail": <reason>}`. Step F writes the body.
- `GET /api/creation/` (`config/views.py: CreationStatusView`) — `{kind: reason-or-null}` for the
  caller; `anonymous` for every kind when signed out. The Header's side of the gate (F).

## Frontend seams

- `lib/types/flashcards.ts` (`Deck`, `DeckPlacementRef`, `DeckFromExercisesDraft`) and
  `lib/services/flashcards.ts` (`mapDeck`, `createDeckFromExercises`) — the ONE call C, D and E
  make against A's API, typed against `02-flashcards.md` §API. A owns both files afterwards and
  keeps the function's signature.
- Markers, one HTML comment each, replaced or appended-below by exactly the step named:

| File | Marker | Step |
|---|---|---|
| `lib/components/layout/Header.svelte` script block | `Learning-cycle flags` | A, B (one `let can… = $derived(can('…'))` line each); F appends its `creation` state here |
| same, main nav | `Learning nav marker` | nobody — the bar stays trimmed |
| same, Add… snippet | `Learning Add… marker` | F wraps the "New event" / "New listing" `{#if}`s |
| same, account snippet | `Learning account-menu marker` | A appends "My decks" |
| `routes/exercises/[id]/+page.svelte` | `learning: learn first (D)` / `learning: add to deck (A)` | D mounts; A's control goes through the save-targets store instead |
| `routes/users/[id]/+page.svelte` | `learning: learning record (B)` | B |
| `routes/courses/[id]/+page.svelte` | `learning: deck placements (A)` / `learning: completion (C)` | A mounts; C's own sections are elsewhere in the file |
| `routes/events/[id]/+page.svelte` | `learning: deck placements (A)` / `learning: event ↔ course (E)` | A, E |
| `routes/about/+page.svelte` | `learning: showcase (G)` / `learning: guide (H)` | G, H |
| `svelte.config.js` prerender entries | `showcase (G)` / `guide (H)` comment lines | G, H append entries |

## What the prep deliberately did NOT do

- No `ManagementPanels`-style shared component for the learning layer: A mounts one panel on
  two pages at two markers, and nothing else is shared, so a registry would be one more file to
  merge for no gain.
- No `work/providers.py` registration, no `identity/record.py` registry entry, no
  permission-matrix rows — the integrator does those after the merges (`10-integration.md`).
- No `pack.sh` prerender-list change — integrator's, once G and H say which pages exist.
