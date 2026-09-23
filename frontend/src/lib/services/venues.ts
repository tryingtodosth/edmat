// Venues, rooms, room bookings and checklists — one function per endpoint in
// CONFERENCE-BRIEF.md §3.A, and nothing on this surface calls `fetch` (frontend/CLAUDE.md's layer
// boundary). The mapping is hand-written in this file rather than in `lib/api/mappers.ts`, the same
// way `services/events.ts` and `services/concepts.ts` already do it: the backend speaks snake_case
// and this app speaks camelCase, and the one place that translation happens is the only place a
// field rename can break.
//
// **A refusal arrives as a typed error carrying its reason** (house rule 6). `room_busy`,
// `over_fire_capacity`, `needs_venue_signoff` and the rest are each a completely different sentence
// to the person in front of them, so a component catches `VenueRefusedError` and looks the reason
// up — it never has to know the word travelled inside an HTTP body.

import { apiClient, ApiError } from '$lib/api/client';
import type {
	ChecklistInstance,
	ChecklistItem,
	ChecklistItemStatus,
	ChecklistTemplate,
	ChecklistTemplateItem,
	Room,
	RoomBooking,
	RoomBookingDraft,
	Venue,
	VenueBlockReason,
	VenuePerson,
	VenueRole,
	VenueStaffMember,
	VenueSummary
} from '$lib/types/venue';

/** A refusal that carries its own word. `status` is kept too, because 409 ("the world moved") and
 *  400 ("the request was wrong when it was written") are different things to tell somebody even
 *  when the reason is the same. */
export class VenueRefusedError extends Error {
	reason: VenueBlockReason | string;
	status: number;

	constructor(reason: VenueBlockReason | string, status: number) {
		super(reason);
		this.reason = reason;
		this.status = status;
	}
}

