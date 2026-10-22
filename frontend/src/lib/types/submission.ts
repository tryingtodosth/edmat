import type { Audience } from './audience';
import type { Licence } from './licence';
import type { Difficulty, ExerciseSource } from './exercise';
import type { ExerciseLinkRole } from './exerciseMaterialLink';

export type ModerationStatus = 'pending' | 'approved' | 'rejected';

/** A brand-new exercise, pending review before it becomes a real Exercise + ExerciseTranslation. */
export interface ExerciseSubmissionDraft {
	title: string;
	topicIds: string[];
	difficulty: Difficulty;
	audience: Audience;
	/** The licence the author chose (backend licensing/) — carried onto the exercise and its
	 *  founding hint/solution on approval. Absent means `edmat-only`; `unknown` is refused. */
	licence?: Licence;
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
	// What a BULK upload's draft carries beside the form's keys (backend `exercises/bulk.py`,
	// 2026-10-22) — the queue reads them to say where a row came from and what it holds.
	parts?: { label: string; statement: string; answer: string; hint: string; solution: string }[];
	ai_assisted?: boolean;
	bulk?: { batch: string; file: string };
}

export interface ExerciseSubmission {
	id: string;
	branchId: string;
	/** The branch's name in the reader's language (the backend's `branch_name`, WP14a). Absent on a
	 *  payload from before it existed; the slug is the honest fallback. */
	branchName?: string;
	submittedByUserId: string;
	draft: ExerciseSubmissionDraft;
	status: ModerationStatus;
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
	resultingExerciseId?: string;
	/** The bulk upload this came in with (`ExerciseSubmission.upload_batch`); absent for `/submit`. */
	uploadBatch?: string;
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
	/** The part of a set-shaped exercise whose statement/answer this changes; absent = the
	 * exercise's own text (`SUBEXERCISES-BRIEF.md` §2). */
	partId?: string;
	proposedValue: string;
	reason?: string;
	submittedByUserId: string;
	status: ModerationStatus;
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
}
