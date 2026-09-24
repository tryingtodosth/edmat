// Tasks — mirrors `backend/tasks/` one to one (MANAGEMENT-BRIEF.md §3.B).
//
// The only place this app talks to the task API. Components and routes never fetch
// (frontend/CLAUDE.md's layer boundary); `apiClient` is the one `fetch()`.
//
// **One GET powers the whole panel.** A task arrives with its subtasks folded under it, its
// assignees, its recounted `progress`, its `isOverdue` and its two `can*` answers — so a disabled
// button never has to ask a second endpoint why it is disabled, and a board and a detail page can
// never disagree about the same row.
//
// A refusal comes back as an `ApiError` whose body carries `reason` — one of `TaskBlockReason`.
// `reasonOf` below is how a caller reads it; `TASK_BLOCK_REASON_LABELS` (utils/labels.ts) has the
// sentence.

import { ApiError, apiClient } from '$lib/api/client';
import type { NodeKind, NodeRef } from '$lib/types/node';
import type {
	MyTasks,
	Task,
	TaskAssignee,
	TaskBlockReason,
	TaskDraft,
	TaskPerson,
	TaskPriority,
	TaskStatus
} from '$lib/types/task';

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapPerson(raw: any): TaskPerson {
	return { id: String(raw?.id ?? ''), displayName: raw?.display_name ?? '' };
}

function mapAssignee(raw: any): TaskAssignee {
	return {
		id: String(raw.id),
		user: mapPerson(raw.user),
		assignedBy: raw.assigned_by ? mapPerson(raw.assigned_by) : null,
		assignedAt: raw.assigned_at
	};
}

function mapNode(raw: any): NodeRef | null {
	if (!raw) return null;
	return {
		kind: raw.kind,
		id: String(raw.id),
		title: raw.title ?? '',
		isStaff: raw.is_staff ?? false,
		isMember: raw.is_member ?? false,
		canManage: raw.can_manage ?? false
	};
}

function mapTask(raw: any): Task {
	return {
		id: String(raw.id),
		node: mapNode(raw.node),
		title: raw.title ?? '',
		description: raw.description ?? '',
		status: raw.status as TaskStatus,
		priority: (raw.priority ?? 3) as TaskPriority,
		dueAt: raw.due_at ?? null,
		parentId: raw.parent === null || raw.parent === undefined ? null : String(raw.parent),
		order: raw.order ?? 0,
		createdBy: mapPerson(raw.created_by),
		createdAt: raw.created_at,
		updatedAt: raw.updated_at,
		doneAt: raw.done_at ?? null,
		assignees: (raw.assignees ?? []).map(mapAssignee),
		subtasks: (raw.subtasks ?? []).map(mapTask),
		progress: { done: raw.progress?.done ?? 0, total: raw.progress?.total ?? 0 },
		isOverdue: raw.is_overdue ?? false,
		canEdit: raw.can_edit ?? false,
		canAssign: raw.can_assign ?? false
	};
}

function toPayload(draft: TaskDraft): Record<string, unknown> {
	const payload: Record<string, unknown> = { title: draft.title };
	if (draft.description !== undefined) payload.description = draft.description;
	if (draft.priority !== undefined) payload.priority = draft.priority;
	// `null` is a real value here — it clears a due date — so `undefined` is the only thing skipped.
	if (draft.dueAt !== undefined) payload.due_at = draft.dueAt;
	if (draft.order !== undefined) payload.order = draft.order;
	return payload;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The backend's own word for a refusal, or null if this was not one (house rule 6). */
export function reasonOf(error: unknown): TaskBlockReason | null {
	if (!(error instanceof ApiError)) return null;
	const body = error.body as { reason?: string } | null;
	return (body?.reason as TaskBlockReason) ?? null;
}

export interface TaskFilters {
	status?: TaskStatus;
	/** Only tasks I am on. The backend narrows TOP-LEVEL rows, so a subtask of mine travels with
	 *  its parent rather than being promoted. */
	assignedToMe?: boolean;
	overdue?: boolean;
}

function query(filters?: TaskFilters): string {
	if (!filters) return '';
	const params = new URLSearchParams();
	if (filters.status) params.set('status', filters.status);
	if (filters.assignedToMe) params.set('assignee', 'me');
	if (filters.overdue) params.set('overdue', '1');
	const text = params.toString();
	return text ? `?${text}` : '';
}

/** The board of one node. 404 (thrown) means "not for you" as much as "does not exist" — house
 *  rule 4: only the node's own staff ever see a task board. */
export async function getNodeTasks(
	kind: NodeKind,
	id: string,
	filters?: TaskFilters
): Promise<Task[]> {
	const raw = await apiClient.get<unknown>(`/nodes/${kind}/${id}/tasks/${query(filters)}`);
	return (Array.isArray(raw) ? raw : []).map(mapTask);
}

export async function createNodeTask(kind: NodeKind, id: string, draft: TaskDraft): Promise<Task> {
	return mapTask(await apiClient.post(`/nodes/${kind}/${id}/tasks/`, toPayload(draft)));
}

export async function getTask(id: string): Promise<Task> {
	return mapTask(await apiClient.get(`/tasks/${id}/`));
}

export async function updateTask(id: string, draft: Partial<TaskDraft>): Promise<Task> {
	return mapTask(await apiClient.patch(`/tasks/${id}/`, toPayload(draft as TaskDraft)));
}

export async function deleteTask(id: string): Promise<void> {
	await apiClient.delete(`/tasks/${id}/`);
}

/** The only way `status` ever moves — a PATCH cannot set it, by design. */
export async function transitionTask(id: string, status: TaskStatus): Promise<Task> {
	return mapTask(await apiClient.post(`/tasks/${id}/transition/`, { status }));
}

export async function assignTask(id: string, userId: string): Promise<Task> {
	return mapTask(await apiClient.post(`/tasks/${id}/assign/`, { user: Number(userId) }));
}

export async function unassignTask(id: string, userId: string): Promise<Task> {
	return mapTask(await apiClient.post(`/tasks/${id}/unassign/`, { user: Number(userId) }));
}

export async function createSubtask(parentId: string, draft: TaskDraft): Promise<Task> {
	return mapTask(await apiClient.post(`/tasks/${parentId}/subtasks/`, toPayload(draft)));
}

/** `/tasks` — two lists, and nothing appears in both. */
export async function getMyTasks(): Promise<MyTasks> {
	const raw = await apiClient.get<{ assigned?: unknown[]; created?: unknown[] }>('/tasks/mine/');
	return {
		assigned: (raw?.assigned ?? []).map(mapTask),
		created: (raw?.created ?? []).map(mapTask)
	};
}
