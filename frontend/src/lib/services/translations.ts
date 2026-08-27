import type { ExerciseTranslation } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapExerciseTranslation, type RawExerciseTranslation } from '$lib/api/mappers';

// hint/solution left this draft with the solution-pool feature: a solution rendered into another
// language is submitted as a NEW entry in that language (submitSolutionEntry), never as part of a
// translation — translations cover title/statement/answer only now.
export interface TranslationDraft {
	locale: string;
	title: string;
	statement: string;
	answer: string;
}

export async function getTranslationsForExercise(
	exerciseId: string
): Promise<ExerciseTranslation[]> {
	const raw = await apiClient.get<RawExerciseTranslation[]>(
		`/exercises/${encodeURIComponent(exerciseId)}/translations/`
	);
	return raw.map(mapExerciseTranslation);
}

// `translatedByUserId` stays a parameter for call-site compatibility — the backend attributes the
// translation to whoever the auth token belongs to (ExerciseTranslation.translated_by = request.user).
export async function submitTranslation(
	exerciseId: string,
	_translatedByUserId: string,
	draft: TranslationDraft
): Promise<ExerciseTranslation> {
	const raw = await apiClient.post<RawExerciseTranslation>(
		`/exercises/${encodeURIComponent(exerciseId)}/translations/`,
		draft
	);
	return mapExerciseTranslation(raw);
}
