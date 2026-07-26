/** Server-side "My Set" for registered users — see lib/utils/guestSet.ts for the localStorage-backed
 * guest equivalent, which does not use this type at all (it's a bare array of exercise ids). */
export interface ExerciseSet {
	id: string;
	ownerId: string;
	// The owner's own resolved display name (study/serializers.py's `get_owner_display_name`) —
	// present on every response, but only actually USED by `/sets/[id]`'s own shared-view page
	// ("Kasia's set: ..."), the one real place seeing whose set this is matters.
	ownerDisplayName?: string;
	name: string;
	exerciseIds: string[];
	createdAt: string;
}
