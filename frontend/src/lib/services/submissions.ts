import type { ExerciseSubmission, ExerciseSubmissionDraft } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapExerciseSubmission, type RawExerciseSubmission } from '$lib/api/mappers';

// `submittedByUserId` stays a parameter for call-site compatibility — the backend attributes the
// submission to whoever the auth token belongs to (ExerciseSubmission.submitted_by = request.user).
// `draft` is sent AS-IS as the submission's own `payload` JSON field — moderation/views.py's
// `_apply_submission` reads it back in this exact camelCase shape when a moderator approves it, so
// there's no snake_case<->camelCase translation needed on either side of this particular field.
export async function submitExercise(
	branchId: string,
	_submittedByUserId: string,
	draft: ExerciseSubmissionDraft
): Promise<ExerciseSubmission> {
	const raw = await apiClient.post<RawExerciseSubmission>('/exercise-submissions/', {
		branch: branchId,
		payload: draft
	});
	return mapExerciseSubmission(raw);
}

export async function getExerciseSubmissionsForBranch(
	branchId: string
): Promise<ExerciseSubmission[]> {
	const raw = await apiClient.get<RawExerciseSubmission[]>(
		`/exercise-submissions/?branch=${encodeURIComponent(branchId)}`
	);
	return raw.map(mapExerciseSubmission);
}

/** Everything the signed-in account has sent through `/submit`, newest first — pending, accepted
 * and rejected alike, with the moderator's reason on a rejected one (`/submit/mine`, WP14a).
 * `mine=1` matters only to staff, who otherwise list the whole queue here. */
export async function getMyExerciseSubmissions(locale: string): Promise<ExerciseSubmission[]> {
	const raw = await apiClient.get<RawExerciseSubmission[]>(
		`/exercise-submissions/?mine=1&lang=${encodeURIComponent(locale)}`
	);
	return raw.map(mapExerciseSubmission);
}
