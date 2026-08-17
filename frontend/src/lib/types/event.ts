/** One-off happenings somebody organises and other people turn up to — mirrors `backend/events/`.
 *
 * Deliberately its own vocabulary rather than a reuse of `Course`'s: an event has a host and
 * attendances where a branch has an instructor and enrolments, and the two lifecycles genuinely
 * differ (nobody approves anybody into an event, and an event can be cancelled where a branch is
 * finished). See `backend/events/models.py` for why the two are separate models at all.
 */

/** Three values rather than a published/cancelled pair of booleans — `cancelled` is a state an
 * event stays visible in, not a deletion, because people arranged their week around it. */
export type EventStatus = 'draft' | 'published' | 'cancelled';

/** Who besides the host can ever see this event — independent of `status`. `status` asks "has this
 * been announced"; `visibility` asks "who is it announced TO". Defaults to `private` everywhere a
 * new event is drafted: creating something is not the same act as broadcasting it. */
export type EventVisibility = 'private' | 'public';

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
	visibility: EventVisibility;
	/** `null` means genuinely unscheduled — no date, no time, nothing guessed in its place. */
	startsAt: string | null;
	/** An hour with no known date yet ("sometime around 3pm") — only ever meaningful when `startsAt`
	 * is `null`; the moment a real instant exists, that is always the more useful of the two and
	 * every reader (ordering, notifications, calendar-blocking) ignores this field entirely. Stored
	 * as the bare `HH:MM:SS` the backend's `TimeField` serializes, not an ISO instant. */
	eventTime: string | null;
	/** `null` exactly when `startsAt` is — there is nothing to add a duration to. */
	endsAt: string | null;
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
	/** How many updates the host has posted. Carried on the event itself so a listing can say an
	 * event has news without fetching each one's feed. */
	postCount: number;
	/** `null` for an uncapped event, which is genuinely different from 0 (full). */
	seatsLeft: number | null;
	isFull: boolean;
	isPast: boolean;
	myAttendance: EventAttendanceStatus | null;
	isHost: boolean;
	canRespond: boolean;
	responseBlockReason: EventResponseBlockReason | null;
	/** The bigger event this one belongs to, resolved server-side — `null` when there isn't one, or
	 * when the viewer isn't allowed to see it (a private parent stays invisible even to somebody who
	 * can see this sub-event, exactly the OR-logic `_visible_to` already applies everywhere else). */
	parent: EventSummary | null;
	/** The smaller events grouped under this one, already filtered to what the viewer may see — a
	 * private sub-event never leaks through its public parent's own detail response. */
	subEvents: EventSummary[];
	createdAt: string;
}

/** Just enough to name a sub-event or a parent event in a listing — mirrors the backend's own
 * `EventSummarySerializer`. Link to `/events/[id]` for the rest. */
export interface EventSummary {
	id: string;
	host: EventPerson;
	title: string;
	status: EventStatus;
	visibility: EventVisibility;
	startsAt: string | null;
	eventTime: string | null;
	endsAt: string | null;
	locationKind: EventLocationKind;
}

export interface EventDraft {
	title: string;
	summary?: string;
	description?: string;
	subjectSlugs?: string[];
	disciplineSlug?: string | null;
	status?: Exclude<EventStatus, 'cancelled'>;
	visibility?: EventVisibility;
	/** `null`/`''` — no date chosen yet. Genuinely optional, unlike every other field here that just
	 * happens to have a default. */
	startsAt?: string | null;
	/** An hour with no date — mutually exclusive with `startsAt` in practice, never enforced as a
	 * hard rule; see `EdmatEvent.eventTime`. */
	eventTime?: string | null;
	durationMinutes: number;
	locationKind: EventLocationKind;
	locationText?: string;
	onlineUrl?: string;
	capacity?: number;
	language?: string;
	/** The bigger event this one is part of — only ever settable to an event the current user hosts
	 * themselves, and only one that isn't itself a sub-event; see the backend's own `validate_parent`. */
	parentId?: string | null;
}

/** One update the host wrote on an event after announcing it — mirrors `backend/events/models.py`'s
 * `EventPost`.
 *
 * Deliberately not the event's own `description`, and deliberately not a comment: a description
 * answers "what is this?" and is edited in place, a comment is a conversation anybody may join, and
 * this is a dated broadcast from the one person running the thing. See the backend model's own note.
 */
export interface EventPost {
	id: string;
	/** `null` for a post whose author has since deleted their account — the announcement outlives
	 * them, because the people who need "the venue has moved" are the attendees. */
	author: EventPerson | null;
	body: string;
	/** `''` when there is no picture, rather than null — every read site wants to ask `if (imageUrl)`
	 * and an absent key would make that three checks instead of one. */
	imageUrl: string;
	links: string[];
	createdAt: string;
	/** `null` until somebody edits it. A real stamp rather than a comparison against `createdAt`,
	 * which would read as "edited" for every post ever written — see the backend field's own note. */
	editedAt: string | null;
	isEdited: boolean;
}

/** What the host is composing. `image` is a browser `File` rather than a URL because it has not been
 * uploaded yet — the service layer is what turns this into the multipart body. */
export interface EventPostDraft {
	body?: string;
	image?: File | null;
	links?: string[];
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
