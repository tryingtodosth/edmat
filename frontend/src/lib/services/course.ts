// Courses run by users — mirrors backend/courses/ one-to-one.
//
// This was `classroom.ts`, because `taxonomy.ts` owned the university-subject sense of "course" and
// two modules claiming that word would have been a real source of wrong imports. The taxonomy now
// speaks of disciplines and branches, so the word is unambiguous and this file takes it.

import type {
	Attachment,
	AttachmentReview,
	Chapter,
	ChapterDraft,
	CourseInvite,
	CourseInviteDraft,
	CourseItem,
	CourseFeedbackReview,
	CourseNote,
	CourseStaffMember,
	Enrollment,
	EnrollmentStatus,
	InvitePreview,
	Lesson,
	LessonDraft,
	LessonExerciseSet,
	LessonSetExercise,
	RatingSummary,
	StaffRole,
	Course,
	TaughtCourseDraft
} from '$lib/types/course';
import { apiClient, ApiError } from '$lib/api/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapLesson(raw: any): Lesson {
	return {
		id: String(raw.id),
		chapterId: String(raw.chapter ?? ''),
		title: raw.title,
		description: raw.description,
		order: raw.order,
		scheduledAt: raw.scheduled_at,
		durationMinutes: raw.duration_minutes,
		participantNotes: raw.participant_notes ?? '',
		items: (raw.items ?? []).map(mapItem),
		exerciseSets: (raw.exercise_sets ?? []).map(mapLessonExerciseSet),
		reviews: mapRatingSummary(raw.reviews)
	};
}

/** Defaults to "nobody has rated this" rather than to zero, and tolerates the field being absent
 * so an older response shape cannot make the page render a 0★ average that nobody gave. */
function mapRatingSummary(raw: any): RatingSummary {
	return {
		count: raw?.count ?? 0,
		average: raw?.average ?? null
	};
}

function mapCourseFeedbackReview(raw: any): CourseFeedbackReview {
	return {
		id: String(raw.id),
		author: mapParticipant(raw.author),
		rating: raw.rating,
		body: raw.body ?? '',
		createdAt: raw.created_at
	};
}

function mapLessonSetExercise(raw: any): LessonSetExercise {
	return {
		id: String(raw.id),
		exercise: String(raw.exercise),
		label: raw.label ?? '',
		order: raw.order ?? 0,
		published: raw.published ?? true
	};
}

function mapLessonExerciseSet(raw: any): LessonExerciseSet {
	return {
		id: String(raw.id),
		lessonId: String(raw.lesson),
		title: raw.title ?? '',
		note: raw.note ?? '',
		order: raw.order ?? 0,
		exercises: (raw.exercises ?? []).map(mapLessonSetExercise),
		linkedBy: raw.linked_by ? mapParticipant(raw.linked_by) : null,
		linkedAt: raw.linked_at,
		refreshedAt: raw.refreshed_at ?? null,
		sourceSlug: raw.source_slug ?? null,
		sourceExists: raw.source_exists ?? false,
		hasDrifted: raw.has_drifted ?? false,
		hiddenExerciseCount: raw.hidden_exercise_count ?? 0
	};
}

function mapParticipant(raw: any) {
	return { id: String(raw?.id ?? ''), displayName: raw?.display_name ?? '' };
}

/** Backend ids arrive as numbers and are opaque strings everywhere above `lib/api`; null and
 * undefined both mean "not set", and collapsing them here keeps every call site from re-checking. */
function optionalId(value: unknown): string | null {
	return value === null || value === undefined ? null : String(value);
}

