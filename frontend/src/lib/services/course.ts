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
	CourseReportRow,
	CourseNote,
	CourseSearchHit,
	CourseSearchResult,
	CourseStaffMember,
	Enrollment,
	EnrollmentStatus,
	InvitePreview,
	CompletionBlockReason,
	CourseCompletion,
	CourseSchool,
	Lesson,
	LessonDraft,
	LessonExerciseSet,
	LessonProgress,
	LessonProgressState,
	LessonSetExercise,
	RatingSummary,
	StaffRole,
	Course,
	CourseRef,
	CourseKind,
	TaughtCourseDraft
} from '$lib/types/course';
import { apiClient, ApiError } from '$lib/api/client';
import { getLocale } from '$lib/paraglide/runtime';

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
		reviews: mapRatingSummary(raw.reviews),
		progress: mapLessonProgress(raw.progress)
	};
}

/** Defaults to the most closed reading of every field, so a response that is missing this block
 * shows nothing rather than inventing an empty cohort — "0 of 0 have finished" would be a claim,
 * and the honest answer to a missing field is to say nothing at all. */
export function mapLessonProgress(raw: any): LessonProgress {
	return {
		mode: raw?.mode ?? 'off',
		// Defaults false, like every other permission-shaped field here: a response that did not say
		// must not be read as "you are allowed more than the mode says".
		schoolMode: raw?.school_mode ?? false,
		mine: raw?.mine ?? null,
		canRecord: raw?.can_record ?? false,
		summary: raw?.summary
			? {
					inProgress: raw.summary.in_progress ?? 0,
					stuck: raw.summary.stuck ?? 0,
					done: raw.summary.done ?? 0,
					notStarted: raw.summary.not_started ?? 0,
					participants: raw.summary.participants ?? 0
				}
			: null,
		people: raw?.people
			? raw.people.map((row: any) => ({
					participant: mapParticipant(row.participant),
					// Renamed from the API's `status` on the way in: this app already uses `status`
					// for a course's own lifecycle and for an enrolment, and a third meaning on a
					// neighbouring object is how the wrong one gets read.
					state: row.status,
					updatedAt: row.updated_at ?? null
				}))
			: null,
		withheldReason: raw?.withheld_reason ?? null
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
		lessonId: optionalId(raw.lesson),
		chapterId: optionalId(raw.chapter),
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

/** A thin organisation summary — the school on a course, and the body on a certificate. */
function mapCourseSchool(raw: any): CourseSchool | null {
	if (!raw) return null;
	return {
		id: String(raw.id),
		name: raw.name ?? '',
		slug: raw.slug ?? '',
		kind: raw.kind ?? 'other'
	};
}

function mapCompletion(raw: any): CourseCompletion {
	return {
		id: String(raw.id),
		courseId: String(raw.course_id),
		courseTitle: raw.course_title ?? '',
		courseStartsOn: raw.course_starts_on ?? null,
		courseEndsOn: raw.course_ends_on ?? null,
		instructor: mapParticipant(raw.instructor),
		organization: mapCourseSchool(raw.organization),
		participant: mapParticipant(raw.participant),
		issuedBy: raw.issued_by ? mapParticipant(raw.issued_by) : null,
		issuedAt: raw.issued_at ?? '',
		note: raw.note ?? '',
		revokedAt: raw.revoked_at ?? null,
		isRevoked: raw.is_revoked ?? false,
		lessonsTotal: raw.lessons_total ?? 0
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
		discussion: optionalId(raw.discussion),
		discussionTargetType: raw.discussion_target_type ?? '',
		discussionTargetId: raw.discussion_target_id ?? '',
		linkedCourse: optionalId(raw.linked_course),
		linkUrl: raw.link_url ?? '',
		linkTitle: raw.link_title ?? '',
		post: optionalId(raw.post),
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
		exerciseSets: (raw.exercise_sets ?? []).map(mapLessonExerciseSet),
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

/** Exported so `services/events.ts` can map `GET /api/events/{id}/related-courses/`, which answers
 *  with exactly this shape — the backend reuses `CourseSerializer` there on purpose
 *  (`backend/events/learning_views.py`) so there is one course shape, one mapper and one
 *  `CourseCard`, rather than a second summary kept in step with this one by hand. */
function mapCourseRef(raw: any): CourseRef {
	return {
		id: String(raw.id),
		title: raw.title ?? '',
		kind: raw.kind === 'university' ? 'university' : 'topic'
	};
}

export function mapCourse(raw: any): Course {
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
		kind: raw.kind === 'university' ? 'university' : 'topic',
		parent: raw.parent == null ? null : String(raw.parent),
		parentSummary: raw.parent_summary ? mapCourseRef(raw.parent_summary) : null,
		parentRelation:
			raw.parent_relation === 'version' || raw.parent_relation === 'subcourse'
				? raw.parent_relation
				: null,
		ancestors: (raw.ancestors ?? []).map(mapCourseRef),
		university: raw.university ?? '',
		faculty: raw.faculty ?? '',
		courseCode: raw.course_code ?? '',
		currentTerm: raw.current_term ?? '',
		visibility: raw.visibility,
		status: raw.status,
		enrollmentPolicy: raw.enrollment_policy,
		capacity: raw.capacity,
		discussionMode: raw.discussion_mode,
		progressVisibility: raw.progress_visibility ?? 'shared_anonymous',
		announceNewLessons: raw.announce_new_lessons,
		announceNewPosts: raw.announce_new_posts,
		language: raw.language,
		audience: (raw.audience ?? 'university') as Course['audience'],
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
		school: mapCourseSchool(raw.school),
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
		decidedAt: raw.decided_at,
		// `[]` and `false` for everybody the server does not answer these to — school mode
		// (`backend/courses/rules.staff_sees_guardians`). A stable shape, so the roster never
		// branches on whether a key exists.
		guardians: (raw.guardians ?? []).map(mapParticipant),
		isMinor: raw.is_minor ?? false
	};
}

function draftToBody(draft: TaughtCourseDraft): Record<string, unknown> {
	return {
		title: draft.title,
		summary: draft.summary,
		description: draft.description,
		subjects: draft.subjects,
		field: draft.field,
		kind: draft.kind,
		parent: draft.parent ? Number(draft.parent) : null,
		university: draft.university,
		faculty: draft.faculty,
		course_code: draft.courseCode,
		current_term: draft.currentTerm,
		visibility: draft.visibility,
		status: draft.status,
		enrollment_policy: draft.enrollmentPolicy,
		capacity: draft.capacity,
		discussion_mode: draft.discussionMode,
		progress_visibility: draft.progressVisibility,
		announce_new_lessons: draft.announceNewLessons,
		announce_new_posts: draft.announceNewPosts,
		contribution_policy: draft.contributionPolicy,
		language: draft.language,
		audience: draft.audience,
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
	/** Free-text search on title/description — the site-wide search page's own filter. */
	q?: string;
	kind?: CourseKind;
	/** Exact (case-insensitive) university name. */
	university?: string;
	faculty?: string;
	/** One course's children — its university/faculty versions AND its subcourses; the caller
	 *  tells them apart by each row's `parentRelation`. */
	parent?: string;
	/** General and stand-alone courses only — no versions. */
	topOnly?: boolean;
}

export async function getCourses(filters: CourseFilters = {}): Promise<Course[]> {
	const search = new URLSearchParams();
	if (filters.subject) search.set('subject', filters.subject);
	if (filters.field) search.set('field', filters.field);
	if (filters.openOnly) search.set('open', 'true');
	if (filters.q) search.set('q', filters.q);
	if (filters.kind) search.set('kind', filters.kind);
	if (filters.university) search.set('university', filters.university);
	if (filters.faculty) search.set('faculty', filters.faculty);
	if (filters.parent) search.set('parent', filters.parent);
	if (filters.topOnly) search.set('top', 'true');
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

/** One row of "all the materials in one place" — `GET /api/courses/{id}/materials/`. */
export interface CourseMaterialRow {
	itemId: string;
	materialId: string;
	label: string;
	course: {
		id: string;
		title: string;
		university: string;
		faculty: string;
		/** False for a row gathered from one of this general course's university versions. */
		isThisCourse: boolean;
	};
}

/** Every approved material in this course and — on a general course — in its university/faculty
 *  versions the viewer can see, one flat list (`backend/courses/views.py: materials`). */
export async function getCourseMaterials(id: string): Promise<CourseMaterialRow[]> {
	const raw = await apiClient.get<any[]>(`/courses/${encodeURIComponent(id)}/materials/`); // eslint-disable-line @typescript-eslint/no-explicit-any
	return raw.map((row) => ({
		itemId: String(row.id),
		materialId: String(row.material),
		label: row.label ?? '',
		course: {
			id: String(row.course?.id ?? ''),
			title: row.course?.title ?? '',
			university: row.course?.university ?? '',
			faculty: row.course?.faculty ?? '',
			isThisCourse: Boolean(row.course?.is_this_course)
		}
	}));
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

/** Which level a set link hangs off. A set belongs to a session, or to the week itself — the same
 * two destinations a `CourseItem` files into, and for the same reason: a reading everybody does
 * before week 3 starts belongs to the week, not to whichever session happens to be first in it. */
export type SetParentKind = 'lesson' | 'chapter';

function setsUrl(courseId: string, parentKind: SetParentKind, parentId: string): string {
	// The backend's own segment is plural (`lessons|chapters`), which is also what every other URL
	// in this API uses, so the singular kind is pluralised here rather than callers having to know.
	const segment = parentKind === 'lesson' ? 'lessons' : 'chapters';
	return `/courses/${encodeURIComponent(courseId)}/${segment}/${encodeURIComponent(parentId)}/exercise-sets/`;
}

export async function getLinkedSets(
	courseId: string,
	parentKind: SetParentKind,
	parentId: string
): Promise<LessonExerciseSet[]> {
	const raw = await apiClient.get<unknown[]>(setsUrl(courseId, parentKind, parentId));
	return raw.map(mapLessonExerciseSet);
}

/** `setSlug` is the set's own share slug (`ExerciseSet.slug`), which is what every other reference
 * to a set in this app already uses — never its numeric row id. */
export async function linkSet(
	courseId: string,
	parentKind: SetParentKind,
	parentId: string,
	setSlug: string,
	note = ''
): Promise<LessonExerciseSet> {
	return mapLessonExerciseSet(
		await apiClient.post(setsUrl(courseId, parentKind, parentId), { set: setSlug, note })
	);
}

export async function refreshLinkedSet(
	courseId: string,
	parentKind: SetParentKind,
	parentId: string,
	linkId: string
): Promise<LessonExerciseSet> {
	return mapLessonExerciseSet(
		await apiClient.patch(
			`${setsUrl(courseId, parentKind, parentId)}${encodeURIComponent(linkId)}/`,
			{ refresh: true }
		)
	);
}

export async function renameLinkedSet(
	courseId: string,
	parentKind: SetParentKind,
	parentId: string,
	linkId: string,
	title: string
): Promise<LessonExerciseSet> {
	return mapLessonExerciseSet(
		await apiClient.patch(
			`${setsUrl(courseId, parentKind, parentId)}${encodeURIComponent(linkId)}/`,
			{ title }
		)
	);
}

export async function unlinkSet(
	courseId: string,
	parentKind: SetParentKind,
	parentId: string,
	linkId: string
): Promise<void> {
	await apiClient.delete(
		`${setsUrl(courseId, parentKind, parentId)}${encodeURIComponent(linkId)}/`
	);
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
	/** Exactly one of these five — the server refuses anything else, and so does the database. */
	materialId?: string;
	exerciseId?: string;
	attachmentId?: string;
	eventId?: string;
	/** A comment id, and it must be the START of a thread: the server refuses a reply, and refuses
	 * a thread private to a different course. */
	discussionId?: string;
	/** Another EdMat course — one this person can open, and not this course itself. */
	linkedCourseId?: string;
	/** An address outside EdMat, http(s) only, with the title the curator gives it. */
	linkUrl?: string;
	linkTitle?: string;
	/** A board post. */
	postId?: string;
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
	if (submission.discussionId) body.discussion = Number(submission.discussionId);
	if (submission.linkedCourseId) body.linked_course = Number(submission.linkedCourseId);
	if (submission.linkUrl) {
		body.link_url = submission.linkUrl;
		body.link_title = submission.linkTitle ?? '';
	}
	if (submission.postId) body.post = Number(submission.postId);
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

/**
 * Record where you have got to on one session, and get back everything the mode lets you see.
 *
 * PUT rather than POST: there is one row per person per lesson and setting it is idempotent. The
 * whole block comes back rather than just the row that changed, because what your own answer means
 * to everybody else depends on the mode and the roster — neither of which a client should be
 * recomputing for itself.
 */
export async function setLessonProgress(
	courseId: string,
	lessonId: string,
	state: LessonProgressState
): Promise<LessonProgress> {
	return mapLessonProgress(
		await apiClient.put(
			`${feedbackPath(courseId, 'lesson', lessonId)}/progress/`,
			// `not_started` is a real write that deletes the row, not a no-op the client can skip.
			{ status: state }
		)
	);
}

export async function getLessonProgress(
	courseId: string,
	lessonId: string
): Promise<LessonProgress> {
	return mapLessonProgress(
		await apiClient.get(`${feedbackPath(courseId, 'lesson', lessonId)}/progress/`)
	);
}

/**
 * What has been reported inside this course — its own staff only.
 *
 * Its own endpoint rather than a slice of the platform moderation queue, because they are different
 * jobs for different people: that queue is platform-wide and scoped by taxonomy, and a course owner
 * wants "what needs dealing with in my room". See backend/courses/reports.py for why a taxonomy node
 * governor is deliberately given nothing here.
 */
interface RawCourseReport {
	id: number;
	body?: string;
	author?: string;
	where?: string;
	auto_hidden?: boolean;
	is_removed?: boolean;
	report_count?: number;
	reasons?: string[];
	last_reported_at: string;
}

export async function getCourseReports(courseId: string): Promise<CourseReportRow[]> {
	const raw = await apiClient.get<RawCourseReport[]>(
		`/courses/${encodeURIComponent(courseId)}/reports/`
	);
	return raw.map((row) => ({
		kind: 'comment' as const,
		id: String(row.id),
		body: row.body ?? '',
		author: row.author ?? '',
		where: row.where ?? '',
		autoHidden: row.auto_hidden ?? false,
		isRemoved: row.is_removed ?? false,
		reportCount: row.report_count ?? 0,
		reasons: row.reasons ?? [],
		lastReportedAt: row.last_reported_at
	}));
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

/* eslint-disable @typescript-eslint/no-explicit-any -- the same wire-shape mapping every block
   above already opts out for: the response is untyped JSON until this function has narrowed it. */

/** Everything inside one course matching `query`, as much of it as the caller may see.
 *
 * One request rather than searching each tab's data client-side: the page only ever holds what the
 * viewer may see of the CONTENT, and the discussion is fetched separately and only for the tab that
 * shows it — so a client-side filter would silently never find a comment, which is the commonest
 * thing anybody actually looks for ("where did we talk about that").
 *
 * `lang` is sent for the same reason `taxonomy.ts` resolves it inside its own functions rather than
 * leaving it to callers: a result's label for a referenced MATERIAL is a per-locale row, and it is
 * being read here as a navigation label — the name of a thing you are about to click — not as
 * content somebody chose to read in its original language. Without it the backend falls back to the
 * original locale and an English interface lists Polish titles.
 *
 * Ids arrive numeric and become strings on the way in, matching every other mapper here. */
export async function searchCourse(courseId: string, query: string): Promise<CourseSearchResult> {
	const raw = await apiClient.get<any>(
		`/courses/${encodeURIComponent(courseId)}/search/?q=${encodeURIComponent(query)}` +
			`&lang=${encodeURIComponent(getLocale())}`
	);
	return {
		query: raw.query ?? '',
		terms: raw.terms ?? [],
		truncated: Boolean(raw.truncated),
		reason: raw.reason ?? null,
		minLength: raw.min_length ?? 2,
		// `results` on the wire, `hits` here: `CourseSearchResult` is itself a result, and a `.results`
		// inside a result reads as though there were two levels of them.
		hits: (raw.results ?? []).map((row: any): CourseSearchHit => ({
			kind: row.kind,
			id: String(row.id),
			title: row.title ?? '',
			field: row.field ?? '',
			snippet: row.snippet ?? '',
			chapter: row.chapter ? { id: String(row.chapter.id), title: row.chapter.title } : null,
			lesson: row.lesson ? { id: String(row.lesson.id), title: row.lesson.title } : null,
			itemKind: row.item_kind,
			targetId: row.target_id == null ? undefined : String(row.target_id),
			status: row.status,
			isUnlocked: row.is_unlocked,
			thread: row.thread
				? { kind: row.thread.kind, id: String(row.thread.id), title: row.thread.title }
				: undefined,
			createdAt: row.created_at
		}))
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* --- covers / requires claims ------------------------------------------------------------- */

import { mapMaterialCoverage, type RawMaterialCoverage } from '$lib/api/mappers';
import type { MaterialCoverage } from '$lib/types';
import { DuplicateCoverageError, type ProposeCoverageInput } from '$lib/services/materials';

/** The claims on a course — the same rows a material carries (`MaterialCoverage`, with
 * `ownerKind: 'course'`), read from `/courses/{id}/claims/`. Voting, ranking and the thread go
 * through the shared claim services in `materials.ts`, which pick the course route by `ownerKind`. */
export async function getCourseClaims(courseId: string): Promise<MaterialCoverage[]> {
	const raw = await apiClient.get<RawMaterialCoverage[]>(
		`/courses/${encodeURIComponent(courseId)}/claims/`
	);
	return raw.map(mapMaterialCoverage);
}

export async function proposeCourseClaim(
	courseId: string,
	input: ProposeCoverageInput
): Promise<MaterialCoverage> {
	try {
		const raw = await apiClient.post<RawMaterialCoverage>(
			`/courses/${encodeURIComponent(courseId)}/claims/`,
			{
				kind: input.kind,
				topic: Number(input.topicId),
				subtopic: input.subtopicId ? Number(input.subtopicId) : undefined,
				subtopic_slug: input.subtopicSlug,
				subtopic_name: input.subtopicName,
				locale: input.locale,
				level: input.level
			}
		);
		return mapMaterialCoverage(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 409) throw new DuplicateCoverageError(e.message);
		throw e;
	}
}

// ---- completion certificates ------------------------------------------------------------------
//
// Issued by hand by course staff to a participant whose own progress statements say every lesson is
// done. No grade, no mark, no rank (`prompts/00-DESIGN.md` §4.5). The refusal words come back as
// `{detail: '<word>'}` and `COMPLETION_BLOCK_LABELS` in `lib/utils/labels.ts` has a sentence for
// each — house rule 6 from the client's side.

/** Thrown with the server's own word, so a caller branches on WHICH refusal rather than on a
 *  status code. The same shape `EnrolmentRefused` already uses in this file. */
export class CompletionRefused extends Error {
	constructor(public reason: CompletionBlockReason) {
		super(reason);
		this.name = 'CompletionRefused';
	}
}

function completionRefusal(error: unknown): never {
	if (error instanceof ApiError && error.body && typeof error.body === 'object') {
		const detail = (error.body as Record<string, unknown>).detail;
		if (typeof detail === 'string') throw new CompletionRefused(detail as CompletionBlockReason);
	}
	throw error;
}

/** Staff get every certificate on the course; anybody else gets their own and nothing else. Scoped
 *  server-side, not refused — an empty list for somebody who has none leaks neither the existence
 *  of other people's certificates nor the size of the roster. */
export async function getCompletions(courseId: string): Promise<CourseCompletion[]> {
	const rows = await apiClient.get<unknown[]>(
		`/courses/${encodeURIComponent(courseId)}/completions/`
	);
	return rows.map(mapCompletion);
}

export async function issueCompletion(
	courseId: string,
	participantId: string,
	note = ''
): Promise<CourseCompletion> {
	try {
		return mapCompletion(
			await apiClient.post(`/courses/${encodeURIComponent(courseId)}/completions/`, {
				participant: Number(participantId),
				note
			})
		);
	} catch (error) {
		return completionRefusal(error);
	}
}

/** Withdrawn, never deleted (house rule 12): the row stays, so a holder who printed the sheet finds
 *  the page saying so rather than a 404. */
export async function revokeCompletion(completionId: string): Promise<CourseCompletion> {
	try {
		return mapCompletion(
			await apiClient.post(`/course-completions/${encodeURIComponent(completionId)}/revoke/`)
		);
	} catch (error) {
		return completionRefusal(error);
	}
}

/** One certificate by its own id — what the printable sheet reads. Undefined for a 404, which is
 *  what a stranger gets: a 403 would confirm that somebody finished a course, which is the fact the
 *  page exists to carry. */
export async function getCompletion(completionId: string): Promise<CourseCompletion | undefined> {
	try {
		return mapCompletion(
			await apiClient.get(`/course-completions/${encodeURIComponent(completionId)}/`)
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) return undefined;
		throw error;
	}
}

// ---- lesson -> deck ---------------------------------------------------------------------------

/** Every exercise this week points at, in the order it is drawn, deduplicated.
 *
 * The lesson's own exercise items first, then every linked set's visible exercises — which is the
 * order the page itself draws them in, so the deck a person gets back is in the order they were
 * looking at. Deduplicated because a set and a direct item may legitimately name the same exercise
 * and a deck with the same card twice is nobody's intention.
 *
 * Read off the course payload the page already has rather than fetched: the server has already
 * decided what this viewer may see (`CourseItem.is_visible_to`, `LessonExerciseSet.visible_exercises`
 * drops anything a moderator unpublished), and a client that asked again would be a client that
 * could ask with the wrong scope.
 */
export function lessonExerciseIds(lesson: Lesson): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	const add = (id: string | null) => {
		if (!id || seen.has(id)) return;
		seen.add(id);
		ids.push(id);
	};
	for (const item of lesson.items) if (item.kind === 'exercise') add(item.exercise);
	for (const link of lesson.exerciseSets) for (const row of link.exercises) add(row.exercise);
	return ids;
}
