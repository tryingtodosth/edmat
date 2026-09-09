// One-off events — mirrors backend/events/ one-to-one.
//
// The mapping is hand-written rather than generated, matching every other service module here: the
// backend speaks snake_case and this app speaks camelCase, and the one place that translation
// happens is the only place a field rename can break.

import type {
	EdmatEvent,
	EventAttendee,
	EventDraft,
	EventPerson,
	EventPost,
	EventPostDraft,
	EventSummary
} from '$lib/types/event';
import { apiClient } from '$lib/api/client';
import type {
	Contribution,
	ContributionDraft,
	ContributionVerb,
	RegistrationAnswers,
	RegistrationField,
	RegistrationFieldDraft,
	EventStaffMember,
	EventStaffRole,
	MyAgenda,
	Session,
	SessionDraft,
	Track
} from '$lib/types/event';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPerson(raw: any): EventPerson {
	return { id: String(raw?.id ?? ''), displayName: raw?.display_name ?? '' };
}

function mapEventSummary(raw: any): EventSummary {
	return {
		id: String(raw.id),
		host: mapPerson(raw.host),
		title: raw.title,
		status: raw.status,
		visibility: raw.visibility ?? 'private',
		startsAt: raw.starts_at ?? null,
		eventTime: raw.event_time ?? null,
		endsAt: raw.ends_at ?? null,
		locationKind: raw.location_kind
	};
}

export function mapEvent(raw: any): EdmatEvent {
	return {
		id: String(raw.id),
		host: mapPerson(raw.host),
		title: raw.title,
		summary: raw.summary ?? '',
		description: raw.description ?? '',
		subjectSlugs: raw.subject_slugs ?? [],
		disciplineSlug: raw.discipline_slug ?? null,
		status: raw.status,
		visibility: raw.visibility ?? 'private',
		startsAt: raw.starts_at ?? null,
		eventTime: raw.event_time ?? null,
		endsAt: raw.ends_at ?? null,
		durationMinutes: raw.duration_minutes ?? 60,
		locationKind: raw.location_kind,
		locationText: raw.location_text ?? '',
		onlineUrl: raw.online_url ?? '',
		capacity: raw.capacity ?? 0,
		language: raw.language ?? 'pl',
		audience: (raw.audience ?? 'university') as EdmatEvent['audience'],
		runsUntil: raw.runs_until ?? null,
		goingCount: raw.going_count ?? 0,
		declinedCount: raw.declined_count ?? 0,
		postCount: raw.post_count ?? 0,
		// `?? null` rather than `?? 0`: an uncapped event genuinely has no seat count, and rendering
		// zero there would read as "full".
		seatsLeft: raw.seats_left === null || raw.seats_left === undefined ? null : raw.seats_left,
		isFull: raw.is_full ?? false,
		isPast: raw.is_past ?? false,
		myAttendance: raw.my_attendance ?? null,
		isHost: raw.is_host ?? false,
		canOrganise: raw.can_organise ?? raw.is_host ?? false,
		canCheckIn: raw.can_check_in ?? raw.is_host ?? false,
		registrationMode: raw.registration_mode ?? 'rsvp',
		showAttendeesPublicly: raw.show_attendees_publicly ?? false,
		registrationFields: (raw.registration_fields ?? []).map(mapRegistrationField),
		waitlistCount: raw.waitlist_count ?? 0,
		pendingCount: raw.pending_count ?? 0,
		myRegistration: raw.my_registration ? mapAttendee(raw.my_registration) : null,
		myWaitlistPosition: raw.my_waitlist_position ?? null,
		cfpOpen: raw.cfp_open ?? false,
		cfpDeadline: raw.cfp_deadline ?? null,
		callIsOpen: raw.call_is_open ?? false,
		contributionCounts: raw.contribution_counts ?? { accepted: 0 },
		canRespond: raw.can_respond ?? false,
		responseBlockReason: raw.response_block_reason ?? null,
		parent: raw.parent ? mapEventSummary(raw.parent) : null,
		subEvents: (raw.sub_events ?? []).map(mapEventSummary),
		createdAt: raw.created_at
	};
}

