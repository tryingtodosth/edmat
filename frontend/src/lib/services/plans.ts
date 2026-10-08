// Plans — the only place this app knows how to talk to backend/plans/ (MANAGEMENT-BRIEF.md §3.D).
// Components and routes never fetch (frontend/CLAUDE.md's layer boundary); `apiClient` is the one
// fetch. Hand-written snake_case ↔ camelCase mapping, like every other service here, so a field
// rename breaks in exactly one file.

import { getLocale } from '$lib/paraglide/runtime';
import { apiClient } from '$lib/api/client';
import { mapLanguageReading, mapTextVersions } from '$lib/services/textVersions';
import type { NodeKind, NodeRef } from '$lib/types/node';
import type {
	Plan,
	PlanBlockReason,
	PlanDraft,
	PlanStep,
	PlanStepDraft,
	PlanSuggestion
} from '$lib/types/plan';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapNodeRef(raw: any): NodeRef | null {
	if (!raw) return null;
	return {
		kind: raw.kind,
		id: String(raw.id),
		title: raw.title ?? '',
		isStaff: raw.is_staff ?? false,
		isMember: raw.is_member ?? false,
		canManage: raw.can_manage ?? false,
		openBoard: raw.open_board ?? false,
		// An organisation's route is its slug (`utils/nodeHref.ts`); the other kinds send none.
		...(raw.slug ? { slug: String(raw.slug) } : {})
	};
}

function mapStep(raw: any): PlanStep {
	return {
		id: String(raw.id),
		planId: String(raw.plan ?? ''),
		parentId: raw.parent != null ? String(raw.parent) : null,
		title: raw.title ?? '',
		description: raw.description ?? '',
		order: raw.order ?? 0,
		status: raw.status ?? 'pending',
		dueAt: raw.due_at ?? null,
		doneById: raw.done_by != null ? String(raw.done_by) : null,
		doneByName: raw.done_by_name ?? '',
		doneAt: raw.done_at ?? null,
		substeps: Array.isArray(raw.substeps) ? raw.substeps.map(mapStep) : [],
		language: mapLanguageReading(raw.language),
		textVersions: mapTextVersions(raw.text_versions)
	};
}

function mapPlan(raw: any): Plan {
	return {
		id: String(raw.id),
		node: mapNodeRef(raw.node),
		title: raw.title ?? '',
		description: raw.description ?? '',
		status: raw.status ?? 'draft',
		createdById: raw.created_by != null ? String(raw.created_by) : null,
		createdByName: raw.created_by_name ?? '',
		createdAt: raw.created_at ?? '',
		updatedAt: raw.updated_at ?? '',
		steps: Array.isArray(raw.steps) ? raw.steps.map(mapStep) : [],
		progress: {
			done: raw.progress?.done ?? 0,
			total: raw.progress?.total ?? 0,
			skipped: raw.progress?.skipped ?? 0,
			percent: raw.progress?.percent ?? 0
		},
		// The goal this is work towards (`goals/`, 2026-10-08). `null` rather than `''` so "no goal"
		// and "a goal whose title is empty" stay different things.
		goal: raw.goal === null || raw.goal === undefined ? null : String(raw.goal),
		goalTitle: raw.goal_title ?? '',
		canEdit: raw.can_edit ?? false,
		suggestBlockReason: (raw.suggest_block_reason ?? null) as PlanBlockReason | null,
		language: mapLanguageReading(raw.language),
		textVersions: mapTextVersions(raw.text_versions)
	};
}

