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
	courseId: string;
	submittedByUserId: string;
	draft: ExerciseSubmissionDraft;
	status: ModerationStatus;
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
	resultingExerciseId?: string;
}

export type EditableField = 'title' | 'statement' | 'hint' | 'answer' | 'solution';

/** A proposed change to ONE field of an existing exercise's translation. */
export interface EditSuggestion {
	id: string;
	exerciseId: string;
	locale: string;
	field: EditableField;
	proposedValue: string;
	reason?: string;
	submittedByUserId: string;
	status: ModerationStatus;
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
}