function mapAttendee(raw: any): EventAttendee {
	return {
		id: String(raw.id),
		attendee: mapPerson(raw.attendee),
		status: raw.status,
		note: raw.note ?? '',
		answers: raw.answers ?? {},
		registeredBy: raw.registered_by ? mapPerson(raw.registered_by) : null,
		waitlistedAt: raw.waitlisted_at ?? null,
		promotionExpiresAt: raw.promotion_expires_at ?? null,
		checkedIn: raw.checked_in ?? false,
		checkedInAt: raw.checked_in_at ?? null,
		sessionIds: (raw.session_ids ?? []).map(String),
		respondedAt: raw.responded_at
	};
}

/** Every field is written only when the caller actually set it, including the four that are required
 * on create. That is what lets one function serve both `createEvent` and the PATCH in `updateEvent`:
 * a partial edit that names only `location_text` must not also send `title: undefined`, which the
 * backend would read as an attempt to blank it. */
function toBody(draft: Partial<EventDraft>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (draft.title !== undefined) body.title = draft.title;
	// `''` and `null` both mean "no date chosen" — normalized to a real `null` here so the backend's
	// nullable `starts_at` sees an explicit clear rather than an empty string it would reject.
	if (draft.startsAt !== undefined) body.starts_at = draft.startsAt || null;
	if (draft.eventTime !== undefined) body.event_time = draft.eventTime || null;
	if (draft.visibility !== undefined) body.visibility = draft.visibility;
	if (draft.durationMinutes !== undefined) body.duration_minutes = draft.durationMinutes;
	if (draft.locationKind !== undefined) body.location_kind = draft.locationKind;
	if (draft.summary !== undefined) body.summary = draft.summary;
	if (draft.description !== undefined) body.description = draft.description;
	if (draft.subjectSlugs !== undefined) body.subject_slugs = draft.subjectSlugs;
	if (draft.disciplineSlug !== undefined) body.discipline_slug = draft.disciplineSlug;
	if (draft.status !== undefined) body.status = draft.status;
	if (draft.locationText !== undefined) body.location_text = draft.locationText;
	if (draft.onlineUrl !== undefined) body.online_url = draft.onlineUrl;
	if (draft.capacity !== undefined) body.capacity = draft.capacity;
	if (draft.language !== undefined) body.language = draft.language;
	if (draft.audience !== undefined) body.audience = draft.audience;
	if (draft.runsUntil !== undefined) body.runs_until = draft.runsUntil || null;
	if (draft.registrationMode !== undefined) body.registration_mode = draft.registrationMode;
	if (draft.showAttendeesPublicly !== undefined)
		body.show_attendees_publicly = draft.showAttendeesPublicly;
	if (draft.parentId !== undefined) body.parent = draft.parentId || null;
	return body;
}

export interface EventQuery {
	/** Defaults to `upcoming` server-side — an events page opening on last month answers nothing. */
	when?: 'upcoming' | 'past';
	mine?: 'hosting' | 'attending';
	subject?: string;
	field?: string;
	/** Free-text search on title/description — the site-wide search page's own filter. */
	q?: string;
}

export async function getEvents(query: EventQuery = {}): Promise<EdmatEvent[]> {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value) params.set(key === 'when' ? 'when' : key, String(value));
	}
	const qs = params.toString();
	const raw = await apiClient.get<any[]>(`/events/${qs ? `?${qs}` : ''}`);
	return raw.map(mapEvent);
}

export async function getEvent(id: string): Promise<EdmatEvent> {
	return mapEvent(await apiClient.get<any>(`/events/${id}/`));
}

export async function createEvent(draft: EventDraft): Promise<EdmatEvent> {
	return mapEvent(await apiClient.post<any>('/events/', toBody(draft)));
}

export async function updateEvent(id: string, draft: Partial<EventDraft>): Promise<EdmatEvent> {
	return mapEvent(await apiClient.patch<any>(`/events/${id}/`, toBody(draft)));
}

