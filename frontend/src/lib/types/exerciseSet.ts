/** Server-side "My Set" for registered users — see lib/utils/guestSet.ts for the localStorage-backed
 * guest equivalent, which does not use this type at all (it's a bare array of exercise ids). */
export interface ExerciseSet {
	id: string;
	ownerId: string;
	name: string;
	exerciseIds: string[];
	createdAt: string;
}
