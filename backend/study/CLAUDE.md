# study — "My Set"

`ExerciseSet` + `ExerciseSetItem` (a `through` model carrying `order`).

## Invariants

- The serializer has an **explicit `update()`** because DRF's default M2M handling for a
  through-model would reset every `order` to 0 on PATCH — item order is user-meaningful state.
- `ExerciseSetViewSet` is fully owner-scoped (`owner=request.user` in `get_queryset`; a
  non-owner gets **404**, not 403) with exactly ONE exception: **`retrieve` is `AllowAny` over
  `objects.all()`** — that IS the sharing feature. The set's plain numeric id is the share link;
  no token, deliberately (content was never secret, only modification is). Don't "harden" the
  public retrieve away, and don't widen anything else.
- Guests keep their working set in `localStorage` (frontend `guestSet.svelte.ts`); server-side
  sets are for registered users. A shared set is **copied** on "save a copy" (a new independent
  row) — never referenced, so the original owner's later edits don't mutate copies.
- `owner_display_name` is embedded so a shared view reads "Kasia's set", not a numeric id.

## Verify

`manage.py test study` — anonymous retrieve, owner scoping, order preservation on update, and
the 404-for-non-owner-delete are all pinned.
