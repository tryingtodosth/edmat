/**
 * Types for the personal work dashboard (work/ app, MANAGEMENT-BRIEF.md §3.F).
 */

import type { NodeRef } from './node';

/**
 * A single work item from a provider.
 * Every item has exactly these seven keys.
 */
export interface WorkItem {
	kind:
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
		| 'poll';
	title: string;
	url: string; // a FRONTEND path like '/events/12'
	due_at: string | null; // ISO timestamp or null
	status: string; // the row's own status word
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
