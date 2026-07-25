import type { EditableField, EditSuggestion } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapEditSuggestion, type RawEditSuggestion } from '$lib/api/mappers';

// `submittedByUserId` stays a parameter for call-site compatibility — the backend attributes the
// suggestion to whoever the auth token belongs to (EditSuggestion.submitted_by = request.user).
export async function submitEditSuggestion(
	exerciseId: string,
	locale: string,
	field: EditableField,
	proposedValue: string,
	_submittedByUserId: string,
	reason?: string
): Promise<EditSuggestion> {
	const raw = await apiClient.post<RawEditSuggestion>('/edit-suggestions/', {
		exercise: Number(exerciseId),
		locale,
		field,
		proposed_value: proposedValue,
		reason: reason?.trim() || ''
	});
	return mapEditSuggestion(raw);
}

export async function getEditSuggestionsForExercise(exerciseId: string): Promise<EditSuggestion[]> {
	const raw = await apiClient.get<RawEditSuggestion[]>(
		`/edit-suggestions/?exercise=${encodeURIComponent(exerciseId)}`
	);
	return raw.map(mapEditSuggestion);
}
