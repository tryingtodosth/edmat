/**
 * Types for the personal work dashboard (work/ app, MANAGEMENT-BRIEF.md §3.F).
 */

import type { NodeRef } from './node';

/**
 * Every `kind` a provider may yield. Each has a declared set of status codes —
 * `backend/work/providers.py: STATUS_CODES`, mirrored in `lib/utils/labels.ts: WORK_STATUS_CODES`.
 */
export type WorkKind =
	| 'event'
	| 'course_request'
	| 'proposal'
	| 'shift'
	| 'booking'
	| 'task'
	| 'need_application'
	| 'need_decision'
	| 'plan_step'
	| 'plan_suggestion'
	| 'poll'
	| 'cards_due'
	// `organizations/work.py` — written, not (yet) registered, so `/api/work/` never sends it today.
	| 'organization'
	// Contests (`contests/work.py`, CONTESTS-BRIEF.md §3.B): a registration to decide, a
	// submission to score, a complaint to answer, a stage about to open. Four kinds and four
	// SECTIONS — the same vocabulary, which is what lets `work/builtin.py` register them with a
	// one-line filter each.
	| 'contest_registration'
	| 'contest_judging'
	| 'contest_complaint'
	| 'contest_stage';

/**
 * A single work item from a provider. Every item has exactly these eight keys
 * (`backend/work/providers.py: ITEM_KEYS`).
 */
export interface WorkItem {
	kind: WorkKind;
	title: string;
	url: string; // a FRONTEND path like '/events/12'
	due_at: string | null; // ISO timestamp or null
	/** A CODE, never words: one of `WORK_STATUS_CODES[kind]` ('pending', 'due', 'todo'…). Draw it
	 *  with `workStatusLabel(kind, status, count)`, never verbatim — until 2026-10-14 `/work`
	 *  printed it as-is and a Polish reader got `in_progress` and `3 due`. */
	status: string;
	/** How many things the row stands for ('3 cards', '2 requests'), for the kinds in
	 *  `WORK_COUNTED_KINDS`; null for every other kind. */
	count: number | null;
	urgency: 0 | 1 | 2 | 3; // 0 = none, 1 = this month, 2 = this week, 3 = overdue/today
	node: NodeRef | null;
}

/**
 * A section of the work dashboard.
 */
export interface WorkSection {
	key: string;
	items: WorkItem[];
}

/**
 * The complete work dashboard response.
 */
export interface WorkDashboard {
	sections: WorkSection[];
	unavailable: string[]; // provider keys that raised
	generated_at: string; // ISO timestamp
}