export async function cancelEvent(id: string): Promise<EdmatEvent> {
	return mapEvent(await apiClient.post<any>(`/events/${id}/cancel/`, {}));
}

/** One call for both answers, because there is one row and it has a value — see the backend's own
 * note on why an `attend`/`unattend` pair would leave a stale page able to send the wrong one. */
export async function respondToEvent(
	id: string,
	status: 'going' | 'not_going',
	note = '',
	answers?: RegistrationAnswers
): Promise<EdmatEvent> {
	const body = await apiClient.post<any>(`/events/${id}/attend/`, { status, note, answers });
	return mapEvent(body.event);
}

function mapRegistrationField(raw: any): RegistrationField {
	return {
		id: String(raw.id),
		label: raw.label,
		kind: raw.kind,
		required: !!raw.required,
		options: raw.options ?? []
	};
}

// ---- registration (AUDIENCE-BRIEF.md §3.3) ---------------------------------------------------------

export async function getRegistrations(eventId: string): Promise<EventAttendee[]> {
	return (await apiClient.get<any[]>(`/events/${eventId}/registrations/`)).map(mapAttendee);
}
export async function decideRegistration(
	eventId: string,
	rowId: string,
	decision: 'accept' | 'decline',
	note = ''
): Promise<EventAttendee> {
	return mapAttendee(
		await apiClient.post<any>(`/events/${eventId}/registrations/${rowId}/decide/`, {
			decision,
			note
		})
	);
}
export async function setCheckedIn(
	eventId: string,
	rowId: string,
	on: boolean
): Promise<EventAttendee> {
	const path = `/events/${eventId}/registrations/${rowId}/checkin/`;
	return mapAttendee(on ? await apiClient.post<any>(path) : await apiClient.delete<any>(path));
}
export async function getRegistrationsCsv(eventId: string): Promise<string> {
	return apiClient.getText(`/events/${eventId}/registrations/export/`);
}
export async function setRegistrationFields(
	eventId: string,
	fields: RegistrationFieldDraft[]
): Promise<RegistrationField[]> {
	return (await apiClient.put<any[]>(`/events/${eventId}/registration-fields/`, fields)).map(
		mapRegistrationField
	);
}
export async function setSessionSeat(
	eventId: string,
	sessionId: string,
	on: boolean
): Promise<{ registered: boolean; registeredCount: number }> {
	const path = `/events/${eventId}/sessions/${sessionId}/register/`;
	const raw = on ? await apiClient.post<any>(path) : await apiClient.delete<any>(path);
	return { registered: !!raw.registered, registeredCount: raw.registered_count ?? 0 };
}

export async function getEventAttendees(id: string): Promise<EventAttendee[]> {
	const raw = await apiClient.get<any[]>(`/events/${id}/attendees/`);
	return raw.map(mapAttendee);
}

// ---- updates the host posts on the event ------------------------------------------------------

function mapPost(raw: any): EventPost {
	return {
		id: String(raw.id),
		// `null` rather than a blank person: the author genuinely can be gone (SET_NULL on the
		// backend), and a nameless `{id:'', displayName:''}` would render as an empty byline instead
		// of letting the card say the account was deleted.
		author: raw.author ? mapPerson(raw.author) : null,
		body: raw.body ?? '',
		imageUrl: raw.image_url ?? '',
		links: raw.links ?? [],
		createdAt: raw.created_at,
		editedAt: raw.edited_at ?? null,
		isEdited: raw.is_edited ?? false
	};
}

/** A post is sent as multipart whenever a file is involved, and as JSON otherwise.
 *
 * Not multipart always, even though it would be one code path: a form body turns every value into a
 * string, so an empty link list would arrive as `''` rather than as "no links", and the backend's
 * "absent means leave alone, present-and-empty means clear" rule (see its `update`) could not be
 * expressed. JSON keeps that distinction exactly, so it is used wherever there is no file to force
 * the issue.
 */
