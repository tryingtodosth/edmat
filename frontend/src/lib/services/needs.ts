// `needs` — the only place this app knows how to talk to backend/needs/. Components and routes
// never fetch (frontend/CLAUDE.md's layer boundary); `apiClient` is the one fetch. Hand-written
// snake_case <-> camelCase mapping, like every other service here, so a field rename breaks in
// exactly one file.

import { apiClient } from '$lib/api/client';
import type { NodeKind, NodeRef } from '$lib/types/node';
import type {
	Need,
	NeedApplication,
	NeedBoardFilters,
	NeedDraft,
	NeedPerson
} from '$lib/types/need';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPerson(raw: any): NeedPerson | null {
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
		canManage: raw.can_manage ?? false
	};
}

function mapNeed(raw: any): Need {
	return {
		id: String(raw.id),
		node: mapNode(raw.node),
		title: raw.title ?? '',
		description: raw.description ?? '',
		kind: raw.kind ?? 'help',
		status: raw.status ?? 'open',
		skillLevel: raw.skill_level ?? 'none',
		estimatedHours: raw.estimated_hours ?? null,
		deadline: raw.deadline ?? null,
		isRemote: raw.is_remote ?? false,
		wantedCount: raw.wanted_count ?? 1,
		acceptedCount: raw.accepted_count ?? 0,
		createdBy: mapPerson(raw.created_by),
		createdAt: raw.created_at ?? '',
		updatedAt: raw.updated_at ?? ''
	};
}

function mapApplication(raw: any): NeedApplication {
	return {
		id: String(raw.id),
		needId: String(raw.need ?? ''),
		user: mapPerson(raw.user) as NeedPerson,
		message: raw.message ?? '',
		status: raw.status ?? 'pending',
		decidedBy: mapPerson(raw.decided_by),
		decidedAt: raw.decided_at ?? null,
		createdAt: raw.created_at ?? ''
	};
}

function draftBody(draft: Partial<NeedDraft>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (draft.title !== undefined) body.title = draft.title;
	if (draft.description !== undefined) body.description = draft.description;
	if (draft.kind !== undefined) body.kind = draft.kind;
	if (draft.skillLevel !== undefined) body.skill_level = draft.skillLevel;
	if (draft.estimatedHours !== undefined) body.estimated_hours = draft.estimatedHours;
	if (draft.deadline !== undefined) body.deadline = draft.deadline;
	if (draft.isRemote !== undefined) body.is_remote = draft.isRemote;
	if (draft.wantedCount !== undefined) body.wanted_count = draft.wantedCount;
	return body;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function boardQuery(filters: NeedBoardFilters): string {
	const params = new URLSearchParams();
	if (filters.kind) params.set('kind', filters.kind);
	if (filters.remote) params.set('remote', '1');
	if (filters.q) params.set('q', filters.q);
	if (filters.nodeKind) params.set('node_kind', filters.nodeKind);
	const query = params.toString();
	return query ? `?${query}` : '';
}

/** The public board (`GET /api/needs/`) — open needs on nodes the reader can view, plus a node
 * manager's own non-open ones. */
export async function getNeeds(filters: NeedBoardFilters = {}): Promise<Need[]> {
	const raw = await apiClient.get<unknown[]>(`/needs${boardQuery(filters)}`);
	return raw.map(mapNeed);
}

export async function getNeed(id: string): Promise<Need> {
	return mapNeed(await apiClient.get(`/needs/${id}/`));
}

/** The needs of one node — course, event or material — for `NeedsPanel`. */
export async function getNodeNeeds(kind: NodeKind, nodeId: string): Promise<Need[]> {
	const raw = await apiClient.get<unknown[]>(`/nodes/${kind}/${nodeId}/needs/`);
	return raw.map(mapNeed);
}

/** Node-manager only — creating a need is running the node, not volunteering for it. */
export async function createNeed(kind: NodeKind, nodeId: string, draft: NeedDraft): Promise<Need> {
	return mapNeed(await apiClient.post(`/nodes/${kind}/${nodeId}/needs/`, draftBody(draft)));
}

export async function updateNeed(id: string, draft: Partial<NeedDraft>): Promise<Need> {
	return mapNeed(await apiClient.patch(`/needs/${id}/`, draftBody(draft)));
}

export async function cancelNeed(id: string): Promise<Need> {
	return mapNeed(await apiClient.patch(`/needs/${id}/`, { status: 'cancelled' }));
}

export async function reopenNeed(id: string): Promise<Need> {
	return mapNeed(await apiClient.patch(`/needs/${id}/`, { status: 'open' }));
}

export async function applyToNeed(id: string, message: string): Promise<NeedApplication> {
	return mapApplication(await apiClient.post(`/needs/${id}/apply/`, { message }));
}

export async function withdrawFromNeed(id: string): Promise<NeedApplication> {
	return mapApplication(await apiClient.post(`/needs/${id}/withdraw/`, {}));
}

/** Manager-only — 404s (via `apiClient`'s `ApiError`) for anybody else, the same "not public"
 * shape a node's own staff roster answers with. */
export async function getNeedApplications(id: string): Promise<NeedApplication[]> {
	const raw = await apiClient.get<unknown[]>(`/needs/${id}/applications/`);
	return raw.map(mapApplication);
}

export async function decideNeedApplication(
	applicationId: string,
	decision: 'accept' | 'decline'
): Promise<NeedApplication> {
	return mapApplication(
		await apiClient.post(`/need-applications/${applicationId}/decide/`, { decision })
	);
}
