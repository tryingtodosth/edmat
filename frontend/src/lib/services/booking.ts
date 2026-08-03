// Booking sessions with a tutor (backend/booking/) — availability, the tutor's own schedule rules,
// and the booking lifecycle. Mirrors that app's endpoints 1:1, matching this app's own
// "one lib/services/*.ts file per backend app" convention.

import type {
	AvailabilityException,
	AvailabilityExceptionKind,
	AvailabilityRule,
	Booking,
	ServiceAvailability
} from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	mapAvailabilityException,
	mapAvailabilityRule,
	mapBooking,
	mapServiceAvailability,
	type RawAvailabilityException,
	type RawAvailabilityRule,
	type RawBooking,
	type RawServiceAvailability
} from '$lib/api/mappers';

/** What a student is shown for one offering. Public — a student comparing tutors should not have to
 * register to find out when they are free. The response says which mode produced it, because
 * "available" means two different things depending on that answer. */
export async function getServiceAvailability(
	serviceId: string,
	range?: { from: string; to: string }
): Promise<ServiceAvailability> {
	const search = new URLSearchParams();
	if (range) {
		search.set('from', range.from);
		search.set('to', range.to);
	}
	const query = search.toString();
	const raw = await apiClient.get<RawServiceAvailability>(
		`/services/${encodeURIComponent(serviceId)}/availability/${query ? `?${query}` : ''}`
	);
	return mapServiceAvailability(raw);
}

export async function getAvailabilityRules(): Promise<AvailabilityRule[]> {
	const raw = await apiClient.get<RawAvailabilityRule[]>('/availability-rules/');
	return raw.map(mapAvailabilityRule);
}

export async function createAvailabilityRule(draft: {
	weekday: number;
	startTime: string;
	endTime: string;
	serviceId?: string;
}): Promise<AvailabilityRule> {
	const raw = await apiClient.post<RawAvailabilityRule>('/availability-rules/', {
		weekday: draft.weekday,
		start_time: draft.startTime,
		end_time: draft.endTime,
		// Omitted rather than sent as null when absent — the common case is a rule that applies to
		// every listing, and `service: null` and "no service" mean the same thing to the backend.
		...(draft.serviceId ? { service: Number(draft.serviceId) } : {})
	});
	return mapAvailabilityRule(raw);
}

export async function deleteAvailabilityRule(id: string): Promise<void> {
	await apiClient.delete(`/availability-rules/${encodeURIComponent(id)}/`);
}

/** Upcoming one-off blocks and openings. `from` defaults to today at the call site rather than here,
 * so a caller that genuinely wants the past can ask for it. */
export async function getAvailabilityExceptions(from?: string): Promise<AvailabilityException[]> {
	const raw = await apiClient.get<RawAvailabilityException[]>(
		`/availability-exceptions/${from ? `?from=${encodeURIComponent(from)}` : ''}`
	);
	return raw.map(mapAvailabilityException);
}

export async function createAvailabilityException(draft: {
	date: string;
	kind: AvailabilityExceptionKind;
	startTime?: string;
	endTime?: string;
	note?: string;
}): Promise<AvailabilityException> {
	const raw = await apiClient.post<RawAvailabilityException>('/availability-exceptions/', {
		date: draft.date,
		kind: draft.kind,
		// Explicitly null, not omitted: null is what says "the whole day", which is a real answer for
		// a block rather than a missing one.
		start_time: draft.startTime || null,
		end_time: draft.endTime || null,
		note: draft.note ?? ''
	});
	return mapAvailabilityException(raw);
}

export async function deleteAvailabilityException(id: string): Promise<void> {
	await apiClient.delete(`/availability-exceptions/${encodeURIComponent(id)}/`);
}

export interface BookingFilters {
	/** Which side of the booking the caller is on. Omitted returns both, which is the normal case for
	 * somebody who both teaches and studies — most accounts here are both. */
	role?: 'tutor' | 'student';
	upcoming?: boolean;
}

export async function getBookings(filters: BookingFilters = {}): Promise<Booking[]> {
	const search = new URLSearchParams();
	if (filters.role) search.set('role', filters.role);
	if (filters.upcoming) search.set('upcoming', 'true');
	const query = search.toString();
	const raw = await apiClient.get<RawBooking[]>(`/bookings/${query ? `?${query}` : ''}`);
	return raw.map(mapBooking);
}

/** Thrown when the slot has gone between the page rendering and the click — the one failure worth
 * distinguishing, because it is the ONLY one where the right response is "here is the refreshed
 * calendar, pick again" rather than "something went wrong". Only ever happens in `derived` mode; in
 * `declared` mode a contested slot is accepted by design. */
export class SlotUnavailableError extends Error {}

export async function requestBooking(
	serviceId: string,
	startsAt: string,
	studentNote?: string
): Promise<Booking> {
	try {
		const raw = await apiClient.post<RawBooking>('/bookings/', {
			service: Number(serviceId),
			starts_at: startsAt,
			student_note: studentNote?.trim() || ''
		});
		return mapBooking(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 400 && e.body && typeof e.body === 'object') {
			if ('starts_at' in (e.body as Record<string, unknown>)) {
				throw new SlotUnavailableError(e.message);
			}
		}
		throw e;
	}
}

/** Thrown for a `409` from any of the four lifecycle actions — a booking somebody else already acted
 * on, or a clash with something already confirmed. Distinguished from an ordinary failure because
 * the honest answer is "the world moved, here is what it looks like now", not "try again". */
export class BookingConflictError extends Error {}

async function act(id: string, what: string, body: Record<string, unknown> = {}): Promise<Booking> {
	try {
		const raw = await apiClient.post<RawBooking>(
			`/bookings/${encodeURIComponent(id)}/${what}/`,
			body
		);
		return mapBooking(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 409) throw new BookingConflictError(e.message);
		throw e;
	}
}

export const confirmBooking = (id: string, tutorNote?: string) =>
	act(id, 'confirm', { tutor_note: tutorNote ?? '' });
export const declineBooking = (id: string, tutorNote?: string) =>
	act(id, 'decline', { tutor_note: tutorNote ?? '' });
export const cancelBooking = (id: string) => act(id, 'cancel');
export const completeBooking = (id: string) => act(id, 'complete');

/** The tutor's other live bookings at the same time — what makes a contested `declared` slot
 * decidable rather than a guess. Tutor-only; a student's own call is refused by the backend. */
export async function getBookingClashes(id: string): Promise<Booking[]> {
	const raw = await apiClient.get<RawBooking[]>(`/bookings/${encodeURIComponent(id)}/clashes/`);
	return raw.map(mapBooking);
}
