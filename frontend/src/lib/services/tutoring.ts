// Tutoring/services listings ("Korepetycje" — backend/services/) — named `tutoring.ts` rather than
// the literal `services/services.ts` this app's own "one lib/services/*.ts file per backend app"
// convention would otherwise produce (materials.ts <-> materials/, taxonomy.ts <-> taxonomy/, ...),
// since that self-referential path read as confusing rather than merely unusual. Mirrors the
// backend's own ServiceViewSet 1:1 regardless of the file's own name.

import type { Service, ServiceDraft, ServiceReview, ServiceWatch } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	FRONTEND_TO_BACKEND_DELIVERY_MODE,
	mapService,
	mapServiceReview,
	mapServiceWatch,
	type RawService,
	type RawServiceReview,
	type RawServiceWatch
} from '$lib/api/mappers';

/** Browse-page filters. `deliveryMode` here is a QUESTION, not a listing's own answer: asking for
 * `inPerson` matches both in-person and hybrid listings, since a hybrid tutor genuinely satisfies
 * someone who wants to meet in person (and likewise for `online`). Hence no `hybrid` option — it is
 * not a thing a student searches for, it is a thing a tutor offers. */
export interface ServiceBrowseFilters {
	deliveryMode?: 'online' | 'inPerson';
	near?: { lat: number; lon: number; radiusKm?: number };
}

function draftToBody(draft: ServiceDraft): Record<string, unknown> {
	const trimmedRate = draft.hourlyRate.trim();
	return {
		title: draft.title,
		description: draft.description,
		course_slugs: draft.courseIds,
		hourly_rate: trimmedRate ? trimmedRate : null,
		currency: draft.currency,
		is_active: draft.isActive,
		delivery_mode: FRONTEND_TO_BACKEND_DELIVERY_MODE[draft.deliveryMode],
		// Always sent, including as empty/null for an online-only listing — the backend clears any
		// previous location when the mode is online, and sending nothing on a PATCH would instead
		// leave a stale pin in place on a listing that no longer has a physical location at all.
		location_label: draft.locationLabel,
		location_lat: draft.locationLat,
		location_lon: draft.locationLon,
		availability_mode: draft.availabilityMode,
		// Parsed once, here, rather than kept a number through the form — see ServiceDraft's own note
		// on why an in-progress field stays a string. An unparseable value falls back to the backend's
		// own default instead of sending NaN, which would 400 with a message about a field the tutor
		// may not even have touched.
		session_minutes: Number(draft.sessionMinutes.trim()) || 60
	};
}

/** The public browse page (`?course=` narrows to one course's own listings, matching the exact
 * "course-scoped discovery" reasoning `ServiceViewSet`'s own doc comment gives). Only ever returns
 * `is_active` listings — a paused one only shows up via `getMyServices` below. */
export async function getServices(
	courseId?: string,
	filters: ServiceBrowseFilters = {}
): Promise<Service[]> {
	const search = new URLSearchParams();
	if (courseId) search.set('course', courseId);
	if (filters.deliveryMode) {
		search.set('delivery_mode', FRONTEND_TO_BACKEND_DELIVERY_MODE[filters.deliveryMode]);
	}
	// "Tutors within N km of me" — what makes a stored location useful rather than merely displayed.
	if (filters.near) {
		search.set('near', `${filters.near.lat},${filters.near.lon}`);
		if (filters.near.radiusKm) search.set('radius_km', String(filters.near.radiusKm));
	}
	const query = search.toString();
	const raw = await apiClient.get<RawService[]>(`/services/${query ? `?${query}` : ''}`);
	return raw.map(mapService);
}

/** The authenticated user's own listings, INCLUDING paused (`is_active=false`) ones — the "manage
 * my listings" view, matching `ServiceViewSet`'s own `?mine=true` convention. */
export async function getMyServices(): Promise<Service[]> {
	const raw = await apiClient.get<RawService[]>('/services/?mine=true');
	return raw.map(mapService);
}

/** A specific user's own ACTIVE tutoring listings — the public profile page's own "their tutoring
 * listings" section. Only ever active ones (the backend's own `?provider=` filter reuses the
 * ordinary public-browse default, services/views.py's own doc comment), matching what a stranger
 * visiting that profile should see — never a paused listing, even the profile owner's own. */
export async function getServicesByProvider(userId: string): Promise<Service[]> {
	const raw = await apiClient.get<RawService[]>(
		`/services/?provider=${encodeURIComponent(userId)}`
	);
	return raw.map(mapService);
}

