// The volunteer rota — mirrors `backend/shifts/` one to one.
//
// The mapping is hand-written, like every other service module here: the backend speaks snake_case
// and this app speaks camelCase, and the one place that translation happens is the only place a
// field rename can break.
//
// **One GET powers three screens.** `getStations` returns the whole rota — stations, their shifts,
// each shift's counts, each shift's `claimBlockReason` for the reader — so the open-shifts board,
// the coverage grid and the wall print never disagree about what is short, and a disabled Claim
// button never has to ask a second endpoint why it is disabled.

import { apiClient } from '$lib/api/client';
import type {
	Assignment,
	AssignmentStatus,
	ClaimBlockReason,
	CoverageCell,
	DropBlockReason,
	MyShift,
	MyShifts,
	RotaEvent,
	RotaPerson,
	Shift,
	ShiftDraft,
	Station,
	StationDraft,
	VolunteerRecord,
	VolunteeringSummary
} from '$lib/types/shift';

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapPerson(raw: any): RotaPerson {
	// `id` stays null when the backend withheld it — a volunteer is never handed another
	// volunteer's account id, and turning that into '' here would lose the distinction.
	return {
		id: raw?.id === null || raw?.id === undefined ? null : String(raw.id),
		displayName: raw?.display_name ?? ''
	};
}

function mapAssignment(raw: any): Assignment {
	return {
		id: String(raw.id),
		shiftId: String(raw.shift),
		user: mapPerson(raw.user),
		status: raw.status as AssignmentStatus,
		source: raw.source,
		claimedAt: raw.claimed_at ?? null,
		confirmedAt: raw.confirmed_at ?? null,
		droppedAt: raw.dropped_at ?? null,
		dropReason: raw.drop_reason ?? '',
		hoursCredited: raw.hours_credited ?? null,
		creditNote: raw.credit_note ?? '',
		creditedHours: raw.credited_hours ?? '0.00',
		isMinor: raw.is_minor ?? null
	};
}

function mapShift(raw: any): Shift {
	return {
		id: String(raw.id),
		stationId: String(raw.station),
		stationName: raw.station_name ?? '',
		stationKind: raw.station_kind ?? 'other',
		locationText: raw.location_text ?? '',
		briefingNote: raw.briefing_note ?? '',
		startsAt: raw.starts_at,
		endsAt: raw.ends_at,
		hours: raw.hours ?? '0.00',
		needed: raw.needed ?? 1,
		note: raw.note ?? '',
		followsSession: raw.follows_session ?? false,
		confirmedCount: raw.confirmed_count ?? 0,
		claimedCount: raw.claimed_count ?? 0,
		isShort: raw.is_short ?? false,
		needsAdult: raw.needs_adult ?? false,
		assignments: (raw.assignments ?? []).map(mapAssignment),
		myAssignment: raw.my_assignment ? mapAssignment(raw.my_assignment) : null,
		claimBlockReason: (raw.claim_block_reason ?? null) as ClaimBlockReason | null,
		canClaim: raw.can_claim ?? false,
		dropBlockReason: (raw.drop_block_reason ?? null) as DropBlockReason | null
	};
}

function mapStation(raw: any): Station {
	return {
		id: String(raw.id),
		eventId: String(raw.event),
		kind: raw.kind ?? 'other',
		name: raw.name ?? '',
		locationText: raw.location_text ?? '',
		sessionId: raw.session === null || raw.session === undefined ? null : String(raw.session),
		sessionTitle: raw.session_title ?? '',
		briefingNote: raw.briefing_note ?? '',
		minorsPermitted: raw.minors_permitted ?? false,
		requiresAdult: raw.requires_adult ?? false,
		needsConfirmation: raw.needs_confirmation ?? false,
		order: raw.order ?? 0,
		shifts: (raw.shifts ?? []).map(mapShift)
	};
}

function mapRotaEvent(raw: any): RotaEvent {
	return {
		id: String(raw.id),
		title: raw.title ?? '',
		startsAt: raw.starts_at ?? null,
		endsAt: raw.ends_at ?? null,
		locationText: raw.location_text ?? '',
		organiser: raw.organiser ?? ''
	};
}