function refusal(error: unknown): never {
	if (error instanceof ApiError) {
		const detail = (error.body as { detail?: string } | undefined)?.detail;
		if (typeof detail === 'string') throw new VenueRefusedError(detail, error.status);
	}
	throw error;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPerson(raw: any): VenuePerson | null {
	if (!raw) return null;
	return { id: String(raw.id ?? ''), displayName: raw.display_name ?? '' };
}

function mapRoom(raw: any): Room {
	return {
		id: String(raw.id),
		venueId: String(raw.venue_id ?? ''),
		name: raw.name ?? '',
		number: raw.number ?? '',
		floor: raw.floor ?? '',
		seatedCapacity: raw.seated_capacity ?? 0,
		fireCapacity: raw.fire_capacity ?? 0,
		hasAv: Boolean(raw.has_av),
		accessible: Boolean(raw.accessible),
		notes: raw.notes ?? '',
		isActive: raw.is_active ?? true
	};
}

function mapVenueSummary(raw: any): VenueSummary {
	return {
		id: String(raw.id),
		name: raw.name ?? '',
		slug: raw.slug ?? '',
		address: raw.address ?? '',
		isActive: raw.is_active ?? true,
		roomCount: raw.room_count ?? 0
	};
}

function mapVenue(raw: any): Venue {
	return {
		id: String(raw.id),
		name: raw.name ?? '',
		slug: raw.slug ?? '',
		address: raw.address ?? '',
		contactNote: raw.contact_note ?? '',
		securityPhone: raw.security_phone ?? '',
		isActive: raw.is_active ?? true,
		rooms: (raw.rooms ?? []).map(mapRoom),
		canAdminister: Boolean(raw.can_administer),
		myRole: (raw.my_role ?? null) as VenueRole | null
	};
}

function mapStaff(raw: any): VenueStaffMember {
	return {
		id: String(raw.id),
		user: mapPerson(raw.user) ?? { id: '', displayName: '' },
		role: raw.role,
		addedBy: mapPerson(raw.added_by),
		addedAt: raw.added_at
	};
}

function mapBooking(raw: any): RoomBooking {
	return {
		id: String(raw.id),
		eventId: String(raw.event_id ?? ''),
		eventTitle: raw.event_title ?? '',
		room: mapRoom(raw.room ?? {}),
		venue: mapVenueSummary(raw.venue ?? {}),
		startsAt: raw.starts_at,
		endsAt: raw.ends_at,
		status: raw.status,
		expectedHeadcount: raw.expected_headcount ?? 0,
		purpose: raw.purpose ?? '',
		decidedBy: mapPerson(raw.decided_by),
		decidedAt: raw.decided_at ?? null,
		note: raw.note ?? '',
		createdAt: raw.created_at
	};
}

function mapTemplateItem(raw: any): ChecklistTemplateItem {
	return {
		id: String(raw.id),
		titleEn: raw.title_en ?? '',
		titlePl: raw.title_pl ?? '',
		descriptionEn: raw.description_en ?? '',
		descriptionPl: raw.description_pl ?? '',
		ownerRole: raw.owner_role ?? 'organiser',
		dueOffsetMinutes: raw.due_offset_minutes ?? 0,
		anchor: raw.anchor ?? 'start',
		isMandatory: Boolean(raw.is_mandatory),
		naAllowed: Boolean(raw.na_allowed),
		evidenceKind: raw.evidence_kind ?? 'none',
		requiresVenueSignoff: Boolean(raw.requires_venue_signoff),
		order: raw.order ?? 0
	};
}

function mapTemplate(raw: any): ChecklistTemplate {
	return {
		id: String(raw.id),
		venueId: raw.venue_id === null || raw.venue_id === undefined ? null : String(raw.venue_id),
		venueName: raw.venue_name ?? '',
		name: raw.name ?? '',
		description: raw.description ?? '',
		version: raw.version ?? 1,
		eventKindHint: raw.event_kind_hint ?? '',
		isActive: raw.is_active ?? true,
		items: (raw.items ?? []).map(mapTemplateItem)
	};
}

function mapChecklistItem(raw: any): ChecklistItem {
	return {
		...mapTemplateItem(raw),
		instanceId: String(raw.instance_id ?? ''),
		computedDueAt: raw.computed_due_at ?? null,
		status: raw.status ?? 'pending',
		naReason: raw.na_reason ?? '',
		evidenceText: raw.evidence_text ?? '',
		evidenceUrl: raw.evidence_url ?? '',
		evidenceFileUrl: raw.evidence_file_url ?? '',
		doneBy: mapPerson(raw.done_by),
		doneAt: raw.done_at ?? null,
		signedOffBy: mapPerson(raw.signed_off_by),
		signedOffAt: raw.signed_off_at ?? null,
		isOverdue: Boolean(raw.is_overdue)
	};
}

function mapInstance(raw: any): ChecklistInstance {
	return {
		id: String(raw.id),
		eventId: String(raw.event_id ?? ''),
		venue: mapVenueSummary(raw.venue ?? {}),
		templateId:
			raw.template_id === null || raw.template_id === undefined ? null : String(raw.template_id),
		templateName: raw.template_name ?? '',
		templateVersion: raw.template_version ?? 1,
		templateHasNewItems: Boolean(raw.template_has_new_items),
		mandatoryPending: raw.mandatory_pending ?? 0,
		canSignOff: Boolean(raw.can_sign_off),
		createdAt: raw.created_at,
		items: (raw.items ?? []).map(mapChecklistItem)
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- venues -------------------------------------------------------------------------------------

export async function getVenues(): Promise<VenueSummary[]> {
	const rows = await apiClient.get<unknown[]>('/venues/');
	return rows.map(mapVenueSummary);
}

/** The buildings this account administers — what the "Venues" entry in the Add… menu hangs off, so
 *  that it appears for venue staff and for nobody else. */
export async function getMyVenues(): Promise<VenueSummary[]> {
	const rows = await apiClient.get<unknown[]>('/venues/?mine=administering');
	return rows.map(mapVenueSummary);
}

export async function getVenue(id: string): Promise<Venue> {
	return mapVenue(await apiClient.get(`/venues/${id}/`));
}

/** `/venues/[slug]` resolves through this: the id convention keeps the numeric pk as the API's own
 *  id (root CLAUDE.md), while the slug is what a link somebody sends actually carries. */
export async function getVenueBySlug(slug: string): Promise<Venue | null> {
	const rows = await apiClient.get<{ id: number }[]>(`/venues/?slug=${encodeURIComponent(slug)}`);
	if (!rows.length) return null;
	return getVenue(String(rows[0].id));
}

export async function updateVenue(id: string, patch: Partial<Venue>): Promise<Venue> {
	const body: Record<string, unknown> = {};
	if (patch.name !== undefined) body.name = patch.name;
	if (patch.address !== undefined) body.address = patch.address;
	if (patch.contactNote !== undefined) body.contact_note = patch.contactNote;
	if (patch.securityPhone !== undefined) body.security_phone = patch.securityPhone;
	if (patch.isActive !== undefined) body.is_active = patch.isActive;
	try {
		return mapVenue(await apiClient.patch(`/venues/${id}/`, body));
	} catch (error) {
		return refusal(error);
	}
}

export async function getVenueStaff(venueId: string): Promise<VenueStaffMember[]> {
	const rows = await apiClient.get<unknown[]>(`/venues/${venueId}/staff/`);
	return rows.map(mapStaff);
}

/** By account id, because there is no people search yet (root CLAUDE.md, known gaps). */
export async function addVenueStaff(
	venueId: string,
	userId: string,
	role: VenueRole
): Promise<VenueStaffMember> {
	try {
		return mapStaff(
			await apiClient.post(`/venues/${venueId}/staff/`, { user_id: Number(userId), role })
		);
	} catch (error) {
		return refusal(error);
	}
}

export async function removeVenueStaff(venueId: string, staffId: string): Promise<void> {
	try {
		await apiClient.delete(`/venues/${venueId}/staff/${staffId}/`);
	} catch (error) {
		refusal(error);
	}
}

export async function getVenueBookings(venueId: string): Promise<RoomBooking[]> {
	const rows = await apiClient.get<unknown[]>(`/venues/${venueId}/bookings/`);
	return rows.map(mapBooking);
}

export async function getVenueTemplates(venueId: string): Promise<ChecklistTemplate[]> {
	const rows = await apiClient.get<unknown[]>(`/venues/${venueId}/templates/`);
	return rows.map(mapTemplate);
}

// ---- rooms --------------------------------------------------------------------------------------

export async function createRoom(venueId: string, room: Partial<Room>): Promise<Room> {
	try {
		return mapRoom(
			await apiClient.post('/rooms/', {
				venue_id: Number(venueId),
				name: room.name ?? '',
				number: room.number ?? '',
				floor: room.floor ?? '',
				seated_capacity: room.seatedCapacity ?? 0,
				fire_capacity: room.fireCapacity ?? 0,
				has_av: room.hasAv ?? false,
				accessible: room.accessible ?? false,
				notes: room.notes ?? ''
			})
		);
	} catch (error) {
		return refusal(error);
	}
}

export async function updateRoom(roomId: string, patch: Partial<Room>): Promise<Room> {
	const body: Record<string, unknown> = {};
	if (patch.name !== undefined) body.name = patch.name;
	if (patch.number !== undefined) body.number = patch.number;
	if (patch.floor !== undefined) body.floor = patch.floor;
	if (patch.seatedCapacity !== undefined) body.seated_capacity = patch.seatedCapacity;
	if (patch.fireCapacity !== undefined) body.fire_capacity = patch.fireCapacity;
	if (patch.hasAv !== undefined) body.has_av = patch.hasAv;
	if (patch.accessible !== undefined) body.accessible = patch.accessible;
	if (patch.notes !== undefined) body.notes = patch.notes;
	if (patch.isActive !== undefined) body.is_active = patch.isActive;
	try {
		return mapRoom(await apiClient.patch(`/rooms/${roomId}/`, body));
	} catch (error) {
		return refusal(error);
	}
}

export async function retireRoom(roomId: string): Promise<void> {
	try {
		await apiClient.delete(`/rooms/${roomId}/`);
	} catch (error) {
		refusal(error);
	}
}

// ---- bookings -----------------------------------------------------------------------------------

export async function getEventBookings(eventId: string): Promise<RoomBooking[]> {
	const rows = await apiClient.get<unknown[]>(
		`/room-bookings/?event=${encodeURIComponent(eventId)}`
	);
	return rows.map(mapBooking);
}

export async function requestRoom(draft: RoomBookingDraft): Promise<RoomBooking> {
	try {
		return mapBooking(
			await apiClient.post('/room-bookings/', {
				event_id: Number(draft.eventId),
				room_id: Number(draft.roomId),
				starts_at: draft.startsAt,
				ends_at: draft.endsAt,
				expected_headcount: draft.expectedHeadcount,
				purpose: draft.purpose
			})
		);
	} catch (error) {
		return refusal(error);
	}
}

export async function decideBooking(
	bookingId: string,
	verb: 'approve' | 'reject',
	note = ''
): Promise<RoomBooking> {
	try {
		return mapBooking(await apiClient.post(`/room-bookings/${bookingId}/${verb}/`, { note }));
	} catch (error) {
		return refusal(error);
	}
}

export async function cancelBooking(bookingId: string): Promise<RoomBooking> {
	try {
		return mapBooking(await apiClient.post(`/room-bookings/${bookingId}/cancel/`));
	} catch (error) {
		return refusal(error);
	}
}

// ---- checklists ---------------------------------------------------------------------------------

export async function getEventChecklists(eventId: string): Promise<ChecklistInstance[]> {
	const rows = await apiClient.get<unknown[]>(`/events/${eventId}/checklist/`);
	return rows.map(mapInstance);
}

export async function startChecklist(
	eventId: string,
	templateId: string,
	venueId?: string
): Promise<ChecklistInstance> {
	const body: Record<string, unknown> = { template_id: Number(templateId) };
	if (venueId) body.venue_id = Number(venueId);
	try {
		return mapInstance(await apiClient.post(`/events/${eventId}/checklist/`, body));
	} catch (error) {
		return refusal(error);
	}
}

/** Add whatever the building has written since this copy was cut. Never an overwrite — an item
 *  somebody has already ticked and signed is exactly what the snapshot exists to protect. */
export async function syncChecklist(instanceId: string): Promise<ChecklistInstance> {
	try {
		return mapInstance(await apiClient.post(`/checklist-instances/${instanceId}/sync/`));
	} catch (error) {
		return refusal(error);
	}
}

export async function setChecklistItem(
	itemId: string,
	patch: {
		status?: ChecklistItemStatus;
		naReason?: string;
		evidenceText?: string;
		evidenceUrl?: string;
	}
): Promise<ChecklistItem> {
	const body: Record<string, unknown> = {};
	if (patch.status !== undefined) body.status = patch.status;
	if (patch.naReason !== undefined) body.na_reason = patch.naReason;
	if (patch.evidenceText !== undefined) body.evidence_text = patch.evidenceText;
	if (patch.evidenceUrl !== undefined) body.evidence_url = patch.evidenceUrl;
	try {
		return mapChecklistItem(await apiClient.patch(`/checklist-items/${itemId}/`, body));
	} catch (error) {
		return refusal(error);
	}
}

export async function signOffChecklistItem(itemId: string): Promise<ChecklistItem> {
	try {
		return mapChecklistItem(await apiClient.post(`/checklist-items/${itemId}/sign-off/`));
	} catch (error) {
		return refusal(error);
	}
}

export async function getChecklistTemplates(venueId?: string): Promise<ChecklistTemplate[]> {
	const query = venueId ? `?venue=${encodeURIComponent(venueId)}` : '';
	const rows = await apiClient.get<unknown[]>(`/checklist-templates/${query}`);
	return rows.map(mapTemplate);
}