function postBody(draft: EventPostDraft): FormData | Record<string, unknown> {
	const carriesFile = draft.image !== undefined;
	if (!carriesFile) {
		const body: Record<string, unknown> = {};
		if (draft.body !== undefined) body.body = draft.body;
		if (draft.links !== undefined) body.links = draft.links;
		return body;
	}

	const form = new FormData();
	if (draft.body !== undefined) form.set('body', draft.body);
	// One repeated key per link, which is what `PostLinksField.get_value` reads with `getlist`. An
	// empty list deliberately appends nothing, and the field then sees no `links` key at all — which
	// on a CREATE is correct (no links) and is why clearing links on an EDIT goes through the JSON
	// path above instead.
	for (const link of draft.links ?? []) form.append('links', link);
	// `null` is a real instruction ("remove the picture"), and an empty form value is how multipart
	// can say it — the backend's `image` field is `allow_null`, and DRF reads a blank form field for
	// a nullable file field as None.
	form.set('image', draft.image ?? '');
	return form;
}

export async function getEventPosts(eventId: string): Promise<EventPost[]> {
	const raw = await apiClient.get<any[]>(`/events/${eventId}/posts/`);
	return raw.map(mapPost);
}

export async function createEventPost(eventId: string, draft: EventPostDraft): Promise<EventPost> {
	const body = postBody(draft);
	const raw =
		body instanceof FormData
			? await apiClient.postForm<any>(`/events/${eventId}/posts/`, body)
			: await apiClient.post<any>(`/events/${eventId}/posts/`, body);
	return mapPost(raw);
}

export async function updateEventPost(
	eventId: string,
	postId: string,
	draft: EventPostDraft
): Promise<EventPost> {
	const body = postBody(draft);
	const path = `/events/${eventId}/posts/${postId}/`;
	const raw =
		body instanceof FormData
			? await apiClient.patchForm<any>(path, body)
			: await apiClient.patch<any>(path, body);
	return mapPost(raw);
}

export async function deleteEventPost(eventId: string, postId: string): Promise<void> {
	await apiClient.delete(`/events/${eventId}/posts/${postId}/`);
}

// ---- the programme (AUDIENCE-BRIEF.md §3.1, §3.2, §3.5) --------------------------------------------

function mapStaff(raw: any): EventStaffMember {
	return {
		id: String(raw.id),
		user: mapPerson(raw.user),
		role: raw.role,
		isHost: raw.is_host ?? false,
		addedAt: raw.added_at
	};
}

function mapTrack(raw: any): Track {
	return { id: String(raw.id), name: raw.name, colour: raw.colour ?? '', order: raw.order ?? 0 };
}

export function mapSession(raw: any): Session {
	return {
		id: String(raw.id),
		eventId: String(raw.event),
		trackId: raw.track === null || raw.track === undefined ? null : String(raw.track),
		kind: raw.kind ?? 'talk',
		title: raw.title,
		abstract: raw.abstract ?? '',
		startsAt: raw.starts_at,
		durationMinutes: raw.duration_minutes ?? 60,
		endsAt: raw.ends_at,
		locationText: raw.location_text ?? '',
		onlineUrl: raw.online_url ?? '',
		capacity: raw.capacity ?? 0,
		speakers: (raw.speakers ?? []).map((s: any) => ({
			id: String(s.id),
			user: s.user ? mapPerson(s.user) : null,
			name: s.name,
			affiliation: s.affiliation ?? '',
			bio: s.bio ?? ''
		})),
		links: (raw.links ?? []).map((l: any) => ({
			id: String(l.id),
			kind: l.kind,
			title: l.title ?? '',
			materialId: l.material === null || l.material === undefined ? null : String(l.material),
			exerciseId: l.exercise === null || l.exercise === undefined ? null : String(l.exercise),
			setSlug: l.exercise_set ?? null,
			url: l.url ?? '',
			role: l.role ?? 'other',
			label: l.label ?? '',
			note: l.note ?? ''
		})),
		bookmarkCount: raw.bookmark_count ?? 0,
		isBookmarked: raw.is_bookmarked ?? false,
		registeredCount: raw.registered_count ?? 0,
		isRegistered: raw.is_registered ?? false
	};
}

