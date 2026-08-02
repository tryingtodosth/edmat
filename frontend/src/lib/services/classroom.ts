// Courses run by users — mirrors backend/classroom/ one-to-one.
//
// Named `classroom.ts` rather than `courses.ts` on purpose: `taxonomy.ts` already owns the
// university-subject sense of "course", and two service modules whose names both claim that word
// would be a genuine source of wrong imports.

import type {
	Enrollment,
	EnrollmentStatus,
	Lesson,
	LessonDraft,
	TaughtCourse,
	TaughtCourseDraft
} from '$lib/types/classroom';
import { apiClient, ApiError } from '$lib/api/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapLesson(raw: any): Lesson {
	return {
		id: String(raw.id),
		title: raw.title,
		description: raw.description,
		order: raw.order,
		scheduledAt: raw.scheduled_at,
		durationMinutes: raw.duration_minutes,
		exerciseIds: (raw.exercise_ids ?? []).map(String),
		materialIds: (raw.material_ids ?? []).map(String),
		participantNotes: raw.participant_notes ?? ''
	};
}

function mapCourse(raw: any): TaughtCourse {
	return {
		id: String(raw.id),
		instructor: {
			id: String(raw.instructor?.id ?? ''),
			displayName: raw.instructor?.display_name ?? ''
		},
		title: raw.title,
		summary: raw.summary,
		description: raw.description,
		subjectSlugs: raw.subject_slugs ?? [],
		fieldSlug: raw.field_slug ?? null,
		status: raw.status,
		enrollmentPolicy: raw.enrollment_policy,
		capacity: raw.capacity,
		language: raw.language,
		startsOn: raw.starts_on,
		endsOn: raw.ends_on,
		price: raw.price,
		currency: raw.currency,
		createdAt: raw.created_at,
		lessons: (raw.lessons ?? []).map(mapLesson),
		participantCount: raw.participant_count ?? 0,
		seatsLeft: raw.seats_left ?? null,
		isFull: raw.is_full ?? false,
		myEnrollmentStatus: raw.my_enrollment_status ?? null,
		canEnrol: raw.can_enrol ?? false,
		enrollmentBlockReason: raw.enrollment_block_reason ?? null,
		isInstructor: raw.is_instructor ?? false
	};
}

function mapEnrollment(raw: any): Enrollment {
	return {
		id: String(raw.id),
		courseId: String(raw.course_id),
		courseTitle: raw.course_title ?? '',
		participant: {
			id: String(raw.participant?.id ?? ''),
			displayName: raw.participant?.display_name ?? ''
		},
		status: raw.status,
		requestNote: raw.request_note ?? '',
		requestedAt: raw.requested_at,
		decidedAt: raw.decided_at
	};
}

function draftToBody(draft: TaughtCourseDraft): Record<string, unknown> {
	return {
		title: draft.title,
		summary: draft.summary,
		description: draft.description,
		subjects: draft.subjects,
		field: draft.field,
		status: draft.status,
		enrollment_policy: draft.enrollmentPolicy,
		capacity: draft.capacity,
		language: draft.language,
		// Empty date inputs must go as null, not '' — a blank string is not a date and the API
		// rightly refuses it.
		starts_on: draft.startsOn || null,
		ends_on: draft.endsOn || null,
		price: draft.price || null,
		currency: draft.currency
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface CourseFilters {
	subject?: string;
	field?: string;
	/** Only courses actually taking people right now. */
	openOnly?: boolean;
}

export async function getCourses(filters: CourseFilters = {}): Promise<TaughtCourse[]> {
	const search = new URLSearchParams();
	if (filters.subject) search.set('subject', filters.subject);
	if (filters.field) search.set('field', filters.field);
	if (filters.openOnly) search.set('open', 'true');
	const query = search.toString();
	const raw = await apiClient.get<unknown[]>(`/taught-courses/${query ? `?${query}` : ''}`);
	return raw.map(mapCourse);
}

/** Courses this account runs, drafts included — the drafts are the point of the view. */
export async function getMyTeaching(): Promise<TaughtCourse[]> {
	const raw = await apiClient.get<unknown[]>('/taught-courses/?mine=teaching');
	return raw.map(mapCourse);
}

/** Courses this account is in, including requests still waiting on an instructor — "I asked and am
 * waiting" is exactly what somebody opens this list to check. */
export async function getMyParticipation(): Promise<TaughtCourse[]> {
	const raw = await apiClient.get<unknown[]>('/taught-courses/?mine=participating');
	return raw.map(mapCourse);
}

export async function getCourse(id: string): Promise<TaughtCourse | undefined> {
	try {
		return mapCourse(await apiClient.get(`/taught-courses/${encodeURIComponent(id)}/`));
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

export async function createCourse(draft: TaughtCourseDraft): Promise<TaughtCourse> {
	return mapCourse(await apiClient.post('/taught-courses/', draftToBody(draft)));
}

export async function updateCourse(id: string, draft: TaughtCourseDraft): Promise<TaughtCourse> {
	return mapCourse(
		await apiClient.patch(`/taught-courses/${encodeURIComponent(id)}/`, draftToBody(draft))
	);
}

export async function deleteCourse(id: string): Promise<void> {
	await apiClient.delete(`/taught-courses/${encodeURIComponent(id)}/`);
}

/** Thrown when joining is refused, carrying the machine-readable reason so the UI can say which of
 * the six genuinely different refusals this was. */
export class EnrolmentRefused extends Error {
	constructor(public readonly reason: string) {
		super(reason);
	}
}

export async function enrol(courseId: string, requestNote = ''): Promise<Enrollment> {
	try {
		return mapEnrollment(
			await apiClient.post(`/taught-courses/${encodeURIComponent(courseId)}/enrol/`, {
				request_note: requestNote
			})
		);
	} catch (e) {
		const detail = (e as { body?: { detail?: string } }).body?.detail;
		if (detail) throw new EnrolmentRefused(detail);
		throw e;
	}
}

export async function leaveCourse(courseId: string): Promise<Enrollment> {
	return mapEnrollment(
		await apiClient.post(`/taught-courses/${encodeURIComponent(courseId)}/leave/`)
	);
}

export async function getParticipants(courseId: string): Promise<Enrollment[]> {
	const raw = await apiClient.get<unknown[]>(
		`/taught-courses/${encodeURIComponent(courseId)}/participants/`
	);
	return raw.map(mapEnrollment);
}

export async function decideEnrollment(
	courseId: string,
	enrollmentId: string,
	decision: 'approve' | 'decline' | 'remove'
): Promise<Enrollment> {
	return mapEnrollment(
		await apiClient.post(
			`/taught-courses/${encodeURIComponent(courseId)}/enrollments/${encodeURIComponent(enrollmentId)}/`,
			{ decision }
		)
	);
}

export async function addLesson(courseId: string, draft: LessonDraft): Promise<Lesson> {
	return mapLesson(
		await apiClient.post(`/taught-courses/${encodeURIComponent(courseId)}/lessons/`, {
			title: draft.title,
			description: draft.description,
			order: draft.order,
			scheduled_at: draft.scheduledAt || null,
			duration_minutes: draft.durationMinutes,
			participant_notes: draft.participantNotes
		})
	);
}

export async function deleteLesson(courseId: string, lessonId: string): Promise<void> {
	await apiClient.delete(
		`/taught-courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/`
	);
}

export type { EnrollmentStatus };
