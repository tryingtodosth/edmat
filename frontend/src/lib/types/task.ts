/** Tasks — mirrors `backend/tasks/` one to one (MANAGEMENT-BRIEF.md §3.B).
 *
 * A task hangs off a NODE (`lib/types/node.ts`): a course, an event, a material or an
 * organisation. It is never loaded on its own without one, because who may see it, edit it and
 * staff it is entirely a question about that node's roster — which is why `TaskDetail` carries a
 * `node` rather than a bare id.
 *
 * **`progress` and `isOverdue` arrive computed.** The backend recounts both on every read (house
 * rule 5), so nothing here derives them from the subtask array — a component that counted its own
 * `subtasks.filter(done)` would answer differently the moment a subtask was filtered out of the
 * response for any reason.
 *
 * `TaskStatus` and `TaskPriority` are mirrored in `lib/utils/labels.ts`, which names
 * `backend/tasks/models.py` from its side (house rule 13).
 */

import type { NodeRef } from './node';

/** One `status`, never two booleans. `done` and `cancelled` are two different ends. */
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';

/** 1 is most urgent, 3 is the default. Numbers rather than words because they sort. */
export type TaskPriority = 1 | 2 | 3 | 4;

/** Why a button is disabled or a request was refused, in the backend's own words (house rule 6).
 *  `tasks/rules.py` holds the constants; `TASK_BLOCK_REASON_LABELS` has a sentence for each. */
export type TaskBlockReason =
	| 'not_manager'
	| 'not_staff'
	| 'not_allowed'
	| 'already_assigned'
	| 'not_assigned'
	| 'nested'
	| 'has_subtasks'
	| 'illegal_transition';

export interface TaskPerson {
	id: string;
	displayName: string;
}

export interface TaskAssignee {
	id: string;
	user: TaskPerson;
	/** Null when the row predates the account that made it, or was made by a migration. */
	assignedBy: TaskPerson | null;
	assignedAt: string;
}

export interface TaskProgress {
	done: number;
	total: number;
}

export interface Task {
	id: string;
	/** Null only if the node this task hangs on has been deleted underneath it. */
	node: NodeRef | null;
	title: string;
	description: string;
	status: TaskStatus;
	priority: TaskPriority;
	dueAt: string | null;
	parentId: string | null;
	order: number;
	createdBy: TaskPerson;
	createdAt: string;
	updatedAt: string;
	doneAt: string | null;
	assignees: TaskAssignee[];
	/** One level: a subtask's own `subtasks` is always empty (`409 nested` sees to that). */
	subtasks: Task[];
	progress: TaskProgress;
	isOverdue: boolean;
	/** Node manager, creator, or assignee. */
	canEdit: boolean;
	/** Node manager only — putting somebody on a task is running the thing. */
	canAssign: boolean;
}

/** `GET /api/tasks/mine/` — two lists, because they answer different questions: work waiting on
 *  me, and work I am waiting on somebody else for. Nothing appears in both. */
export interface MyTasks {
	assigned: Task[];
	created: Task[];
}

/** What a create or edit form sends. `status` is deliberately absent — it moves through
 *  `transitionTask` alone, so the guarded path is the only path. */
export interface TaskDraft {
	title: string;
	description?: string;
	priority?: TaskPriority;
	dueAt?: string | null;
	order?: number;
}

/** The order a board draws its columns in. Mirrors the lifecycle rather than the alphabet. */
export const TASK_STATUS_ORDER: TaskStatus[] = [
	'todo',
	'in_progress',
	'review',
	'done',
	'cancelled'
];

/** The forward path, plus cancel, plus a manager's reopen — mirrors
 *  `tasks/rules.py: FORWARD_TRANSITIONS` and the two rules around it. What this does NOT list is
 *  `review → in_progress`: §3.B's table has no rejection move, and the frontend does not invent
 *  one (it would simply 409). */
export function nextStatuses(task: Task): TaskStatus[] {
	// Moving a task is `can_edit` (manager, creator or assignee), so a reader with none of those
	// gets no buttons at all rather than buttons that 403.
	if (!task.canEdit) return [];
	const forward: Partial<Record<TaskStatus, TaskStatus>> = {
		todo: 'in_progress',
		in_progress: 'review',
		review: 'done'
	};
	const next = forward[task.status];
	if (next) return [next, 'cancelled'];
	// done | cancelled: only a manager may reopen, and the button is hidden rather than left to 409.
	return task.canAssign ? ['todo'] : [];
}