function sessionBody(draft: Partial<SessionDraft>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (draft.trackId !== undefined) body.track = draft.trackId ? Number(draft.trackId) : null;
	if (draft.kind !== undefined) body.kind = draft.kind;
	if (draft.title !== undefined) body.title = draft.title;
	if (draft.abstract !== undefined) body.abstract = draft.abstract;
	if (draft.startsAt !== undefined) body.starts_at = draft.startsAt;
	if (draft.durationMinutes !== undefined) body.duration_minutes = draft.durationMinutes;
	if (draft.locationText !== undefined) body.location_text = draft.locationText;
	if (draft.onlineUrl !== undefined) body.online_url = draft.onlineUrl;
	if (draft.capacity !== undefined) body.capacity = draft.capacity;
	if (draft.speakers !== undefined)
		body.speakers = draft.speakers.map((s) => ({
			user_id: s.userId ? Number(s.userId) : null,
			name: s.name,
			affiliation: s.affiliation ?? '',
			bio: s.bio ?? ''
		}));
	if (draft.links !== undefined)
		body.links = draft.links.map((l) => ({
			material: l.materialId ? Number(l.materialId) : null,
			exercise: l.exerciseId ? Number(l.exerciseId) : null,
			exercise_set: l.setSlug ?? null,
			url: l.url ?? '',
			role: l.role,
			label: l.label ?? '',
			note: l.note ?? ''
		}));
	return body;
}

export async function getEventStaff(eventId: string): Promise<EventStaffMember[]> {
	const raw = await apiClient.get<any[]>(`/events/${eventId}/staff/`);
	return raw.map(mapStaff);
}
export async function addEventStaff(
	eventId: string,
	userId: string,
	role: EventStaffRole
): Promise<EventStaffMember> {
	return mapStaff(
		await apiClient.post<any>(`/events/${eventId}/staff/`, { user: Number(userId), role })
	);
}
export async function setEventStaffRole(
	eventId: string,
	staffId: string,
	role: EventStaffRole
): Promise<EventStaffMember> {
	return mapStaff(await apiClient.patch<any>(`/events/${eventId}/staff/${staffId}/`, { role }));
}
export async function removeEventStaff(eventId: string, staffId: string): Promise<void> {
	await apiClient.delete(`/events/${eventId}/staff/${staffId}/`);
}

export async function getTracks(eventId: string): Promise<Track[]> {
	return (await apiClient.get<any[]>(`/events/${eventId}/tracks/`)).map(mapTrack);
}
export async function createTrack(eventId: string, name: string, colour = ''): Promise<Track> {
	return mapTrack(await apiClient.post<any>(`/events/${eventId}/tracks/`, { name, colour }));
}
export async function deleteTrack(eventId: string, trackId: string): Promise<void> {
	await apiClient.delete(`/events/${eventId}/tracks/${trackId}/`);
}

export async function getSessions(eventId: string): Promise<Session[]> {
	return (await apiClient.get<any[]>(`/events/${eventId}/sessions/`)).map(mapSession);
}
export async function createSession(eventId: string, draft: SessionDraft): Promise<Session> {
	return mapSession(await apiClient.post<any>(`/events/${eventId}/sessions/`, sessionBody(draft)));
}
export async function updateSession(
	eventId: string,
	sessionId: string,
	draft: Partial<SessionDraft>
): Promise<Session> {
	return mapSession(
		await apiClient.patch<any>(`/events/${eventId}/sessions/${sessionId}/`, sessionBody(draft))
	);
}
export async function deleteSession(eventId: string, sessionId: string): Promise<void> {
	await apiClient.delete(`/events/${eventId}/sessions/${sessionId}/`);
}
export async function setSessionBookmark(
	eventId: string,
	sessionId: string,
	on: boolean
): Promise<Session> {
	const path = `/events/${eventId}/sessions/${sessionId}/bookmark/`;
	return mapSession(on ? await apiClient.post<any>(path) : await apiClient.delete<any>(path));
}

