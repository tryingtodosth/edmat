// The cloakroom desk — the only place this app knows how to talk to backend/cloakroom/.
// Components and routes never fetch (frontend/CLAUDE.md's layer boundary); `apiClient` is the one
// fetch. Hand-written snake_case ↔ camelCase mapping, like every other service here, so a field
// rename breaks in exactly one file.

import { apiClient } from '$lib/api/client';
import type {
	CloakroomDesk,
	CloakroomDeskDraft,
	CloakroomExceptionDraft,
	CloakroomItem,
	CloakroomReconciliation,
	CloakroomReturn
} from '$lib/types/cloakroom';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapDesk(raw: any): CloakroomDesk {
	return {
		id: String(raw.id),
		eventId: String(raw.event ?? ''),
		name: raw.name ?? '',
		opensNote: raw.opens_note ?? '',
		status: raw.status ?? 'open',
		canOperate: raw.can_operate ?? false,
		// An attendee's payload carries none of these — the server sends the desk's name and its
		// opening note and stops there. Defaulting to empty keeps every reader of this type honest
		// without an `if (desk.racks)` at each one.
		racks: raw.racks ?? [],
		freeRacks: raw.free_racks ?? [],
		storedCount: raw.stored_count ?? 0,
		returnedCount: raw.returned_count ?? 0,
		unclaimedCount: raw.unclaimed_count ?? 0,
		closedAt: raw.closed_at ?? null
	};
}

function mapItem(raw: any): CloakroomItem {
	return {
		id: String(raw.id),
		deskId: String(raw.desk ?? ''),
		rackLabel: raw.rack_label ?? '',
		token: raw.token ?? '',
		status: raw.status ?? 'stored',
		description: raw.description ?? '',
		depositedAt: raw.deposited_at ?? '',
		returnedAt: raw.returned_at ?? null,
		identityKind: raw.exception_identity_kind ?? 'none',
		exceptionNote: raw.exception_note ?? ''
	};
}

/** Every desk of one event. Readable by anybody who can see the event — that is what the
 * attendee's "there is a cloakroom at …" line is made of. */
export async function getEventCloakroomDesks(eventId: string): Promise<CloakroomDesk[]> {
	const raw = await apiClient.get<any[]>(`/events/${eventId}/cloakroom-desks/`);
	return raw.map(mapDesk);
}

/** Organiser-only: opening a desk is running the event, working it is a shift. */
export async function createCloakroomDesk(
	eventId: string,
	draft: CloakroomDeskDraft
): Promise<CloakroomDesk> {
	return mapDesk(
		await apiClient.post<any>(`/events/${eventId}/cloakroom-desks/`, {
			name: draft.name,
			rack_labels: draft.racks,
			opens_note: draft.opensNote
		})
	);
}

export async function getCloakroomDesk(deskId: string): Promise<CloakroomDesk> {
	return mapDesk(await apiClient.get<any>(`/cloakroom-desks/${deskId}/`));
}

export async function updateCloakroomDesk(
	deskId: string,
	draft: Partial<CloakroomDeskDraft>
): Promise<CloakroomDesk> {
	const body: Record<string, unknown> = {};
	if (draft.name !== undefined) body.name = draft.name;
	if (draft.racks !== undefined) body.rack_labels = draft.racks;
	if (draft.opensNote !== undefined) body.opens_note = draft.opensNote;
	return mapDesk(await apiClient.patch<any>(`/cloakroom-desks/${deskId}/`, body));
}

/** Everything the desk has ever held, newest first — the rack grid's live state. */
export async function getCloakroomItems(deskId: string): Promise<CloakroomItem[]> {
	const raw = await apiClient.get<any[]>(`/cloakroom-desks/${deskId}/items/`);
	return raw.map(mapItem);
}

/** Take a coat in. The token comes back from the server and is minted there — a bearer token a
 * client chose would be a bearer token a client chose. */
export async function depositCloakroomItem(
	deskId: string,
	rackLabel: string,
	description = ''
): Promise<CloakroomItem> {
	return mapItem(
		await apiClient.post<any>(`/cloakroom-desks/${deskId}/items/`, {
			rack_label: rackLabel,
			description
		})
	);
}

/** The Return flow's own call: a scanned or typed **token**, never an id. Answers with a verdict
 * for all four outcomes rather than throwing on three of them. */
export async function returnByToken(deskId: string, token: string): Promise<CloakroomReturn> {
	const raw = await apiClient.post<any>(`/cloakroom-desks/${deskId}/return/`, { token });
	return { result: raw.result, item: raw.item ? mapItem(raw.item) : null };
}

/** The same hand-back, addressed by the rack the clerk tapped on the grid. */
export async function returnCloakroomItem(
	deskId: string,
	itemId: string
): Promise<CloakroomReturn> {
	const raw = await apiClient.post<any>(`/cloakroom-desks/${deskId}/items/${itemId}/return/`);
	return { result: raw.result, item: raw.item ? mapItem(raw.item) : null };
}

/** The lost slip. `description` and `identityKind` are both required by the server, and the note
 * is free text — none of the three is ever a document number. */
export async function returnCloakroomItemByException(
	deskId: string,
	itemId: string,
	draft: CloakroomExceptionDraft
): Promise<CloakroomItem> {
	const raw = await apiClient.post<any>(
		`/cloakroom-desks/${deskId}/items/${itemId}/return-by-exception/`,
		{ description: draft.description, identity_kind: draft.identityKind, note: draft.note }
	);
	return mapItem(raw.item);
}

/** Close the desk, and get back the list somebody walks the rail with. */
export async function reconcileCloakroomDesk(deskId: string): Promise<CloakroomReconciliation> {
	const raw = await apiClient.post<any>(`/cloakroom-desks/${deskId}/reconcile/`);
	return { desk: mapDesk(raw.desk), unclaimed: (raw.unclaimed ?? []).map(mapItem) };
}

/** The evening as CSV bytes, fetched through the client so the token travels in a header rather
 * than in a URL — the same tradeoff `getEventIcs` documents. Six columns, no names. */
export async function getCloakroomCsv(deskId: string): Promise<string> {
	return apiClient.getText(`/cloakroom-desks/${deskId}/export/`);
}
