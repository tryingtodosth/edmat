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

// ---- suggestions against a solution/hint entry (the pool) --------------------------------------

/** Propose a change to somebody's solution/hint entry — the entry's own author (or staff/a branch
 * governor) decides it, not the moderation queue's usual circle. */
export async function submitEntryEditSuggestion(
	entryId: string,
	proposedValue: string,
	reason?: string
): Promise<EditSuggestion> {
	const raw = await apiClient.post<RawEditSuggestion>('/edit-suggestions/', {
		entry: Number(entryId),
		proposed_value: proposedValue,
		reason: reason?.trim() || ''
	});
	return mapEditSuggestion(raw);
}

/** Pending suggestions against one entry — the backend lists these to the suggester themselves,
 * the entry's author, and staff; anybody else gets an empty list. */
export async function getEditSuggestionsForEntry(entryId: string): Promise<EditSuggestion[]> {
	const raw = await apiClient.get<RawEditSuggestion[]>(
		`/edit-suggestions/?entry=${encodeURIComponent(entryId)}`
	);
	return raw.map(mapEditSuggestion);
}

export async function decideEntryEditSuggestion(
	suggestionId: string,
	decision: 'approve' | 'reject',
	note = ''
): Promise<EditSuggestion> {
	const raw = await apiClient.post<RawEditSuggestion>(
		`/edit-suggestions/${encodeURIComponent(suggestionId)}/decide/`,
		{ decision, note }
	);
	return mapEditSuggestion(raw);
}
