// Booking sessions with a tutor (backend/booking/) — availability, the tutor's own schedule rules,
// and the booking lifecycle. Mirrors that app's endpoints 1:1, matching this app's own
// "one lib/services/*.ts file per backend app" convention.

import type {
	AvailabilityException,
	AvailabilityExceptionKind,
	AvailabilityRule,
	Booking,
	EffectiveWeek,
	ScheduleWindow,
	ServiceAvailability,
	TutorSchedule,
	WeekApplyResult,
	WeekTemplate
} from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	mapAvailabilityException,
	mapAvailabilityRule,
	mapBooking,
	mapEffectiveWeek,
	mapServiceAvailability,
	mapTutorSchedule,
	mapWeekApplyResult,
	mapWeekTemplate,
	scheduleWindowToRaw,
	type RawAvailabilityException,
	type RawAvailabilityRule,
	type RawBooking,
	type RawEffectiveWeek,
	type RawServiceAvailability,
	type RawTutorSchedule,
	type RawWeekApplyResult,
	type RawWeekTemplate
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

/** The caller's own calendar over a date range — published windows, plus the bookings sitting inside
 * them, from both sides of their account. A separate endpoint from the availability above because
 * the two answer genuinely different questions; see the backend's `MyScheduleView` for the reasoning. */
export async function getMySchedule(from: string, to: string): Promise<TutorSchedule> {
	const search = new URLSearchParams({ from, to });
	const raw = await apiClient.get<RawTutorSchedule>(`/my-schedule/?${search.toString()}`);
	return mapTutorSchedule(raw);
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

/** Move or resize one repeating rule. Only ever called from the calendar editor — the form below it
 * adds and removes, because typing a whole rule again is a stranger way to move it by half an hour
 * than dragging it. */
export async function updateAvailabilityRule(
	id: string,
	patch: { weekday?: number; startTime?: string; endTime?: string }
): Promise<AvailabilityRule> {
	const body: Record<string, unknown> = {};
	if (patch.weekday !== undefined) body.weekday = patch.weekday;
	if (patch.startTime !== undefined) body.start_time = patch.startTime;
	if (patch.endTime !== undefined) body.end_time = patch.endTime;
	const raw = await apiClient.patch<RawAvailabilityRule>(
		`/availability-rules/${encodeURIComponent(id)}/`,
		body
	);
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

// ---- weeks that do not follow the repeating pattern, and the templates behind them --------------
//
// The repeating rules above are what happens by default, forever. Everything below is for saying
// something different about a particular run of weeks — which is a genuinely separate question, and
// the reason `AvailabilityRule` alone could never answer "change the third week only": an unbounded
// weekly rule has no version of itself that applies to one week.

/** One week's hours, whether or not that week has been detached from the repeating pattern.
 *
 * Answers for every week, which is what lets the editor draw the same picture either way. `detached`
 * says which of the two it is, because an edit means something different in each case. */
export async function getEffectiveWeek(weekStart: string): Promise<EffectiveWeek> {
	const raw = await apiClient.get<RawEffectiveWeek>(
		`/week-schedules/week/?week_start=${encodeURIComponent(weekStart)}`
	);
	return mapEffectiveWeek(raw);
}

/** Write one week's hours, detaching it from the repeating pattern if it was not already.
 *
 * A full replace of the week rather than one window at a time, matching how the editor works — it
 * submits the week it is showing — and how this project's other list-shaped editors already behave.
 * An empty list is a real statement ("I am not working that week"), not a no-op. */
export async function saveWeek(
	weekStart: string,
	windows: ScheduleWindow[]
): Promise<EffectiveWeek> {
	const raw = await apiClient.put<RawEffectiveWeek>('/week-schedules/week/', {
		week_start: weekStart,
		windows: windows.map(scheduleWindowToRaw)
	});
	return mapEffectiveWeek(raw);
}

/** Which weeks in a range have their own schedule. Used only to mark them in the month view — the
 * editor itself reads one week at a time through `getEffectiveWeek`. */
export async function getWeekSchedules(from: string, to: string): Promise<EffectiveWeek[]> {
	const raw = await apiClient.get<RawEffectiveWeek[]>(
		`/week-schedules/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
	);
	// The list serializer names the FK `source_template` and has no `detached` of its own — every row
	// it returns is a detached week by definition, which is what the row IS.
	return raw.map((row) => mapEffectiveWeek({ ...row, detached: true }));
}

/** Put a week back on the repeating pattern. Not "delete my hours" — the hours it goes back to are
 * the ordinary ones, which is why the button says reattach. */
export async function reattachWeek(id: string): Promise<void> {
	await apiClient.delete(`/week-schedules/${encodeURIComponent(id)}/`);
}

export async function getWeekTemplates(): Promise<WeekTemplate[]> {
	const raw = await apiClient.get<RawWeekTemplate[]>('/week-templates/');
	return raw.map(mapWeekTemplate);
}

/** Save the week currently on screen as a reusable template. Reads the week server-side rather than
 * posting the windows from here, so it captures the same hours the calendar is drawing whether that
 * week is detached or still following the pattern. */
export async function saveWeekAsTemplate(weekStart: string, name: string): Promise<WeekTemplate> {
	const raw = await apiClient.post<RawWeekTemplate>('/week-templates/from-week/', {
		week_start: weekStart,
		name
	});
	return mapWeekTemplate(raw);
}

export async function deleteWeekTemplate(id: string): Promise<void> {
	await apiClient.delete(`/week-templates/${encodeURIComponent(id)}/`);
}

export interface WeekApplyDraft {
	/** Exactly one of these two. A template is a shape off the shelf; a week is "use this one again". */
	sourceTemplateId?: string;
	sourceWeek?: string;
	/** The first week to write. Normalised to its Monday server-side. */
	weekStart: string;
	weeks: number;
	/** False leaves weeks that already have their own schedule alone, so re-applying a template after
	 * hand-editing week three does not throw that edit away. */
	overwrite: boolean;
}

export async function applyWeeks(draft: WeekApplyDraft): Promise<WeekApplyResult> {
	const raw = await apiClient.post<RawWeekApplyResult>('/week-schedules/apply/', {
		source_template: draft.sourceTemplateId ? Number(draft.sourceTemplateId) : null,
		source_week: draft.sourceWeek ?? null,
		week_start: draft.weekStart,
		weeks: draft.weeks,
		overwrite: draft.overwrite
	});
	return mapWeekApplyResult(raw);
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
