// Organisations, their rosters and what they stand behind — one function per endpoint in
// MANAGEMENT-BRIEF.md §3.A, and nothing on this surface calls `fetch` (frontend/CLAUDE.md's layer
// boundary). The mapping is hand-written here rather than in `lib/api/mappers.ts`, the way
// `services/venues.ts` and `services/concepts.ts` already do it: the backend speaks snake_case and
// this app speaks camelCase, and the one place that translation happens is the only place a field
// rename can break.
//
// **A refusal arrives as a typed error carrying its reason** (house rule 6). `last_owner`,
// `not_node_manager` and `minor` are each a completely different sentence to the person in front of
// them, so a component catches `OrganizationRefusedError` and looks the word up — it never has to
// know the word travelled inside an HTTP body.

import { apiClient, ApiError } from '$lib/api/client';
import type { NodeKind, NodeRef } from '$lib/types/node';
import type {
	Organization,
	OrganizationBlockReason,
	OrganizationDraft,
	OrganizationKind,
	OrganizationLink,
	OrganizationLinkKind,
	OrganizationMember,
	OrganizationPerson,
	OrganizationRole,
	OrganizationSummary
} from '$lib/types/organization';

/** A refusal that carries its own word. `status` is kept too, because 409 ("the world moved") and
 *  403 ("not you") are different things to tell somebody even when the reason reads the same. */
export class OrganizationRefusedError extends Error {
	reason: OrganizationBlockReason | string;
	status: number;

	constructor(reason: OrganizationBlockReason | string, status: number) {
		super(reason);
		this.reason = reason;
		this.status = status;
	}
}

