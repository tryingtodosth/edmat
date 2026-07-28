// Tutoring/services listings ("Korepetycje" — backend/services/) — named `tutoring.ts` rather than
// the literal `services/services.ts` this app's own "one lib/services/*.ts file per backend app"
// convention would otherwise produce (materials.ts <-> materials/, taxonomy.ts <-> taxonomy/, ...),
// since that self-referential path read as confusing rather than merely unusual. Mirrors the
// backend's own ServiceViewSet 1:1 regardless of the file's own name.

import type { Service, ServiceDraft } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import { mapService, type RawService } from '$lib/api/mappers';

function draftToBody(draft: ServiceDraft): Record<string, unknown> {
	const trimmedRate = draft.hourlyRate.trim();
	return {
		title: draft.title,
		description: draft.description,
		course_slugs: draft.courseIds,
		hourly_rate: trimmedRate ? trimmedRate : null,
		currency: draft.currency,
		is_active: draft.isActive
	};
}

/** The public browse page (`?course=` narrows to one course's own listings, matching the exact
 * "course-scoped discovery" reasoning `ServiceViewSet`'s own doc comment gives). Only ever returns
 * `is_active` listings — a paused one only shows up via `getMyServices` below. */
export async function getServices(courseId?: string): Promise<Service[]> {
	const query = courseId ? `?course=${encodeURIComponent(courseId)}` : '';
	const raw = await apiClient.get<RawService[]>(`/services/${query}`);
	return raw.map(mapService);
}

/** The authenticated user's own listings, INCLUDING paused (`is_active=false`) ones — the "manage
 * my listings" view, matching `ServiceViewSet`'s own `?mine=true` convention. */
export async function getMyServices(): Promise<Service[]> {
	const raw = await apiClient.get<RawService[]>('/services/?mine=true');
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
