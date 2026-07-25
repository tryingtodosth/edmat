import type { ExerciseSet } from '$lib/types';
import { apiClient } from '$lib/api/client';
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