function refusal(error: unknown): never {
	if (error instanceof ApiError) {
		const detail = (error.body as { detail?: string } | undefined)?.detail;
		if (typeof detail === 'string') throw new OrganizationRefusedError(detail, error.status);
	}
	throw error;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPerson(raw: any): OrganizationPerson | null {
	if (!raw) return null;
	return { id: String(raw.id ?? ''), displayName: raw.display_name ?? '' };
}

function mapNode(raw: any): NodeRef | null {
	if (!raw) return null;
	return {
		kind: raw.kind,
		id: String(raw.id),
		title: raw.title ?? '',
		isStaff: Boolean(raw.is_staff),
		isMember: Boolean(raw.is_member),
		canManage: Boolean(raw.can_manage)
	};
}

function mapSummary(raw: any): OrganizationSummary {
	return {
		id: String(raw.id),
		name: raw.name ?? '',
		slug: raw.slug ?? '',
		kind: (raw.kind ?? 'other') as OrganizationKind,
		city: raw.city ?? '',
		isActive: raw.is_active ?? true,
		memberCount: raw.member_count ?? 0,
		linkCount: raw.link_count ?? 0
	};
}

function mapOrganization(raw: any): Organization {
	return {
		...mapSummary(raw),
		description: raw.description ?? '',
		website: raw.website ?? '',
		createdBy: mapPerson(raw.created_by),
		createdAt: raw.created_at ?? '',
		myRole: (raw.my_role ?? null) as OrganizationRole | null,
		canManage: Boolean(raw.can_manage)
	};
}

function mapMember(raw: any): OrganizationMember {
	return {
		id: String(raw.id),
		user: mapPerson(raw.user) ?? { id: '', displayName: '' },
		role: raw.role as OrganizationRole,
		addedBy: mapPerson(raw.added_by),
		addedAt: raw.added_at ?? ''
	};
}

function mapLink(raw: any): OrganizationLink {
	return {
		id: String(raw.id),
		organization: mapSummary(raw.organization ?? {}),
		node: mapNode(raw.node),
		kind: (raw.kind ?? 'runs') as OrganizationLinkKind,
		addedBy: mapPerson(raw.added_by),
		addedAt: raw.added_at ?? ''
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- the directory --------------------------------------------------------------------------

export interface OrganizationQuery {
	q?: string;
	kind?: OrganizationKind | '';
	mine?: boolean;
}

export async function getOrganizations(
	query: OrganizationQuery = {}
): Promise<OrganizationSummary[]> {
	const params = new URLSearchParams();
	if (query.q) params.set('q', query.q);
	if (query.kind) params.set('kind', query.kind);
	if (query.mine) params.set('mine', '1');
	const suffix = params.toString() ? `?${params}` : '';
	const rows = await apiClient.get<unknown[]>(`/organizations/${suffix}`);
	return rows.map(mapSummary);
}

export async function getOrganization(id: string): Promise<Organization> {
	return mapOrganization(await apiClient.get(`/organizations/${id}/`));
}

/** `/organizations/[slug]` resolves through this: the numeric pk stays the API's own id (root
 *  CLAUDE.md, "Ids"), while the slug is what a link somebody sends actually carries. */
export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
	const rows = await apiClient.get<{ id: number }[]>(
		`/organizations/?slug=${encodeURIComponent(slug)}`
	);
	if (!rows.length) return null;
	return getOrganization(String(rows[0].id));
}

/** The bodies this account may act in — what the "link this organisation" picker is fed by. Its own
 *  endpoint rather than `?mine=1`, which answers the different question "where am I listed". */
export async function getManagedOrganizations(): Promise<OrganizationSummary[]> {
	const rows = await apiClient.get<unknown[]>('/organizations/managed/');
	return rows.map(mapSummary);
}

export async function createOrganization(draft: OrganizationDraft): Promise<Organization> {
	try {
		return mapOrganization(
			await apiClient.post('/organizations/', {
				name: draft.name,
				kind: draft.kind,
				description: draft.description ?? '',
				website: draft.website ?? '',
				city: draft.city ?? ''
			})
		);
	} catch (error) {
		return refusal(error);
	}
}

export async function updateOrganization(
	id: string,
	patch: Partial<OrganizationDraft>
): Promise<Organization> {
	const body: Record<string, unknown> = {};
	if (patch.name !== undefined) body.name = patch.name;
	if (patch.kind !== undefined) body.kind = patch.kind;
	if (patch.description !== undefined) body.description = patch.description;
	if (patch.website !== undefined) body.website = patch.website;
	if (patch.city !== undefined) body.city = patch.city;
	try {
		return mapOrganization(await apiClient.patch(`/organizations/${id}/`, body));
	} catch (error) {
		return refusal(error);
	}
}

/** Dissolving is a tombstone, never a delete (house rule 12) — every link that names the body still
 *  has to resolve, and its own people keep the page. */
export async function dissolveOrganization(id: string): Promise<void> {
	try {
		await apiClient.delete(`/organizations/${id}/`);
	} catch (error) {
		refusal(error);
	}
}

// ---- the roster -----------------------------------------------------------------------------

export async function getMembers(organizationId: string): Promise<OrganizationMember[]> {
	const rows = await apiClient.get<unknown[]>(`/organizations/${organizationId}/members/`);
	return rows.map(mapMember);
}

/** By **account id**, because there is no people search on this platform (root CLAUDE.md, known
 *  gaps). The form says so in as many words rather than drawing a search box that cannot work. */
export async function addMember(
	organizationId: string,
	userId: string,
	role: OrganizationRole
): Promise<OrganizationMember> {
	try {
		return mapMember(
			await apiClient.post(`/organizations/${organizationId}/members/`, {
				user_id: Number(userId),
				role
			})
		);
	} catch (error) {
		return refusal(error);
	}
}

export async function setMemberRole(
	memberId: string,
	role: OrganizationRole
): Promise<OrganizationMember> {
	try {
		return mapMember(await apiClient.patch(`/organization-members/${memberId}/`, { role }));
	} catch (error) {
		return refusal(error);
	}
}

export async function removeMember(memberId: string): Promise<void> {
	try {
		await apiClient.delete(`/organization-members/${memberId}/`);
	} catch (error) {
		refusal(error);
	}
}

// ---- the links ------------------------------------------------------------------------------

export async function getOrganizationLinks(organizationId: string): Promise<OrganizationLink[]> {
	const rows = await apiClient.get<unknown[]>(`/organizations/${organizationId}/links/`);
	return rows.map(mapLink);
}

/** The organisations behind one course, event or material — what the panel on those pages reads. */
export async function getNodeOrganizations(
	kind: NodeKind,
	id: string
): Promise<OrganizationLink[]> {
	const rows = await apiClient.get<unknown[]>(`/nodes/${kind}/${id}/organizations/`);
	return rows.map(mapLink);
}

export async function linkNode(
	organizationId: string,
	nodeKind: NodeKind,
	nodeId: string,
	kind: OrganizationLinkKind
): Promise<OrganizationLink> {
	try {
		return mapLink(
			await apiClient.post(`/organizations/${organizationId}/links/`, {
				node_kind: nodeKind,
				node_id: Number(nodeId),
				kind
			})
		);
	} catch (error) {
		return refusal(error);
	}
}

/** Either end may undo it: agreeing takes two, withdrawing takes one. */
export async function unlinkNode(linkId: string): Promise<void> {
	try {
		await apiClient.delete(`/organization-links/${linkId}/`);
	} catch (error) {
		refusal(error);
	}
}
