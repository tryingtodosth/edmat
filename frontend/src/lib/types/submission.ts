import type { Difficulty, ExerciseSource } from './exercise';

export type ModerationStatus = 'pending' | 'approved' | 'rejected';

/** A brand-new exercise, pending review before it becomes a real Exercise + ExerciseTranslation. */
export interface ExerciseSubmissionDraft {
	title: string;
	topicIds: string[];
	difficulty: Difficulty;
	source: ExerciseSource;
	tags: string[];
	// Free-text prerequisite/"skill tag" labels — optional, applied into real ExerciseRequirement
	// rows on approval (moderation/views.py's `_apply_submission`), the same submission-time draft
	// shape MaterialSubmission.requirements already establishes for a Material.
	requirements?: string[];
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