function mapMyShift(raw: any): MyShift {
	return {
		assignmentId: String(raw.assignment),
		shiftId: String(raw.shift),
		status: raw.status as AssignmentStatus,
		stationName: raw.station_name ?? '',
		stationKind: raw.station_kind ?? 'other',
		locationText: raw.location_text ?? '',
		briefingNote: raw.briefing_note ?? '',
		startsAt: raw.starts_at,
		endsAt: raw.ends_at,
		hours: raw.hours ?? '0.00',
		creditedHours: raw.credited_hours ?? '0.00',
		dropBlockReason: (raw.drop_block_reason ?? null) as DropBlockReason | null,
		coVolunteers: raw.co_volunteers ?? []
	};
}

function mapVolunteerRecord(raw: any): VolunteerRecord {
	return {
		id: raw.id === null || raw.id === undefined ? null : String(raw.id),
		user: mapPerson(raw.user),
		isMinor: raw.is_minor ?? false,
		hasConsent: raw.has_consent ?? false,
		consentRecordedAt: raw.consent_recorded_at ?? null,
		consentNote: raw.consent_note ?? '',
		vettingCheckedAt: raw.vetting_checked_at ?? null,
		vettingReference: raw.vetting_reference ?? '',
		emergencyContactNote: raw.emergency_contact_note ?? '',
		hours: raw.hours ?? '0.00'
	};
}

function stationBody(draft: Partial<StationDraft>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (draft.kind !== undefined) body.kind = draft.kind;
	if (draft.name !== undefined) body.name = draft.name;
	if (draft.locationText !== undefined) body.location_text = draft.locationText;
	if (draft.session !== undefined) body.session = draft.session;
	if (draft.briefingNote !== undefined) body.briefing_note = draft.briefingNote;
	if (draft.minorsPermitted !== undefined) body.minors_permitted = draft.minorsPermitted;
	if (draft.requiresAdult !== undefined) body.requires_adult = draft.requiresAdult;
	if (draft.needsConfirmation !== undefined) body.needs_confirmation = draft.needsConfirmation;
	if (draft.order !== undefined) body.order = draft.order;
	return body;
}

function shiftBody(draft: ShiftDraft): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (draft.startsAt !== undefined) body.starts_at = draft.startsAt;
	if (draft.endsAt !== undefined) body.ends_at = draft.endsAt;
	if (draft.needed !== undefined) body.needed = draft.needed;
	if (draft.note !== undefined) body.note = draft.note;
	return body;
}

export async function getStations(eventId: string): Promise<Station[]> {
	const raw = await apiClient.get<any[]>(`/events/${eventId}/stations/`);
	return raw.map(mapStation);
}

export async function createStation(eventId: string, draft: StationDraft): Promise<Station> {
	return mapStation(await apiClient.post<any>(`/events/${eventId}/stations/`, stationBody(draft)));
}

export async function updateStation(
	stationId: string,
	draft: Partial<StationDraft>
): Promise<Station> {
	return mapStation(await apiClient.patch<any>(`/stations/${stationId}/`, stationBody(draft)));
}

export async function deleteStation(stationId: string): Promise<void> {
	await apiClient.delete(`/stations/${stationId}/`);
}

export async function createShift(stationId: string, draft: ShiftDraft): Promise<Shift> {
	return mapShift(await apiClient.post<any>(`/stations/${stationId}/shifts/`, shiftBody(draft)));
}

export async function deleteShift(shiftId: string): Promise<void> {
	await apiClient.delete(`/shifts/${shiftId}/`);
}

/** The volunteer's own claim. A soft refusal comes back as `pendingReason` rather than as an
 * error — the shift is taken, it is just not confirmed yet. */
export async function claimShift(
	shiftId: string
): Promise<{ assignment: Assignment; pendingReason: ClaimBlockReason | null }> {
	const raw = await apiClient.post<any>(`/shifts/${shiftId}/claim/`);
	return { assignment: mapAssignment(raw.assignment), pendingReason: raw.pending_reason ?? null };
}

export async function dropShift(
	shiftId: string,
	options: { assignmentId?: string; reason?: string } = {}
): Promise<Assignment> {
	const body: Record<string, unknown> = {};
	if (options.assignmentId) body.assignment = Number(options.assignmentId);
	if (options.reason) body.reason = options.reason;
	return mapAssignment(await apiClient.post<any>(`/shifts/${shiftId}/drop/`, body));
}

