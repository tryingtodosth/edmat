// `needs` — the only place this app knows how to talk to backend/needs/. Components and routes
// never fetch (frontend/CLAUDE.md's layer boundary); `apiClient` is the one fetch. Hand-written
// snake_case <-> camelCase mapping, like every other service here, so a field rename breaks in
// exactly one file.

import { getLocale } from '$lib/paraglide/runtime';
import { apiClient } from '$lib/api/client';
import { mapLanguageReading, mapTextVersions } from '$lib/services/textVersions';
import type { NodeKind, NodeRef } from '$lib/types/node';
import type {
	Need,
	NeedApplication,
	NeedBoardFilters,
	NeedDraft,
	NeedPerson,
	OfferBoardFilters,
	VolunteeringOffer,
	VolunteeringOfferDraft
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
		canManage: raw.can_manage ?? false,
		openBoard: raw.open_board ?? false
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
		updatedAt: raw.updated_at ?? '',
		language: mapLanguageReading(raw.language),
		textVersions: mapTextVersions(raw.text_versions)
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
	// On every read, filtered or not — the `services/taxonomy.ts` pattern. Without it the backend's
	// `request_locale` falls back to 'pl' and an English reader silently gets the Polish
	// (translations/, 2026-10-08).
	params.set('lang', getLocale());
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
	return mapNeed(await apiClient.get(`/needs/${id}/${boardQuery({})}`));
}

/** The needs of one node — course, event or material — for `NeedsPanel`. */
export async function getNodeNeeds(kind: NodeKind, nodeId: string): Promise<Need[]> {
	const raw = await apiClient.get<unknown[]>(`/nodes/${kind}/${nodeId}/needs/${boardQuery({})}`);
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

// ---- the supply side: volunteering offers (2026-10-01) ---------------------------------------
//
// `any` again, in the same narrow window the demand side above uses it in: these functions are
// the hand-written snake_case -> camelCase boundary, and typing the raw JSON would mean a second
// interface per shape that nothing else ever reads. Re-enabled at the end of the file.
/* eslint-disable @typescript-eslint/no-explicit-any */
// Same file as the demand side because it is the same backend app and the same vocabulary; a
// second service module would mean two places to look for "how does this frontend talk to
// needs/".

function mapOffer(raw: any): VolunteeringOffer {
	return {
		id: String(raw.id),
		volunteer: mapPerson(raw.volunteer),
		title: raw.title ?? '',
		description: raw.description ?? '',
		kind: raw.kind ?? 'help',
		skillLevel: raw.skill_level ?? 'none',
		status: raw.status ?? 'open',
		language: raw.language ?? 'pl',
		spokenLanguages: Array.isArray(raw.spoken_languages) ? raw.spoken_languages.map(String) : [],
		hoursPerWeek: raw.hours_per_week ?? null,
		isRemote: raw.is_remote ?? false,
		locationText: raw.location_text ?? '',
		createdAt: raw.created_at ?? '',
		updatedAt: raw.updated_at ?? ''
	};
}

function offerBody(draft: VolunteeringOfferDraft) {
	return {
		title: draft.title,
		description: draft.description,
		kind: draft.kind,
		skill_level: draft.skillLevel,
		status: draft.status,
		language: draft.language,
		spoken_languages: draft.spokenLanguages,
		hours_per_week: draft.hoursPerWeek,
		is_remote: draft.isRemote,
		location_text: draft.locationText
	};
}

/** The public board. `?content_locales=` is appended by `client.ts` itself for every list-shaped
 *  GET, so this must NOT add it — that is the whole point of the one seam. */
export async function getVolunteeringOffers(
	filters: OfferBoardFilters = {}
): Promise<VolunteeringOffer[]> {
	const params = new URLSearchParams();
	if (filters.kind) params.set('kind', filters.kind);
	if (filters.remote) params.set('remote', '1');
	if (filters.q) params.set('q', filters.q);
	if (filters.speaks) params.set('speaks', filters.speaks);
	const query = params.toString();
	const raw = await apiClient.get<any[]>(`/volunteering-offers/${query ? `?${query}` : ''}`);
	return raw.map(mapOffer);
}

/** This person's own offers, paused and closed ones included — the board never shows those. */
export async function getMyVolunteeringOffers(): Promise<VolunteeringOffer[]> {
	const raw = await apiClient.get<any[]>('/volunteering-offers/?mine=true');
	return raw.map(mapOffer);
}

export async function getVolunteeringOffer(id: string): Promise<VolunteeringOffer> {
	return mapOffer(await apiClient.get<any>(`/volunteering-offers/${encodeURIComponent(id)}/`));
}

export async function createVolunteeringOffer(
	draft: VolunteeringOfferDraft
): Promise<VolunteeringOffer> {
	return mapOffer(await apiClient.post<any>('/volunteering-offers/', offerBody(draft)));
}

export async function updateVolunteeringOffer(
	id: string,
	draft: VolunteeringOfferDraft
): Promise<VolunteeringOffer> {
	return mapOffer(
		await apiClient.patch<any>(`/volunteering-offers/${encodeURIComponent(id)}/`, offerBody(draft))
	);
}

export async function deleteVolunteeringOffer(id: string): Promise<void> {
	await apiClient.delete(`/volunteering-offers/${encodeURIComponent(id)}/`);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
