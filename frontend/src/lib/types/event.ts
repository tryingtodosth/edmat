/** One-off happenings somebody organises and other people turn up to — mirrors `backend/events/`.
 *
 * Deliberately its own vocabulary rather than a reuse of `TaughtCourse`'s: an event has a host and
 * attendances where a branch has an instructor and enrolments, and the two lifecycles genuinely
 * differ (nobody approves anybody into an event, and an event can be cancelled where a branch is
 * finished). See `backend/events/models.py` for why the two are separate models at all.
 */

/** Three values rather than a published/cancelled pair of booleans — `cancelled` is a state an
 * event stays visible in, not a deletion, because people arranged their week around it. */
export type EventStatus = 'draft' | 'published' | 'cancelled';

/** Where it happens. `hybrid` is a real third answer, not the union of two booleans: an event with a
 * room *and* a link reads as online-only to somebody who would have come in person if the model
 * cannot say both. */
export type EventLocationKind = 'onsite' | 'online' | 'hybrid';

/** What somebody said. "No" is a stored answer rather than the absence of one — see the backend's
 * own note: it is what makes changing your mind give a seat back rather than race a delete. */
export type EventAttendanceStatus = 'going' | 'not_going';

/** Why the viewer cannot answer. A reason rather than a boolean, because "full" and "this already
 * happened" are the same refusal to a boolean and completely different to a person — the same
 * reasoning `EnrollmentBlockReason` records for branches. */
export type EventResponseBlockReason =
	'sign_in' | 'cancelled' | 'not_published' | 'host' | 'past' | 'full';

export interface EventPerson {
	id: string;
	displayName: string;
}

export interface EventAttendee {
	id: string;
	attendee: EventPerson;
	status: EventAttendanceStatus;
	note: string;
	respondedAt: string;
}

export interface EdmatEvent {
	id: string;
	host: EventPerson;
	title: string;
	summary: string;
	description: string;
	subjectSlugs: string[];
	disciplineSlug: string | null;
	status: EventStatus;
	startsAt: string;
	endsAt: string;
	durationMinutes: number;
	locationKind: EventLocationKind;
	locationText: string;
	onlineUrl: string;
	capacity: number;
	language: string;
	goingCount: number;
	/** Always 0 for anybody but the host — a decline is between the person who made it and the
	 * person running the event. */
	declinedCount: number;
	/** `null` for an uncapped event, which is genuinely different from 0 (full). */
	seatsLeft: number | null;
	isFull: boolean;
	isPast: boolean;
	myAttendance: EventAttendanceStatus | null;
	isHost: boolean;
	canRespond: boolean;
	responseBlockReason: EventResponseBlockReason | null;
	createdAt: string;
}

export interface EventDraft {
	title: string;
	summary?: string;
	description?: string;
	subjectSlugs?: string[];
	disciplineSlug?: string | null;
	status?: Exclude<EventStatus, 'cancelled'>;
	startsAt: string;
	durationMinutes: number;
	locationKind: EventLocationKind;
	locationText?: string;
	onlineUrl?: string;
	capacity?: number;
	language?: string;
}

/** The thin projection `/api/my-schedule/` carries for events — a title, a time and an id to click,
 * and deliberately not the whole `EdmatEvent`, since a calendar renders none of the rest. */
export interface ScheduleEvent {
	id: string;
	title: string;
	startsAt: string;
	endsAt: string;
	status: EventStatus;
	locationKind: EventLocationKind;
	isHost: boolean;
}