export async function assignShift(
	shiftId: string,
	userId: string
): Promise<{ assignment: Assignment; pendingReason: ClaimBlockReason | null }> {
	const raw = await apiClient.post<any>(`/shifts/${shiftId}/assign/`, { user: Number(userId) });
	return { assignment: mapAssignment(raw.assignment), pendingReason: raw.pending_reason ?? null };
}

export async function confirmAssignment(
	shiftId: string,
	assignmentId: string
): Promise<Assignment> {
	return mapAssignment(
		await apiClient.post<any>(`/shifts/${shiftId}/confirm/`, { assignment: Number(assignmentId) })
	);
}

export async function markNoShow(shiftId: string, assignmentId: string): Promise<Assignment> {
	return mapAssignment(
		await apiClient.post<any>(`/shifts/${shiftId}/no-show/`, { assignment: Number(assignmentId) })
	);
}

export async function markDone(
	shiftId: string,
	assignmentId: string,
	options: { hours?: string; note?: string } = {}
): Promise<Assignment> {
	const body: Record<string, unknown> = { assignment: Number(assignmentId) };
	if (options.hours) body.hours = options.hours;
	if (options.note) body.note = options.note;
	return mapAssignment(await apiClient.post<any>(`/shifts/${shiftId}/done/`, body));
}

export async function getCoverage(eventId: string): Promise<CoverageCell[]> {
	const raw = await apiClient.get<any>(`/events/${eventId}/coverage/`);
	return (raw.shifts ?? []).map((cell: any) => ({
		shiftId: String(cell.shift),
		stationId: String(cell.station),
		stationName: cell.station_name ?? '',
		stationKind: cell.station_kind ?? 'other',
		startsAt: cell.starts_at,
		endsAt: cell.ends_at,
		needed: cell.needed ?? 0,
		confirmed: cell.confirmed ?? 0,
		claimed: cell.claimed ?? 0,
		isShort: cell.is_short ?? false,
		needsAdult: cell.needs_adult ?? false
	}));
}

export async function getMyShifts(eventId: string): Promise<MyShifts> {
	const raw = await apiClient.get<any>(`/events/${eventId}/my-shifts/`);
	return {
		event: mapRotaEvent(raw.event ?? {}),
		deskLocation: raw.desk_location ?? '',
		shifts: (raw.shifts ?? []).map(mapMyShift),
		hours: raw.hours ?? '0.00'
	};
}

/** The calendar file, as text — the browser turns it into a download (`events.ts` does the same
 * for an agenda). Still through `client.ts`: no component ever calls `fetch`. */
export function getMyShiftsIcs(eventId: string): Promise<string> {
	return apiClient.getText(`/events/${eventId}/my-shifts.ics`);
}

export async function getVolunteerRecords(eventId: string): Promise<VolunteerRecord[]> {
	const raw = await apiClient.get<any[]>(`/events/${eventId}/volunteers/`);
	return raw.map(mapVolunteerRecord);
}

export async function saveVolunteerRecord(
	eventId: string,
	userId: string,
	fields: {
		consentRecorded?: boolean;
		consentNote?: string;
		vettingChecked?: boolean;
		vettingReference?: string;
		emergencyContactNote?: string;
	}
): Promise<VolunteerRecord> {
	const body: Record<string, unknown> = { user: Number(userId) };
	if (fields.consentRecorded !== undefined) body.consent_recorded = fields.consentRecorded;
	if (fields.consentNote !== undefined) body.consent_note = fields.consentNote;
	if (fields.vettingChecked !== undefined) body.vetting_checked = fields.vettingChecked;
	if (fields.vettingReference !== undefined) body.vetting_reference = fields.vettingReference;
	if (fields.emergencyContactNote !== undefined)
		body.emergency_contact_note = fields.emergencyContactNote;
	return mapVolunteerRecord(await apiClient.post<any>(`/events/${eventId}/volunteers/`, body));
}

export async function getMyVolunteering(): Promise<VolunteeringSummary[]> {
	const raw = await apiClient.get<any[]>('/my-volunteering/');
	return raw.map((row) => ({
		event: mapRotaEvent(row.event ?? {}),
		shiftCount: row.shift_count ?? 0,
		doneCount: row.done_count ?? 0,
		hours: row.hours ?? '0.00'
	}));
}