function mapItem(raw: any): CourseItem {
	return {
		id: String(raw.id),
		kind: raw.kind,
		lesson: optionalId(raw.lesson),
		chapter: optionalId(raw.chapter),
		material: optionalId(raw.material),
		exercise: optionalId(raw.exercise),
		attachment: optionalId(raw.attachment),
		event: optionalId(raw.event),
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
		lessons: (raw.lessons ?? []).map(mapLesson),
		items: (raw.items ?? []).map(mapItem),
		reviews: mapRatingSummary(raw.reviews)
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

function mapCourse(raw: any): Course {
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
		visibility: raw.visibility,
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
		visibility: draft.visibility,
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

export async function getCourses(filters: CourseFilters = {}): Promise<Course[]> {
	const search = new URLSearchParams();
	if (filters.subject) search.set('subject', filters.subject);
	if (filters.field) search.set('field', filters.field);
	if (filters.openOnly) search.set('open', 'true');
	const query = search.toString();
	const raw = await apiClient.get<unknown[]>(`/courses/${query ? `?${query}` : ''}`);
	return raw.map(mapCourse);
}

/** Courses this account runs, drafts included — the drafts are the point of the view. */
export async function getMyTeaching(): Promise<Course[]> {
	const raw = await apiClient.get<unknown[]>('/courses/?mine=teaching');
	return raw.map(mapCourse);
}

/** Courses this account is in, including requests still waiting on an instructor — "I asked and am
 * waiting" is exactly what somebody opens this list to check. */
export async function getMyParticipation(): Promise<Course[]> {
	const raw = await apiClient.get<unknown[]>('/courses/?mine=participating');
	return raw.map(mapCourse);
}

export async function getCourse(id: string): Promise<Course | undefined> {
	try {
		return mapCourse(await apiClient.get(`/courses/${encodeURIComponent(id)}/`));
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

export async function createCourse(draft: TaughtCourseDraft): Promise<Course> {
	return mapCourse(await apiClient.post('/courses/', draftToBody(draft)));
}

export async function updateCourse(id: string, draft: TaughtCourseDraft): Promise<Course> {
	return mapCourse(
		await apiClient.patch(`/courses/${encodeURIComponent(id)}/`, draftToBody(draft))
	);
}

export async function deleteCourse(id: string): Promise<void> {
	await apiClient.delete(`/courses/${encodeURIComponent(id)}/`);
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
			await apiClient.post(`/courses/${encodeURIComponent(courseId)}/enrol/`, {
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
	return mapEnrollment(await apiClient.post(`/courses/${encodeURIComponent(courseId)}/leave/`));
}

/** Stay in the course, stop hearing about it — `Enrollment.notify`. */
export async function muteCourse(courseId: string, notify: boolean): Promise<Enrollment> {
	return mapEnrollment(
		await apiClient.post(`/courses/${encodeURIComponent(courseId)}/mute/`, { notify })
	);
}

export async function getParticipants(courseId: string): Promise<Enrollment[]> {
	const raw = await apiClient.get<unknown[]>(
		`/courses/${encodeURIComponent(courseId)}/participants/`
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
			`/courses/${encodeURIComponent(courseId)}/enrollments/${encodeURIComponent(enrollmentId)}/`,
			{ decision }
		)
	);
}

export async function addLesson(courseId: string, draft: LessonDraft): Promise<Lesson> {
	return mapLesson(
		await apiClient.post(`/courses/${encodeURIComponent(courseId)}/lessons/`, {
			chapter: Number(draft.chapterId),
			title: draft.title,
			description: draft.description,
			order: draft.order,
			scheduled_at: draft.scheduledAt || null,
			duration_minutes: draft.durationMinutes,
			participant_notes: draft.participantNotes
		})
	);
}

/** Rename a lesson, retime it, or rewrite its notes. The backend has taken PATCH here all along;
 * nothing in the UI ever called it, which is why a lesson could be created and deleted but never
 * corrected. */
export async function updateLesson(
	courseId: string,
	lessonId: string,
	draft: Partial<LessonDraft>
): Promise<Lesson> {
	const body: Record<string, unknown> = {};
	if (draft.title !== undefined) body.title = draft.title;
	if (draft.description !== undefined) body.description = draft.description;
	if (draft.participantNotes !== undefined) body.participant_notes = draft.participantNotes;
	if (draft.scheduledAt !== undefined) body.scheduled_at = draft.scheduledAt || null;
	if (draft.durationMinutes !== undefined) body.duration_minutes = draft.durationMinutes;
	if (draft.chapterId !== undefined) body.chapter = Number(draft.chapterId);
	return mapLesson(
		await apiClient.patch(
			`/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/`,
			body
		)
	);
}

export async function deleteLesson(courseId: string, lessonId: string): Promise<void> {
	await apiClient.delete(
		`/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/`
	);
}

/* --- a whole exercise set, linked into a lesson --------------------------------------------- */
//
// The link is a SNAPSHOT of which exercises the set held, not a live view of it — see the
// `LessonExerciseSet` type and the model docstring for why. `refreshLinkedSet` is how a curator
// takes the source's current list, which keeps that decision with the course rather than with
// whoever happens to own the set.

function lessonSetsUrl(courseId: string, lessonId: string): string {
	return `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/exercise-sets/`;
}

export async function getLinkedSets(
	courseId: string,
	lessonId: string
): Promise<LessonExerciseSet[]> {
	const raw = await apiClient.get<unknown[]>(lessonSetsUrl(courseId, lessonId));
	return raw.map(mapLessonExerciseSet);
}

/** `setSlug` is the set's own share slug (`ExerciseSet.slug`), which is what every other reference
 * to a set in this app already uses — never its numeric row id. */
export async function linkSetToLesson(
	courseId: string,
	lessonId: string,
	setSlug: string,
	note = ''
): Promise<LessonExerciseSet> {
	return mapLessonExerciseSet(
		await apiClient.post(lessonSetsUrl(courseId, lessonId), { set: setSlug, note })
	);
}

export async function refreshLinkedSet(
	courseId: string,
	lessonId: string,
	linkId: string
): Promise<LessonExerciseSet> {
	return mapLessonExerciseSet(
		await apiClient.patch(`${lessonSetsUrl(courseId, lessonId)}${encodeURIComponent(linkId)}/`, {
			refresh: true
		})
	);
}

export async function renameLinkedSet(
	courseId: string,
	lessonId: string,
	linkId: string,
	title: string
): Promise<LessonExerciseSet> {
	return mapLessonExerciseSet(
		await apiClient.patch(`${lessonSetsUrl(courseId, lessonId)}${encodeURIComponent(linkId)}/`, {
			title
		})
	);
}

export async function unlinkSetFromLesson(
	courseId: string,
	lessonId: string,
	linkId: string
): Promise<void> {
	await apiClient.delete(`${lessonSetsUrl(courseId, lessonId)}${encodeURIComponent(linkId)}/`);
}

export type { EnrollmentStatus };

/* --- who runs the course ------------------------------------------------------------------- */

export async function getCourseStaff(courseId: string): Promise<CourseStaffMember[]> {
	const raw = await apiClient.get<unknown[]>(`/courses/${courseId}/staff/`);
	return raw.map(mapStaff);
}

export async function addCourseStaff(
	courseId: string,
	userId: string,
	role: Exclude<StaffRole, 'owner'>
): Promise<CourseStaffMember> {
	const raw = await apiClient.post<unknown>(`/courses/${courseId}/staff/`, {
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
	const raw = await apiClient.patch<unknown>(`/courses/${courseId}/staff/${staffId}/`, {
		role
	});
	return mapStaff(raw);
}

export async function removeCourseStaff(courseId: string, staffId: string): Promise<void> {
	await apiClient.delete(`/courses/${courseId}/staff/${staffId}/`);
}

/* --- chapters ------------------------------------------------------------------------------ */

export async function getChapters(courseId: string): Promise<Chapter[]> {
	const raw = await apiClient.get<unknown[]>(`/courses/${courseId}/chapters/`);
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
	const raw = await apiClient.post<unknown>(`/courses/${courseId}/chapters/`, chapterBody(draft));
	return mapChapter(raw);
}

export async function updateChapter(
	courseId: string,
	chapterId: string,
	draft: Partial<ChapterDraft>
): Promise<Chapter> {
	const raw = await apiClient.patch<unknown>(
		`/courses/${courseId}/chapters/${chapterId}/`,
		chapterBody(draft)
	);
	return mapChapter(raw);
}

export async function deleteChapter(courseId: string, chapterId: string): Promise<void> {
	await apiClient.delete(`/courses/${courseId}/chapters/${chapterId}/`);
}

/* --- content, and contributions to it ------------------------------------------------------ */

export async function getCourseItems(courseId: string): Promise<CourseItem[]> {
	const raw = await apiClient.get<unknown[]>(`/courses/${courseId}/items/`);
	return raw.map(mapItem);
}

export interface CourseItemSubmission {
	/** Exactly one of these four — the server refuses anything else, and so does the database. */
	materialId?: string;
	exerciseId?: string;
	attachmentId?: string;
	eventId?: string;
	/** Where it goes. At most one: a lesson already belongs to a chapter, so sending both would state
	 * the same fact twice with two chances to disagree. Neither means unfiled. */
	chapterId?: string | null;
	lessonId?: string | null;
	note?: string;
}

export async function submitCourseItem(
	courseId: string,
	submission: CourseItemSubmission
): Promise<CourseItem> {
	const body: Record<string, unknown> = { note: submission.note ?? '' };
	if (submission.materialId) body.material = Number(submission.materialId);
	if (submission.exerciseId) body.exercise = Number(submission.exerciseId);
	if (submission.attachmentId) body.attachment = Number(submission.attachmentId);
	if (submission.eventId) body.event = Number(submission.eventId);
	// A lesson wins if both somehow arrive, rather than sending both and letting the server refuse
	// the whole request: the caller asked for the more specific of the two.
	if (submission.lessonId) body.lesson = Number(submission.lessonId);
	else if (submission.chapterId) body.chapter = Number(submission.chapterId);
	const raw = await apiClient.post<unknown>(`/courses/${courseId}/items/`, body);
	return mapItem(raw);
}

export async function decideCourseItem(
	courseId: string,
	itemId: string,
	decision: 'approve' | 'reject',
	decisionNote = ''
): Promise<CourseItem> {
	const raw = await apiClient.patch<unknown>(`/courses/${courseId}/items/${itemId}/`, {
		decision,
		decision_note: decisionNote
	});
	return mapItem(raw);
}

/** Filing an item into a lesson, or out of one — `lessonId: null` unfiles it. */
export async function moveCourseItem(
	courseId: string,
	itemId: string,
	target: { lessonId: string | null; chapterId: string | null }
): Promise<CourseItem> {
	// BOTH are always sent, including the null one. Sending only the field being set would leave the
	// other holding its old value, so moving a chapter-filed item into a lesson would produce a row
	// claiming both — which the `course_item_one_filing_target` constraint refuses outright.
	const raw = await apiClient.patch<unknown>(`/courses/${courseId}/items/${itemId}/`, {
		lesson: target.lessonId ? Number(target.lessonId) : null,
		chapter: target.chapterId ? Number(target.chapterId) : null
	});
	return mapItem(raw);
}

/** What drag-and-drop calls. Sends whole groups rather than one move, because a drag between two
 * chapters changes both — see the backend's `CourseViewSet.reorder`. `''` is the unfiled group.
 *
 * `kind: 'chapter'` takes a flat list, since a chapter's only group is the course itself. */
export async function reorderCourse(
	courseId: string,
	payload:
		| { kind: 'chapter'; order: string[] }
		| { kind: 'lesson' | 'item' | 'lesson_set'; groups: Record<string, string[]> }
): Promise<void> {
	const body =
		payload.kind === 'chapter'
			? { kind: 'chapter', order: payload.order.map(Number) }
			: {
					kind: payload.kind,
					groups: Object.fromEntries(
						Object.entries(payload.groups).map(([group, ids]) => [group, ids.map(Number)])
					)
				};
	await apiClient.post(`/courses/${encodeURIComponent(courseId)}/reorder/`, body);
}

export async function removeCourseItem(courseId: string, itemId: string): Promise<void> {
	await apiClient.delete(`/courses/${courseId}/items/${itemId}/`);
}

/* --- invite links -------------------------------------------------------------------------- */

export async function getInvites(courseId: string): Promise<CourseInvite[]> {
	const raw = await apiClient.get<unknown[]>(`/courses/${courseId}/invites/`);
	return raw.map(mapInvite);
}

export async function createInvite(
	courseId: string,
	draft: CourseInviteDraft
): Promise<CourseInvite> {
	const raw = await apiClient.post<unknown>(`/courses/${courseId}/invites/`, {
		role: draft.role,
		label: draft.label,
		max_uses: draft.maxUses,
		expires_at: draft.expiresAt || null
	});
	return mapInvite(raw);
}

export async function revokeInvite(courseId: string, inviteId: string): Promise<CourseInvite> {
	const raw = await apiClient.delete<unknown>(`/courses/${courseId}/invites/${inviteId}/`);
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

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapNote(raw: any): CourseNote {
	return {
		id: String(raw.id),
		lessonId: raw.lesson === null || raw.lesson === undefined ? null : String(raw.lesson),
		body: raw.body ?? '',
		updatedAt: raw.updated_at
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The caller's own notes on a course. Never anybody else's — the server filters by author, so
 * there is no "whose notes" parameter to get wrong here. */
export async function getMyCourseNotes(courseId: string): Promise<CourseNote[]> {
	const raw = await apiClient.get<unknown[]>(`/courses/${encodeURIComponent(courseId)}/notes/`);
	return raw.map(mapNote);
}

/** Upsert one note. An empty body deletes it, which is why this resolves to null in that case
 * rather than pretending to have stored a blank. */
export async function saveMyCourseNote(
	courseId: string,
	body: string,
	lessonId: string | null = null
): Promise<CourseNote | null> {
	const raw = await apiClient.put<unknown>(`/courses/${encodeURIComponent(courseId)}/notes/`, {
		body,
		lesson: lessonId ? Number(lessonId) : null
	});
	return raw ? mapNote(raw) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapAttachment(raw: any): Attachment {
	return {
		id: String(raw.id),
		title: raw.title,
		description: raw.description ?? '',
		fileUrl: raw.file_url ?? '',
		sizeBytes: raw.size_bytes ?? 0,
		uploadedBy: raw.uploaded_by ? mapParticipant(raw.uploaded_by) : null,
		createdAt: raw.created_at,
		reviewCount: raw.review_count ?? 0,
		averageRating: raw.average_rating ?? null
	};
}

function mapAttachmentReview(raw: any): AttachmentReview {
	return {
		id: String(raw.id),
		author: mapParticipant(raw.author),
		rating: raw.rating,
		body: raw.body ?? '',
		createdAt: raw.created_at
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getAttachments(courseId: string): Promise<Attachment[]> {
	const raw = await apiClient.get<unknown[]>(
		`/courses/${encodeURIComponent(courseId)}/attachments/`
	);
	return raw.map(mapAttachment);
}

export async function getAttachment(
	courseId: string,
	attachmentId: string
): Promise<Attachment | undefined> {
	try {
		return mapAttachment(
			await apiClient.get(
				`/courses/${encodeURIComponent(courseId)}/attachments/${encodeURIComponent(attachmentId)}/`
			)
		);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

/** Multipart, because it carries a real file — `postForm` leaves the Content-Type to the browser,
 * which is the only thing that knows the boundary. */
export async function uploadAttachment(
	courseId: string,
	file: File,
	title: string,
	description = ''
): Promise<Attachment> {
	const form = new FormData();
	form.append('file', file);
	form.append('title', title);
	form.append('description', description);
	return mapAttachment(
		await apiClient.postForm(`/courses/${encodeURIComponent(courseId)}/attachments/`, form)
	);
}

export async function deleteAttachment(courseId: string, attachmentId: string): Promise<void> {
	await apiClient.delete(
		`/courses/${encodeURIComponent(courseId)}/attachments/${encodeURIComponent(attachmentId)}/`
	);
}

export async function getAttachmentReviews(
	courseId: string,
	attachmentId: string
): Promise<AttachmentReview[]> {
	const raw = await apiClient.get<unknown[]>(
		`/courses/${encodeURIComponent(courseId)}/attachments/${encodeURIComponent(attachmentId)}/reviews/`
	);
	return raw.map(mapAttachmentReview);
}

export async function reviewAttachment(
	courseId: string,
	attachmentId: string,
	rating: number,
	body = ''
): Promise<AttachmentReview> {
	return mapAttachmentReview(
		await apiClient.post(
			`/courses/${encodeURIComponent(courseId)}/attachments/${encodeURIComponent(attachmentId)}/reviews/`,
			{ rating, body }
		)
	);
}

/* --- a lesson's or a chapter's own thread and ratings ------------------------------------------
 *
 * One pair of functions taking the target kind rather than four near-identical ones: the URL is the
 * only thing that differs, and four copies is four places for the parent-id conversion below to be
 * got wrong in. `parent` is sent as a number because the API's comment ids are numeric PKs, while
 * this app carries every id as an opaque string — the conversion belongs here, at the boundary,
 * rather than in a component.
 */
export type CourseFeedbackTarget = 'lesson' | 'chapter';

function feedbackPath(courseId: string, target: CourseFeedbackTarget, targetId: string) {
	const segment = target === 'lesson' ? 'lessons' : 'chapters';
	return `/courses/${encodeURIComponent(courseId)}/${segment}/${encodeURIComponent(targetId)}`;
}

export async function getCourseTargetComments(
	courseId: string,
	target: CourseFeedbackTarget,
	targetId: string
) {
	return apiClient.get<unknown[]>(`${feedbackPath(courseId, target, targetId)}/comments/`);
}

export async function postCourseTargetComment(
	courseId: string,
	target: CourseFeedbackTarget,
	targetId: string,
	body: string,
	parentId?: string
) {
	return apiClient.post(`${feedbackPath(courseId, target, targetId)}/comments/`, {
		body,
		parent: parentId ? Number(parentId) : null
	});
}

export async function getCourseTargetReviews(
	courseId: string,
	target: CourseFeedbackTarget,
	targetId: string
): Promise<CourseFeedbackReview[]> {
	const raw = await apiClient.get<unknown[]>(
		`${feedbackPath(courseId, target, targetId)}/reviews/`
	);
	return raw.map(mapCourseFeedbackReview);
}

export async function reviewCourseTarget(
	courseId: string,
	target: CourseFeedbackTarget,
	targetId: string,
	rating: number,
	body = ''
): Promise<CourseFeedbackReview> {
	return mapCourseFeedbackReview(
		await apiClient.post(`${feedbackPath(courseId, target, targetId)}/reviews/`, { rating, body })
	);
}

/** This attachment's own thread — deliberately not the course discussion and not a material's. */
export async function getAttachmentComments(courseId: string, attachmentId: string) {
	return apiClient.get<unknown[]>(
		`/courses/${encodeURIComponent(courseId)}/attachments/${encodeURIComponent(attachmentId)}/comments/`
	);
}

export async function postAttachmentComment(
	courseId: string,
	attachmentId: string,
	body: string,
	parentId?: string
) {
	return apiClient.post(
		`/courses/${encodeURIComponent(courseId)}/attachments/${encodeURIComponent(attachmentId)}/comments/`,
		{ body, parent: parentId ? Number(parentId) : null }
	);
}
