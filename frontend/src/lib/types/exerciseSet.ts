/** Per-exercise "what to show beyond the statement" — the statement itself is always shown; this
 * is what a saved set's own `ExerciseSetItem` (study/models.py) persists per exercise, so a
 * reloaded or shared set renders the exact same content the creator chose, not just a session-local
 * display preference. */
export interface ExerciseSetItemOptions {
	includeHint: boolean;
	includeAnswer: boolean;
	includeSolution: boolean;
}

/** Server-side "My Set" for registered users — see lib/utils/guestSet.ts for the localStorage-backed
 * guest equivalent, which does not use this type at all (it's a bare array of exercise ids). */
export interface ExerciseSet {
	// The backend's own random, unguessable `slug` (study/models.py's `_generate_set_slug`) — the
	// same "id IS the slug" convention Discipline/Branch already use, not the raw numeric pk. This is
	// what makes `isPublic` a real privacy boundary rather than security-through-obscurity resting
	// on a sequential integer.
	id: string;
	ownerId: string;
	// The owner's own resolved display name (study/serializers.py's `get_owner_display_name`) —
	// present on every response, but only actually USED by `/sets/[id]`'s own shared-view page
	// ("Kasia's set: ..."), the one real place seeing whose set this is matters.
	ownerDisplayName?: string;
	name: string;
	exerciseIds: string[];
	// Keyed by exercise id (a string, matching this app's own opaque-id convention) — every id in
	// `exerciseIds` has an entry here, all fields false by default (today's original "just the
	// statement" behavior, unchanged for a set that never uses this feature).
	itemOptions: Record<string, ExerciseSetItemOptions>;
	// Private by default (an opt-in share, not an unconditional one) — only the owner can retrieve
	// their own set via its share link while this is false; toggling it is a real, working
	// "share"/"unshare" (lib/services/exerciseSets.ts's `setExerciseSetPrivacy`).
	isPublic: boolean;
	createdAt: string;
}