function mapSuggestion(raw: any): PlanSuggestion {
	return {
		id: String(raw.id),
		planId: String(raw.plan ?? ''),
		userId: String(raw.user ?? ''),
		userName: raw.user_name ?? '',
		text: raw.text ?? '',
		status: raw.status ?? 'pending',
		decidedById: raw.decided_by != null ? String(raw.decided_by) : null,
		decidedByName: raw.decided_by_name ?? '',
		decidedAt: raw.decided_at ?? null,
		createdStepId: raw.created_step != null ? String(raw.created_step) : null,
		createdAt: raw.created_at ?? ''
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** `?lang=<interface locale>` on every read — the `services/taxonomy.ts` pattern. Without it the
 *  backend's `request_locale` falls back to 'pl' and an English reader silently gets the Polish
 *  (translations/, 2026-10-08). */
function langQuery(): string {
	return `?lang=${encodeURIComponent(getLocale())}`;
}

export async function getNodePlans(kind: NodeKind, nodeId: string): Promise<Plan[]> {
	const raw = await apiClient.get<unknown[]>(`/nodes/${kind}/${nodeId}/plans/${langQuery()}`);
	return raw.map(mapPlan);
}

export async function createPlan(kind: NodeKind, nodeId: string, draft: PlanDraft): Promise<Plan> {
	return mapPlan(
		await apiClient.post(`/nodes/${kind}/${nodeId}/plans/`, {
			title: draft.title,
			description: draft.description ?? ''
		})
	);
}

export async function getPlan(planId: string): Promise<Plan> {
	return mapPlan(await apiClient.get(`/plans/${planId}/${langQuery()}`));
}

export async function updatePlan(
	planId: string,
	patch: { title?: string; description?: string }
): Promise<Plan> {
	return mapPlan(await apiClient.patch(`/plans/${planId}/`, patch));
}

/** Which goal this roadmap is work towards — `null` clears it (`goals/`, 2026-10-08). The plan's
 * own `partial_update` takes it beside title and description, and refuses a goal hanging off
 * another node with `other_node`. */
export async function setPlanGoal(planId: string, goalId: string | null): Promise<Plan> {
	return mapPlan(
		await apiClient.patch(`/plans/${planId}/`, { goal: goalId ? Number(goalId) : null })
	);
}

export async function deletePlan(planId: string): Promise<void> {
	await apiClient.delete(`/plans/${planId}/`);
}

export async function transitionPlan(planId: string, status: string): Promise<Plan> {
	return mapPlan(await apiClient.post(`/plans/${planId}/transition/`, { status }));
}

export async function addPlanStep(planId: string, draft: PlanStepDraft): Promise<PlanStep> {
	return mapStep(
		await apiClient.post(`/plans/${planId}/steps/`, {
			title: draft.title,
			description: draft.description ?? '',
			due_at: draft.dueAt ?? null,
			parent: draft.parentId ?? null
		})
	);
}

export async function updatePlanStep(
	stepId: string,
	patch: { title?: string; description?: string; status?: string; dueAt?: string | null }
): Promise<PlanStep> {
	return mapStep(
		await apiClient.patch(`/plan-steps/${stepId}/`, {
			...(patch.title !== undefined ? { title: patch.title } : {}),
			...(patch.description !== undefined ? { description: patch.description } : {}),
			...(patch.status !== undefined ? { status: patch.status } : {}),
			...(patch.dueAt !== undefined ? { due_at: patch.dueAt } : {})
		})
	);
}

export async function deletePlanStep(stepId: string): Promise<void> {
	await apiClient.delete(`/plan-steps/${stepId}/`);
}

/** Reorders one complete group: the plan's top-level steps (`parentId` omitted), or one step's
 * sub-steps (`parentId` given) — `plans/rules.py: reorder()`. Returns the whole plan, since a
 * reorder can touch any of its steps. */
export async function reorderPlanSteps(
	planId: string,
	ids: string[],
	parentId?: string | null
): Promise<Plan> {
	return mapPlan(
		await apiClient.post(`/plans/${planId}/reorder/`, {
			ids: ids.map(Number),
			...(parentId ? { parent: Number(parentId) } : {})
		})
	);
}

export async function getPlanSuggestions(planId: string): Promise<PlanSuggestion[]> {
	const raw = await apiClient.get<unknown[]>(`/plans/${planId}/suggestions/`);
	return raw.map(mapSuggestion);
}

export async function suggestOnPlan(planId: string, text: string): Promise<PlanSuggestion> {
	return mapSuggestion(await apiClient.post(`/plans/${planId}/suggestions/`, { text }));
}

export async function decidePlanSuggestion(
	suggestionId: string,
	decision: 'accept' | 'reject'
): Promise<PlanSuggestion> {
	return mapSuggestion(
		await apiClient.post(`/plan-suggestions/${suggestionId}/decide/`, { decision })
	);
}

export async function withdrawPlanSuggestion(suggestionId: string): Promise<PlanSuggestion> {
	return mapSuggestion(await apiClient.post(`/plan-suggestions/${suggestionId}/withdraw/`));
}
