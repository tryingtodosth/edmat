import type { ExerciseSet, ExerciseSetItemOptions } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import { mapExerciseSet, type RawExerciseSet } from '$lib/api/mappers';

// `userId` stays a parameter for call-site compatibility — the backend already scopes
// GET /api/exercise-sets/ to whoever the auth token belongs to (study/views.py's own
// ExerciseSetViewSet.get_queryset filters by owner=request.user), so a different id here couldn't
// see anyone else's sets anyway.
export async function getSetsForUser(_userId: string): Promise<ExerciseSet[]> {
	const raw = await apiClient.get<RawExerciseSet[]>('/exercise-sets/');
	return raw.map(mapExerciseSet);
}

// The `{exercise, include_hint, include_answer, include_solution}` shape study/serializers.py's
// own `ExerciseSetItemOptionSerializer` expects — shared by createSet/setExerciseSetItemOptions
// below rather than each building it separately.
function buildItemOptionsPayload(itemOptions: Record<string, ExerciseSetItemOptions>) {
	return Object.entries(itemOptions).map(([exerciseId, options]) => ({
		exercise: Number(exerciseId),
		include_hint: options.includeHint,
		include_answer: options.includeAnswer,
		include_solution: options.includeSolution
	}));
}

// `ownerId` stays a parameter for call-site compatibility — same reasoning as getSetsForUser.
// `itemOptions` is genuinely optional — a set saved without ever touching the hint/answer/solution
// checkboxes behaves exactly as this feature never existed (every ExerciseSetItem just defaults to
// "statement only" server-side).
export async function createSet(
	_ownerId: string,
	name: string,
	exerciseIds: string[],
	itemOptions?: Record<string, ExerciseSetItemOptions>
): Promise<ExerciseSet> {
	const raw = await apiClient.post<RawExerciseSet>('/exercise-sets/', {
		name,
		exercise_ids: exerciseIds.map(Number),
		...(itemOptions ? { item_options: buildItemOptionsPayload(itemOptions) } : {})
	});
	return mapExerciseSet(raw);
}

export async function updateSet(id: string, exerciseIds: string[]): Promise<void> {
	await apiClient.patch(`/exercise-sets/${encodeURIComponent(id)}/`, {
		exercise_ids: exerciseIds.map(Number)
	});
}

/** Updates ONLY the per-exercise hint/answer/solution inclusion for an already-saved set, leaving
 * its exercise membership/order completely untouched (study/serializers.py's own
 * `_apply_item_options` — `item_options` is applied independently of `exercise_ids`). */
export async function setExerciseSetItemOptions(
	id: string,
	itemOptions: Record<string, ExerciseSetItemOptions>
): Promise<ExerciseSet> {
	const raw = await apiClient.patch<RawExerciseSet>(`/exercise-sets/${encodeURIComponent(id)}/`, {
		item_options: buildItemOptionsPayload(itemOptions)
	});
	return mapExerciseSet(raw);
}

/** Toggles a saved set's own share link on/off (study/models.py's `is_public`, study/views.py's
 * `ExerciseSetViewSet.retrieve` gating) — a real, working "share"/"unshare," not just a UI label.
 * Returns the updated set so the caller can trust the backend's own confirmed value rather than
 * assuming the write succeeded exactly as sent. */
export async function setExerciseSetPrivacy(id: string, isPublic: boolean): Promise<ExerciseSet> {
	const raw = await apiClient.patch<RawExerciseSet>(`/exercise-sets/${encodeURIComponent(id)}/`, {
		is_public: isPublic
	});
	return mapExerciseSet(raw);
}

/** GET /api/exercise-sets/{id}/ — the one deliberately public `retrieve` on an otherwise
 * fully owner-scoped endpoint (study/views.py's own `ExerciseSetViewSet`), and the real,
 * previously-missing "share a link to my set" feature: no auth required, works for a guest
 * visitor exactly as it does for a logged-in one, since a set's own content was never sensitive —
 * only the ability to MODIFY someone else's set stays protected. `/sets/[id]`'s own shared-view
 * route is the one real caller. Same 404-swallowing shape as `getExerciseById` — a bad/deleted id
 * is an honest "not found" state the caller renders, not an error to surface as a crash. */
export async function getSharedSet(id: string): Promise<ExerciseSet | undefined> {
	try {
		const raw = await apiClient.get<RawExerciseSet>(`/exercise-sets/${encodeURIComponent(id)}/`);
		return mapExerciseSet(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}
