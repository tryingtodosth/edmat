// A plan — a roadmap hung off a node, mirrors `backend/plans/models.py` one-to-one
// (MANAGEMENT-BRIEF.md §3.D).

import type { NodeRef } from './node';

/** One field, never a pair of booleans (root CLAUDE.md). `draft` is visible only to the node's own
 * managers; `active` is what makes it readable by anyone who can see the node at all, and openable
 * to suggestions; `completed`/`archived` are terminal-ish (archived is truly terminal). */
export type PlanStatus = 'draft' | 'active' | 'completed' | 'archived';

/** `pending` → `in_progress` → `done`, or `skipped` at any point — a step's own small lifecycle,
 * independent of the plan's. */
export type PlanStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export type PlanSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

/** Why an action was refused — `plans/rules.py`'s constants, one sentence each in
 * `utils/labels.ts` (house rule 6: a refusal carries its reason). */
export type PlanBlockReason =
	| 'not_editor'
	| 'not_active'
	| 'minor'
	| 'own_plan'
	| 'steps_pending'
	| 'already_decided'
	| 'illegal_transition'
	| 'nested'
	| 'not_draft'
	| 'not_own_suggestion';

export interface PlanProgress {
	done: number;
	total: number;
	skipped: number;
	/** Done over (total − skipped), rounded — `plans/rules.py: progress()`, recounted server-side
	 * on every read, never a stored tally (house rule 5). */
	percent: number;
}

export interface PlanStep {
	id: string;
	planId: string;
	/** `null` for a top-level step; a step whose own `parentId` is set never has substeps of its
	 * own — ONE level, everywhere (MANAGEMENT-BRIEF.md §3.D). */
	parentId: string | null;
	title: string;
	description: string;
	order: number;
	status: PlanStepStatus;
	dueAt: string | null;
	doneById: string | null;
	doneByName: string;
	doneAt: string | null;
	substeps: PlanStep[];
}

export interface Plan {
	id: string;
	node: NodeRef | null;
	title: string;
	description: string;
	status: PlanStatus;
	createdById: string | null;
	createdByName: string;
	createdAt: string;
	updatedAt: string;
	/** Only the plan's TOP-LEVEL steps — each carries its own `substeps`. */
	steps: PlanStep[];
	progress: PlanProgress;
	/** `plans/rules.py: can_edit()`, computed server-side — the node's manager, or the plan's own
	 * creator. Never re-derived client-side (house rule: a rule more than one endpoint needs lives
	 * in one module). */
	canEdit: boolean;
	/** `plans/rules.py: suggest_block_reason()` for THIS reader, or `null` meaning the suggestion
	 * box is open. */
	suggestBlockReason: PlanBlockReason | null;
}

export interface PlanSuggestion {
	id: string;
	planId: string;
	userId: string;
	userName: string;
	text: string;
	status: PlanSuggestionStatus;
	decidedById: string | null;
	decidedByName: string;
	decidedAt: string | null;
	/** Set only once accepted — the step the suggestion became. */
	createdStepId: string | null;
	createdAt: string;
}

export interface PlanDraft {
	title: string;
	description?: string;
}

export interface PlanStepDraft {
	title: string;
	description?: string;
	dueAt?: string | null;
	/** A step id — omit for a top-level step. */
	parentId?: string | null;
}