// Thrown specifically for an unknown course slug (services/serializers.py's own
// `validate_course_slugs`) — a distinct, named error so a caller can show a real, specific message
// rather than the generic one every other failure gets.
export class UnknownCourseError extends Error {}

export async function createService(draft: ServiceDraft): Promise<Service> {
	try {
		const raw = await apiClient.post<RawService>('/services/', draftToBody(draft));
		return mapService(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 400 && e.body && typeof e.body === 'object') {
			if ('course_slugs' in (e.body as Record<string, unknown>)) {
				throw new UnknownCourseError(e.message);
			}
		}
		throw e;
	}
}

export async function updateService(id: string, draft: ServiceDraft): Promise<Service> {
	const raw = await apiClient.patch<RawService>(
		`/services/${encodeURIComponent(id)}/`,
		draftToBody(draft)
	);
	return mapService(raw);
}

export async function deleteService(id: string): Promise<void> {
	await apiClient.delete(`/services/${encodeURIComponent(id)}/`);
}

/** A single listing's own detail page — public, matching `ExerciseSetViewSet.retrieve`'s own
 * "public GET, owner-scoped writes" precedent (CLAUDE.md Section 17J); the backend's own
 * `get_queryset` additionally lets a provider view their own paused listing directly (see
 * services/views.py's own doc comment), so a 404 here means either a genuinely nonexistent id or
 * someone else's paused listing — same 404-swallowing shape `getSharedSet` already establishes. */
export async function getServiceById(id: string): Promise<Service | undefined> {
	try {
		const raw = await apiClient.get<RawService>(`/services/${encodeURIComponent(id)}/`);
		return mapService(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

/** A specific user's own authored tutoring-listing reviews — the public profile page's own "their
 * reviews" section, the `ServiceReview` counterpart to `getReviewsByUser` (reviews.ts). */
export async function getServiceReviewsByUser(userId: string): Promise<ServiceReview[]> {
	const raw = await apiClient.get<RawServiceReview[]>(
		`/users/${encodeURIComponent(userId)}/service-reviews/`
	);
	const reviews = raw.map(mapServiceReview);
	reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return reviews;
}

export async function getServiceReviews(serviceId: string): Promise<ServiceReview[]> {
	const raw = await apiClient.get<RawServiceReview[]>(
		`/services/${encodeURIComponent(serviceId)}/reviews/`
	);
	const reviews = raw.map(mapServiceReview);
	reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return reviews;
}

// `userId` stays a parameter for call-site compatibility with `submitReview` (exercises' own
// review submission) — the backend already scopes this to whoever the auth token belongs to
// (ServiceReview.author = request.user, services/views.py's own `reviews` action), and already
// upserts on resubmission rather than duplicating (unique_together = [('service', 'author')]).
export async function submitServiceReview(
	serviceId: string,
	_userId: string,
	rating: number,
	body?: string
): Promise<ServiceReview> {
	const raw = await apiClient.post<RawServiceReview>(
		`/services/${encodeURIComponent(serviceId)}/reviews/`,
		{ rating, body: body?.trim() || '' }
	);
	return mapServiceReview(raw);
}

/** The current user's own watchlist — authenticated-only, no public read at all (a watchlist is
 * inherently personal, see `ServiceWatchViewSet`'s own doc comment). Each row already embeds its
 * full `Service`, so a comparison view can render straight from this one response. */
export async function getWatchlist(): Promise<ServiceWatch[]> {
	const raw = await apiClient.get<RawServiceWatch[]>('/service-watches/');
	return raw.map(mapServiceWatch);
}

// Thrown specifically for an already-watched listing (services/serializers.py's own
// `ServiceWatchSerializer.validate`) — a distinct, named error so a caller can show a real,
// specific message rather than the generic one every other failure gets.
export class AlreadyWatchingError extends Error {}

export async function watchService(serviceId: string): Promise<ServiceWatch> {
	try {
		const raw = await apiClient.post<RawServiceWatch>('/service-watches/', {
			service: Number(serviceId)
		});
		return mapServiceWatch(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 400) {
			throw new AlreadyWatchingError(e.message);
		}
		throw e;
	}
}

export async function unwatchService(watchId: string): Promise<void> {
	await apiClient.delete(`/service-watches/${encodeURIComponent(watchId)}/`);
}