/** The reverse listing: every visible session that links this material / exercise / set. */
export async function getSessionsLinking(ref: {
	materialId?: string;
	exerciseId?: string;
	setSlug?: string;
}): Promise<Session[]> {
	const params = new URLSearchParams();
	if (ref.materialId) params.set('material', ref.materialId);
	if (ref.exerciseId) params.set('exercise', ref.exerciseId);
	if (ref.setSlug) params.set('exercise_set', ref.setSlug);
	const raw = await apiClient.get<any[]>(`/sessions/?${params.toString()}`);
	return raw.map(mapSession);
}

export async function getMyAgenda(): Promise<MyAgenda> {
	const raw = await apiClient.get<any>('/my-agenda/');
	return {
		sessions: (raw.sessions ?? []).map(mapSession),
		events: (raw.events ?? []).map(mapEventSummary)
	};
}

/** `.ics` bytes for one event's programme, or for the signed-in person's own agenda. Fetched
 * through the client (so the token travels in a header, never in a URL) and handed to the caller
 * to save — see `downloadText` in utils/download.ts. */
export async function getEventIcs(eventId: string): Promise<string> {
	return apiClient.getText(`/events/${eventId}/ics/`);
}
export async function getMyAgendaIcs(): Promise<string> {
	return apiClient.getText('/my-agenda.ics');
}

// ---- the call for contributions (AUDIENCE-BRIEF.md §3.4) --------------------------------------------

function mapContribution(raw: any): Contribution {
	return {
		id: String(raw.id),
		eventId: String(raw.event),
		submitter: mapPerson(raw.submitter),
		kind: raw.kind ?? 'talk',
		title: raw.title,
		abstract: raw.abstract ?? '',
		audience: raw.audience ?? 'university',
		coAuthors: (raw.co_authors ?? []).map((c: any) => ({
			name: c.name ?? '',
			affiliation: c.affiliation ?? ''
		})),
		notesToOrganiser: raw.notes_to_organiser ?? '',
		status: raw.status,
		sessionId:
			raw.session_id === null || raw.session_id === undefined ? null : String(raw.session_id),
		reasonCode: raw.reason_code ?? '',
		reviewNote: raw.review_note ?? '',
		decidedBy: raw.decided_by ? mapPerson(raw.decided_by) : null,
		decidedAt: raw.decided_at ?? null,
		submittedAt: raw.submitted_at ?? null,
		canEdit: raw.can_edit ?? false
	};
}
function contributionBody(draft: Partial<ContributionDraft>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (draft.kind !== undefined) body.kind = draft.kind;
	if (draft.title !== undefined) body.title = draft.title;
	if (draft.abstract !== undefined) body.abstract = draft.abstract;
	if (draft.audience !== undefined) body.audience = draft.audience;
	if (draft.coAuthors !== undefined) body.co_authors = draft.coAuthors;
	if (draft.notesToOrganiser !== undefined) body.notes_to_organiser = draft.notesToOrganiser;
	return body;
}
export async function getContributions(eventId: string): Promise<Contribution[]> {
	return (await apiClient.get<any[]>(`/events/${eventId}/contributions/`)).map(mapContribution);
}
export async function proposeContribution(
	eventId: string,
	draft: ContributionDraft
): Promise<Contribution> {
	return mapContribution(
		await apiClient.post<any>(`/events/${eventId}/contributions/`, {
			...contributionBody(draft),
			submit: true
		})
	);
}
export async function updateContribution(
	eventId: string,
	id: string,
	draft: Partial<ContributionDraft>
): Promise<Contribution> {
	return mapContribution(
		await apiClient.patch<any>(`/events/${eventId}/contributions/${id}/`, contributionBody(draft))
	);
}
export async function transitionContribution(
	eventId: string,
	id: string,
	verb: ContributionVerb,
	extra: Record<string, unknown> = {}
): Promise<Contribution> {
	return mapContribution(
		await apiClient.post<any>(`/events/${eventId}/contributions/${id}/${verb}/`, extra)
	);
}
