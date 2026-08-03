// Courses run by users — mirrors backend/classroom/ one-to-one.
//
// Named `classroom.ts` rather than `courses.ts` on purpose: `taxonomy.ts` already owns the
// university-subject sense of "course", and two service modules whose names both claim that word
// would be a genuine source of wrong imports.

import type {
	Chapter,
	ChapterDraft,
	CourseInvite,
	CourseInviteDraft,
	CourseItem,
	CourseStaffMember,
	Enrollment,
	EnrollmentStatus,
	InvitePreview,
	Lesson,
	LessonDraft,
	StaffRole,
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

function mapParticipant(raw: any) {
	return { id: String(raw?.id ?? ''), displayName: raw?.display_name ?? '' };
}

function mapItem(raw: any): CourseItem {
	return {
		id: String(raw.id),
		kind: raw.kind,
		chapter: raw.chapter === null || raw.chapter === undefined ? null : String(raw.chapter),
		material: raw.material === null || raw.material === undefined ? null : String(raw.material),
		exercise: raw.exercise === null || raw.exercise === undefined ? null : String(raw.exercise),
		label: raw.label ?? '',
		order: raw.order ?? 0,
		note: raw.note ?? '',
		status: raw.status,
		submittedBy: raw.submitted_by ? mapParticipant(raw.submitted_by) : null,
		decidedBy: raw.decided_by ? mapParticipant(raw.decided_by) : null,
		decidedAt: raw.decided_at ?? null,
		decisionNote: raw.decision_note ?? '',
		createdAt: raw.created_at
	};
}

function mapChapter(raw: any): Chapter {
	return {
		id: String(raw.id),
		title: raw.title,
		description: raw.description ?? '',
		order: raw.order ?? 0,
		unlocksAt: raw.unlocks_at ?? null,
		isUnlocked: raw.is_unlocked ?? true,
		items: (raw.items ?? []).map(mapItem)
	};
}

function mapStaff(raw: any): CourseStaffMember {
	return {
		id: String(raw.id),
		user: mapParticipant(raw.user),
		role: raw.role,
		addedAt: raw.added_at
	};
}

function mapInvite(raw: any): CourseInvite {
	return {
		id: String(raw.id),
		token: raw.token,
		role: raw.role,
		label: raw.label ?? '',
		createdBy: raw.created_by ? mapParticipant(raw.created_by) : null,
		createdAt: raw.created_at,
		maxUses: raw.max_uses ?? 0,
		uses: raw.uses ?? 0,
		expiresAt: raw.expires_at ?? null,
		revokedAt: raw.revoked_at ?? null,
		isUsable: raw.is_usable ?? false,
		unusableReason: raw.unusable_reason ?? null
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
		discussionMode: raw.discussion_mode,
		announceNewLessons: raw.announce_new_lessons,
		announceNewPosts: raw.announce_new_posts,
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
		isInstructor: raw.is_instructor ?? false,
		canReadDiscussion: raw.can_read_discussion ?? false,
		canPostDiscussion: raw.can_post_discussion ?? false,
		notifyMe: raw.notify_me ?? null,
		contributionPolicy: raw.contribution_policy ?? 'approval',
		myRole: raw.my_role ?? null,
		canAdminister: raw.can_administer ?? false,
		canCurate: raw.can_curate ?? false,
		canContribute: raw.can_contribute ?? false,
		contributionNeedsApproval: raw.contribution_needs_approval ?? false,
		chapters: (raw.chapters ?? []).map(mapChapter),
		unfiledItems: (raw.unfiled_items ?? []).map(mapItem),
		pendingContributionCount: raw.pending_contribution_count ?? 0
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
		notify: raw.notify ?? true,
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
		discussion_mode: draft.discussionMode,
		announce_new_lessons: draft.announceNewLessons,
		announce_new_posts: draft.announceNewPosts,
		contribution_policy: draft.contributionPolicy,
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

/** Stay in the course, stop hearing about it — `Enrollment.notify`. */
export async function muteCourse(courseId: string, notify: boolean): Promise<Enrollment> {
	return mapEnrollment(
		await apiClient.post(`/taught-courses/${encodeURIComponent(courseId)}/mute/`, { notify })
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

/* --- who runs the course ------------------------------------------------------------------- */

export async function getCourseStaff(courseId: string): Promise<CourseStaffMember[]> {
	const raw = await apiClient.get<unknown[]>(`/taught-courses/${courseId}/staff/`);
	return raw.map(mapStaff);
}

export async function addCourseStaff(
	courseId: string,
	userId: string,
	role: Exclude<StaffRole, 'owner'>
): Promise<CourseStaffMember> {
	const raw = await apiClient.post<unknown>(`/taught-courses/${courseId}/staff/`, {
		user_id: Number(userId),
		role
	});
	return mapStaff(raw);
}

export async function setCourseStaffRole(
	courseId: string,
	staffId: string,
	role: Exclude<StaffRole, 'owner'>
): Promise<CourseStaffMember> {
	const raw = await apiClient.patch<unknown>(`/taught-courses/${courseId}/staff/${staffId}/`, {
		role
	});
	return mapStaff(raw);
}

export async function removeCourseStaff(courseId: string, staffId: string): Promise<void> {
	await apiClient.delete(`/taught-courses/${courseId}/staff/${staffId}/`);
}

/* --- chapters ------------------------------------------------------------------------------ */

export async function getChapters(courseId: string): Promise<Chapter[]> {
	const raw = await apiClient.get<unknown[]>(`/taught-courses/${courseId}/chapters/`);
	return raw.map(mapChapter);
}

function chapterBody(draft: Partial<ChapterDraft>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (draft.title !== undefined) body.title = draft.title;
	if (draft.description !== undefined) body.description = draft.description;
	if (draft.order !== undefined) body.order = draft.order;
	// A cleared date input must travel as null rather than '', the same reason `draftToBody` states
	// for a course's own dates: a blank string is not a datetime and the API rightly refuses it.
	if (draft.unlocksAt !== undefined) body.unlocks_at = draft.unlocksAt || null;
	return body;
}

export async function createChapter(courseId: string, draft: ChapterDraft): Promise<Chapter> {
	const raw = await apiClient.post<unknown>(
		`/taught-courses/${courseId}/chapters/`,
		chapterBody(draft)
	);
	return mapChapter(raw);
}

export async function updateChapter(
	courseId: string,
	chapterId: string,
	draft: Partial<ChapterDraft>
): Promise<Chapter> {
	const raw = await apiClient.patch<unknown>(
		`/taught-courses/${courseId}/chapters/${chapterId}/`,
		chapterBody(draft)
	);
	return mapChapter(raw);
}

export async function deleteChapter(courseId: string, chapterId: string): Promise<void> {
	await apiClient.delete(`/taught-courses/${courseId}/chapters/${chapterId}/`);
}

/* --- content, and contributions to it ------------------------------------------------------ */

export async function getCourseItems(courseId: string): Promise<CourseItem[]> {
	const raw = await apiClient.get<unknown[]>(`/taught-courses/${courseId}/items/`);
	return raw.map(mapItem);
}

export interface CourseItemSubmission {
	materialId?: string;
	exerciseId?: string;
	chapterId?: string | null;
	note?: string;
}

export async function submitCourseItem(
	courseId: string,
	submission: CourseItemSubmission
): Promise<CourseItem> {
	const body: Record<string, unknown> = { note: submission.note ?? '' };
	if (submission.materialId) body.material = Number(submission.materialId);
	if (submission.exerciseId) body.exercise = Number(submission.exerciseId);
	if (submission.chapterId) body.chapter = Number(submission.chapterId);
	const raw = await apiClient.post<unknown>(`/taught-courses/${courseId}/items/`, body);
	return mapItem(raw);
}

export async function decideCourseItem(
	courseId: string,
	itemId: string,
	decision: 'approve' | 'reject',
	decisionNote = ''
): Promise<CourseItem> {
	const raw = await apiClient.patch<unknown>(`/taught-courses/${courseId}/items/${itemId}/`, {
		decision,
		decision_note: decisionNote
	});
	return mapItem(raw);
}

/** Filing an item into a chapter, or out of one — `chapterId: null` unfiles it. */
export async function moveCourseItem(
	courseId: string,
	itemId: string,
	chapterId: string | null
): Promise<CourseItem> {
	const raw = await apiClient.patch<unknown>(`/taught-courses/${courseId}/items/${itemId}/`, {
		chapter: chapterId ? Number(chapterId) : null
	});
	return mapItem(raw);
}

export async function removeCourseItem(courseId: string, itemId: string): Promise<void> {
	await apiClient.delete(`/taught-courses/${courseId}/items/${itemId}/`);
}

/* --- invite links -------------------------------------------------------------------------- */

export async function getInvites(courseId: string): Promise<CourseInvite[]> {
	const raw = await apiClient.get<unknown[]>(`/taught-courses/${courseId}/invites/`);
	return raw.map(mapInvite);
}

export async function createInvite(
	courseId: string,
	draft: CourseInviteDraft
): Promise<CourseInvite> {
	const raw = await apiClient.post<unknown>(`/taught-courses/${courseId}/invites/`, {
		role: draft.role,
		label: draft.label,
		max_uses: draft.maxUses,
		expires_at: draft.expiresAt || null
	});
	return mapInvite(raw);
}

export async function revokeInvite(courseId: string, inviteId: string): Promise<CourseInvite> {
	const raw = await apiClient.delete<unknown>(`/taught-courses/${courseId}/invites/${inviteId}/`);
	return mapInvite(raw);
}

/** Readable while logged out, on purpose: telling somebody to sign up without saying what for is
 * how an invite gets ignored. Returns null for a token that does not exist at all. */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
	try {
		/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
		const raw = await apiClient.get<any>(`/course-invites/${encodeURIComponent(token)}/`);
		return {
			courseId: String(raw.course_id),
			courseTitle: raw.course_title,
			instructorName: raw.instructor_name,
			role: raw.role,
			isUsable: raw.is_usable,
			unusableReason: raw.unusable_reason ?? null
		};
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) return null;
		throw error;
	}
}

export interface InviteAcceptResult {
	detail: 'joined' | 'already_enrolled' | 'already_staff';
	courseId: string;
}

export async function acceptInvite(token: string): Promise<InviteAcceptResult> {
	/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
	const raw = await apiClient.post<any>(`/course-invites/${encodeURIComponent(token)}/accept/`, {});
	return { detail: raw.detail, courseId: String(raw.course_id) };
}
