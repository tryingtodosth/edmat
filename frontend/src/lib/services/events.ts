// One-off events — mirrors backend/events/ one-to-one.
//
// The mapping is hand-written rather than generated, matching every other service module here: the
// backend speaks snake_case and this app speaks camelCase, and the one place that translation
// happens is the only place a field rename can break.

import type {
	EdmatEvent,
	EventAttendanceStatus,
	EventAttendee,
	EventDraft,
	EventPerson,
	EventPost,
	EventPostDraft
} from '$lib/types/event';
import { apiClient } from '$lib/api/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPerson(raw: any): EventPerson {
	return { id: String(raw?.id ?? ''), displayName: raw?.display_name ?? '' };
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
		startsAt: raw.starts_at,
		endsAt: raw.ends_at,
		durationMinutes: raw.duration_minutes ?? 60,
		locationKind: raw.location_kind,
		locationText: raw.location_text ?? '',
		onlineUrl: raw.online_url ?? '',
		capacity: raw.capacity ?? 0,
		language: raw.language ?? 'pl',
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
		canRespond: raw.can_respond ?? false,
		responseBlockReason: raw.response_block_reason ?? null,
		createdAt: raw.created_at
	};
}

function mapAttendee(raw: any): EventAttendee {
	return {
		id: String(raw.id),
		attendee: mapPerson(raw.attendee),
		status: raw.status,
		note: raw.note ?? '',
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
	if (draft.startsAt !== undefined) body.starts_at = draft.startsAt;
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
	return body;
}

export interface EventQuery {
	/** Defaults to `upcoming` server-side — an events page opening on last month answers nothing. */
	when?: 'upcoming' | 'past';
	mine?: 'hosting' | 'attending';
	subject?: string;
	field?: string;
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
	status: EventAttendanceStatus,
	note = ''
): Promise<EdmatEvent> {
	const body = await apiClient.post<any>(`/events/${id}/attend/`, { status, note });
	return mapEvent(body.event);
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
