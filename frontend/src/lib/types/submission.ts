import type { Audience } from './audience';
import type { Difficulty, ExerciseSource } from './exercise';
import type { ExerciseLinkRole } from './exerciseMaterialLink';

export type ModerationStatus = 'pending' | 'approved' | 'rejected';

/** A brand-new exercise, pending review before it becomes a real Exercise + ExerciseTranslation. */
export interface ExerciseSubmissionDraft {
	title: string;
	topicIds: string[];
	difficulty: Difficulty;
	audience: Audience;
	source: ExerciseSource;
	tags: string[];
	// Free-text prerequisite/"skill tag" labels — optional, applied into real ExerciseRequirement
	// rows on approval (moderation/views.py's `_apply_submission`), the same draft shape a material
	// project's catalogue `requirements` uses before its first publication.
	requirements?: string[];
	// "Add an exercise to this material" (`/submit?material=<id>`) — which material this exercise
	// belongs to, turned into a real `ExerciseMaterialLink` the instant the exercise exists
	// (moderation/views.py's `_apply_submission`). Absent for every submission made the ordinary
	// way, which is almost all of them.
	//
	// **snake_case on purpose, unlike the rest of this draft.** The payload is a JSON blob the
	// backend reads BY NAME, and these three names are owned by `backend/exercises/links.py` —
	// which also accepts the camelCase spellings, exactly as `_apply_submission` already accepts
	// `topicIds` beside `topic_ids`. Spelling them the way the backend documents them is what keeps
	// a reader of either side able to grep for the other.
	material_id?: number;
	material_role?: ExerciseLinkRole;
	material_locator?: string;
	statement: string;
	hint: string;
	answer: string;
	solution: string;
	locale: string;
}

export interface ExerciseSubmission {
	id: string;
	branchId: string;
	submittedByUserId: string;
	draft: ExerciseSubmissionDraft;
	status: ModerationStatus;
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
	resultingExerciseId?: string;
}

// hint/solution are no longer translation fields — an edit to one targets its SolutionEntry row
// (`entryId` below) with field 'body' instead.
export type EditableField = 'title' | 'statement' | 'answer' | 'body';

/** A proposed change to ONE field of an existing exercise's translation — or, when `entryId` is
 * set, to a solution/hint entry's own body (decided by the entry's author/staff/governors, not by
 * the moderation queue's usual circle). */
export interface EditSuggestion {
	id: string;
	exerciseId: string;
	locale: string;
	field: EditableField;
	entryId?: string;
	proposedValue: string;
	reason?: string;
	submittedByUserId: string;
	status: ModerationStatus;
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
}
