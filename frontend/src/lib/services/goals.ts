// `goals` — the only place this app knows how to talk to backend/goals/. Components and routes
// never fetch (frontend/CLAUDE.md's layer boundary); `apiClient` is the one fetch. Hand-written
// snake_case <-> camelCase mapping, like every other service here, so a field rename breaks in
// exactly one file.
//
// There is no `getGoals()`: a goal has no site-wide board, because "740 exercises with verified
// solutions" means nothing without the body that said it. Every read is through a node or by id.

import { getLocale } from '$lib/paraglide/runtime';
import { apiClient } from '$lib/api/client';
import { mapLanguageReading, mapTextVersions } from '$lib/services/textVersions';
import type { NodeKind, NodeRef } from '$lib/types/node';
import type { Goal, GoalCriterion, GoalDraft, GoalPerson } from '$lib/types/goal';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPerson(raw: any): GoalPerson | null {
	if (!raw) return null;
	return { id: String(raw.id), displayName: raw.display_name ?? '' };
}

function mapNode(raw: any): NodeRef | null {
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

function mapCriterion(raw: any): GoalCriterion {
	return {
		id: String(raw.id),
		text: raw.text ?? '',
		order: raw.order ?? 0,
		isMet: raw.is_met ?? false,
		metAt: raw.met_at ?? null,
		metBy: mapPerson(raw.met_by),
		createdAt: raw.created_at ?? '',
		language: mapLanguageReading(raw.language),
		textVersions: mapTextVersions(raw.text_versions)
	};
}

function mapGoal(raw: any): Goal {
	return {
		id: String(raw.id),
		node: mapNode(raw.node),
		title: raw.title ?? '',
		description: raw.description ?? '',
		status: raw.status ?? 'open',
		order: raw.order ?? 0,
		criteria: (raw.criteria ?? []).map(mapCriterion),
		criteriaMetCount: raw.criteria_met_count ?? 0,
		criteriaCount: raw.criteria_count ?? 0,
		createdBy: mapPerson(raw.created_by),
		metBy: mapPerson(raw.met_by),
		metAt: raw.met_at ?? null,
		createdAt: raw.created_at ?? '',
		updatedAt: raw.updated_at ?? '',
		canEdit: raw.can_edit ?? false,
		canTick: raw.can_tick ?? false,
		language: mapLanguageReading(raw.language),
		textVersions: mapTextVersions(raw.text_versions)
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** On every read — the `services/needs.ts` pattern. Without it the backend's `request_locale`
 *  falls back to 'pl' and an English reader silently gets the Polish (translations/, 2026-10-08). */
function langQuery(): string {
	return `?lang=${encodeURIComponent(getLocale())}`;
}

/** The goals of one node, for `GoalsPanel` — everything, because a goal is public on a node you
 *  can view (`backend/goals/rules.py`). */
export async function getNodeGoals(kind: NodeKind, nodeId: string): Promise<Goal[]> {
	const raw = await apiClient.get<unknown[]>(`/nodes/${kind}/${nodeId}/goals/${langQuery()}`);
	return raw.map(mapGoal);
}

export async function getGoal(id: string): Promise<Goal> {
	return mapGoal(await apiClient.get(`/goals/${id}/${langQuery()}`));
}

/** Node-manager only — stating what a body is trying to achieve is running it. */
export async function createGoal(kind: NodeKind, nodeId: string, draft: GoalDraft): Promise<Goal> {
	return mapGoal(
		await apiClient.post(`/nodes/${kind}/${nodeId}/goals/`, {
			title: draft.title,
			description: draft.description
		})
	);
}

/** Title, description, order — and `status`, which may only become `abandoned` or (from there)
 *  `open`. Asking for `met` is refused by the server with its reason: ticking the criteria is how
 *  a goal becomes met, which is the whole feature. */
export async function updateGoal(
	id: string,
	changes: Partial<GoalDraft> & { status?: 'open' | 'abandoned'; order?: number }
): Promise<Goal> {
	const body: Record<string, unknown> = {};
	if (changes.title !== undefined) body.title = changes.title;
	if (changes.description !== undefined) body.description = changes.description;
	if (changes.status !== undefined) body.status = changes.status;
	if (changes.order !== undefined) body.order = changes.order;
	return mapGoal(await apiClient.patch(`/goals/${id}/${langQuery()}`, body));
}

/** Only a goal nobody has relied on — the server answers 409 `has_work` or `has_comments`
 * otherwise, and abandoning is what to do with those (`backend/goals/rules.py`). */
export async function deleteGoal(id: string): Promise<void> {
	await apiClient.delete(`/goals/${id}/`);
}

export async function addCriterion(goalId: string, text: string): Promise<GoalCriterion> {
	return mapCriterion(await apiClient.post(`/goals/${goalId}/criteria/${langQuery()}`, { text }));
}

export async function updateCriterion(id: string, text: string): Promise<GoalCriterion> {
	return mapCriterion(await apiClient.patch(`/goal-criteria/${id}/${langQuery()}`, { text }));
}

export async function removeCriterion(id: string): Promise<void> {
	await apiClient.delete(`/goal-criteria/${id}/`);
}

/** Ticking the last open line is what makes the goal `met`, so the server sends the goal back with
 *  the criterion — a client that had to re-fetch would draw a stale "open" for a moment. */
export async function setCriterionMet(
	id: string,
	met: boolean
): Promise<{ criterion: GoalCriterion; goal: Goal }> {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const raw: any = met
		? await apiClient.post(`/goal-criteria/${id}/tick/${langQuery()}`, {})
		: await apiClient.delete(`/goal-criteria/${id}/tick/${langQuery()}`);
	/* eslint-enable @typescript-eslint/no-explicit-any */
	return { criterion: mapCriterion(raw.criterion), goal: mapGoal(raw.goal) };
}

/** The whole list of criterion ids in the order wanted — the server refuses a partial list, which
 *  would silently renumber the lines it did not mention. */
export async function reorderCriteria(goalId: string, ids: string[]): Promise<Goal> {
	return mapGoal(
		await apiClient.post(`/goals/${goalId}/reorder/${langQuery()}`, { ids: ids.map(Number) })
	);
}
