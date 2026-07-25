import type {
	EditSuggestion,
	ExerciseSubmission,
	ExerciseTranslation,
	ModerationStatus
} from '$lib/types';
import { apiClient } from '$lib/api/client';
import {
	mapEditSuggestion,
	mapExerciseSubmission,
	mapExerciseTranslation,
	type RawEditSuggestion,
	type RawExerciseSubmission,
	type RawExerciseTranslation
} from '$lib/api/mappers';

export interface ModerationQueue {
	exerciseSubmissions: ExerciseSubmission[];
	editSuggestions: EditSuggestion[];
	translations: ExerciseTranslation[];
}

export async function getModerationQueue(): Promise<ModerationQueue> {
	const raw = await apiClient.get<{
		submissions: RawExerciseSubmission[];
		edit_suggestions: RawEditSuggestion[];
		translations: RawExerciseTranslation[];
	}>('/moderation/queue/');
	return {
		exerciseSubmissions: raw.submissions.map(mapExerciseSubmission),
		editSuggestions: raw.edit_suggestions.map(mapEditSuggestion),
		translations: raw.translations.map(mapExerciseTranslation)
	};
}

// `reviewerId` stays a parameter for call-site compatibility — the backend attributes the decision
// to whoever the auth token belongs to (moderation/views.py's ModerationActionView sets
// `reviewed_by = request.user` directly), and separately enforces (IsModerator) that only a real
// moderator's own token can reach this endpoint at all, so a caller can't decide as someone else
// even by passing a different id here.
async function decide(
	kind: 'submission' | 'edit' | 'translation',
	id: string,
	status: ModerationStatus,
	note?: string
) {
	const decision = status === 'approved' ? 'approve' : 'reject';
	await apiClient.post(`/moderation/${kind}/${encodeURIComponent(id)}/${decision}/`, {
		review_note: note?.trim() || ''
	});
}

export async function decideExerciseSubmission(
	id: string,
	status: ModerationStatus,
	_reviewerId: string,
	note?: string
): Promise<void> {
	await decide('submission', id, status, note);
}

export async function decideEditSuggestion(
	id: string,
	status: ModerationStatus,
	_reviewerId: string,
	note?: string
): Promise<void> {
	await decide('edit', id, status, note);
}

export async function decideTranslation(
	id: string,
	status: ModerationStatus,
	_reviewerId: string,
	note?: string
): Promise<void> {
	await decide('translation', id, status, note);
}
