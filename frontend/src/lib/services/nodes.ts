// The management node seam (MANAGEMENT-BRIEF.md §2) — the only place the frontend asks the API
// "what is this thing and where do I stand on it". Components and routes never fetch
// (frontend/CLAUDE.md's layer boundary); `apiClient` is the one fetch.

import { apiClient } from '$lib/api/client';
import type { NodeKind, NodeRef, NodeStaffMember } from '$lib/types/node';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapNodeRef(raw: any): NodeRef {
	return {
		kind: raw.kind,
		id: String(raw.id),
		title: raw.title ?? '',
		isStaff: raw.is_staff ?? false,
		isMember: raw.is_member ?? false,
		canManage: raw.can_manage ?? false
	};
}

function mapStaff(raw: any): NodeStaffMember {
	return { id: String(raw.id), displayName: raw.display_name ?? '' };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 404 (thrown by `apiClient`) means "not for you" as much as "does not exist" — house rule 4. */
export async function getNodeRef(kind: NodeKind, id: string): Promise<NodeRef> {
	const raw = await apiClient.get(`/nodes/${kind}/${id}/`);
	return mapNodeRef(raw);
}

export async function getNodeStaff(kind: NodeKind, id: string): Promise<NodeStaffMember[]> {
	const raw = await apiClient.get(`/nodes/${kind}/${id}/staff/`);
	return (Array.isArray(raw) ? raw : []).map(mapStaff);
}
