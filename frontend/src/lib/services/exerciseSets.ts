import type { ExerciseSet } from '$lib/types';
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

// `ownerId` stays a parameter for call-site compatibility — same reasoning as getSetsForUser.
export async function createSet(
	_ownerId: string,
	name: string,
	exerciseIds: string[]
): Promise<ExerciseSet> {
	const raw = await apiClient.post<RawExerciseSet>('/exercise-sets/', {
		name,
		exercise_ids: exerciseIds.map(Number)
	});
	return mapExerciseSet(raw);
}

export async function updateSet(id: string, exerciseIds: string[]): Promise<void> {
	await apiClient.patch(`/exercise-sets/${encodeURIComponent(id)}/`, {
		exercise_ids: exerciseIds.map(Number)
	});
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
