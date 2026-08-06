/** Courses run by users, and enrolment in them.
 *
 * Still `Course` rather than `Course`, mirroring the backend. The name existed because
 * `Course` used to mean a university *subject* (przedmiot, e.g. Analiza Matematyczna II) — that is
 * now `Branch`, so the word is free, and taking it is the next step rather than part of the
 * taxonomy split. Users only ever saw "course" either way.
 */

/** Who may see the course at all. Split out of `CourseStatus`, which used to answer this and "how
 * far along is it" with one value — so `draft` meant hidden while `open`/`running`/`finished` all
 * silently meant public, and there was no way to say "under way, but unlisted". */
export type CourseVisibility = 'only_you' | 'private' | 'public';
/** How far along the course is. Lifecycle only — `draft` moved to `CourseVisibility`. */
export type CourseStatus = 'open' | 'running' | 'finished';
export type EnrollmentPolicy = 'open' | 'approval';
/** Who may READ the thread. Posting is always restricted to the people in the course — "anyone may
 * read" is a reasonable thing for an instructor to want, "anyone may post" is not. */
export type DiscussionMode = 'off' | 'participants' | 'public';
export type EnrollmentStatus = 'pending' | 'active' | 'left' | 'declined' | 'removed';

/** Why the viewer cannot join. Resolved server-side, because "full" and "you were removed" are the
 * same refusal to a boolean and completely different to a person. */
export type EnrollmentBlockReason =
	| 'authentication_required'
	| 'instructor_cannot_enrol'
	| 'not_open'
	| 'already_enrolled'
	| 'removed'
	| 'full';

/** What somebody is to a course they run. Three rather than a boolean, because the useful question
 * is not "trusted or not" but which job they were brought in to do — see the backend's own note. */
export type StaffRole = 'owner' | 'admin' | 'assistant';

/** Who may put materials and exercises into a course. */
export type ContributionPolicy = 'staff' | 'approval' | 'open';

/** The lifecycle of one offered piece of content. `pending` only exists under the approval policy. */
export type ContributionStatus = 'pending' | 'approved' | 'rejected';

/** What following an invite link grants. No 'owner': transferring a course is a decision about a
 * named person, never something left lying in a URL. */
export type InviteRole = 'participant' | 'assistant' | 'admin';

/** Why a link will not work. A reason rather than a boolean, for the same purpose as
 * `EnrollmentBlockReason`: "expired" and "already used up" are different to the person holding it. */
export type InviteUnusableReason = 'revoked' | 'expired' | 'used_up';

export interface Participant {
	id: string;
	displayName: string;
}

export interface CourseStaffMember {
	id: string;
	user: Participant;
	role: StaffRole;
	addedAt: string;
}

export interface CourseItem {
	id: string;
	kind: 'material' | 'exercise';
	lesson: string | null;
	material: string | null;
	exercise: string | null;
	/** Enough to recognise the thing without a second request — a material's resolved title, or an
	 * exercise's subject-and-number, which is the only name an exercise has ever had here. */
	label: string;
	order: number;
	note: string;
	status: ContributionStatus;
	submittedBy: Participant | null;
	decidedBy: Participant | null;
	decidedAt: string | null;
	decisionNote: string;
	createdAt: string;
}

export interface Chapter {
	id: string;
	title: string;
	description: string;
	order: number;
	unlocksAt: string | null;
	/** The chapter's own state, not the viewer's access to it: staff see a locked chapter's contents
	 * while it is still shut, and need to know that it is. */
	isUnlocked: boolean;
	/** Empty for a participant while the chapter is locked. The chapter itself still renders, so a
	 * course never looks shorter than it is. */
	lessons: Lesson[];
}

export interface CourseInvite {
	id: string;
	token: string;
	role: InviteRole;
	label: string;
	createdBy: Participant | null;
	createdAt: string;
	/** 0 means unlimited, matching how `capacity` already says the same thing. */
	maxUses: number;
	uses: number;
	expiresAt: string | null;
	revokedAt: string | null;
	isUsable: boolean;
	unusableReason: InviteUnusableReason | null;
}

/** What somebody holding a link is told before they act on it, and before they have logged in.
 * Deliberately thin — an invite token travels through group chats. */
export interface InvitePreview {
	courseId: string;
	courseTitle: string;
	instructorName: string;
	role: InviteRole;
	isUsable: boolean;
	unusableReason: InviteUnusableReason | null;
}

/** The middle level: a session inside a chapter, holding the items worked through in it.
 *
 * This used to sit beside Chapter and point at exercises and materials with two id arrays. Those
 * are gone: content lives in `CourseItem`, which is the half that can also say "a participant
 * offered this and it is waiting for review". */
export interface Lesson {
	id: string;
	chapterId: string;
	title: string;
	description: string;
	order: number;
	scheduledAt: string | null;
	durationMinutes: number | null;
	/** Empty unless the viewer is actually in the course — the field is always present, so no
	 * client ever has to branch on whether a key exists. */
	participantNotes: string;
	items: CourseItem[];
}

export interface Course {
	id: string;
	instructor: Participant;
	title: string;
	summary: string;
	description: string;
	subjectSlugs: string[];
	fieldSlug: string | null;
	visibility: CourseVisibility;
	status: CourseStatus;
	enrollmentPolicy: EnrollmentPolicy;
	capacity: number;
	discussionMode: DiscussionMode;
	announceNewLessons: boolean;
	announceNewPosts: boolean;
	language: string;
	startsOn: string | null;
	endsOn: string | null;
	price: string | null;
	currency: string;
	createdAt: string;
	lessons: Lesson[];
	participantCount: number;
	/** null when the course is uncapped — deliberately not 0, which would read as "full". */
	seatsLeft: number | null;
	isFull: boolean;
	myEnrollmentStatus: EnrollmentStatus | null;
	canEnrol: boolean;
	enrollmentBlockReason: EnrollmentBlockReason | null;
	isInstructor: boolean;
	canReadDiscussion: boolean;
	canPostDiscussion: boolean;
	/** The viewer's own per-course mute. null when they are not in the course at all, which is
	 * genuinely different from being in it with notifications off. */
	notifyMe: boolean | null;

	contributionPolicy: ContributionPolicy;
	/** The viewer's own standing, resolved server-side — a client that computes a permission is a
	 * client that can compute it wrongly. null means they do not run this course. */
	myRole: StaffRole | null;
	canAdminister: boolean;
	canCurate: boolean;
	canContribute: boolean;
	/** Whether what THIS viewer adds would wait for review. False for staff, who never queue behind
	 * themselves. */
	contributionNeedsApproval: boolean;
	chapters: Chapter[];
	/** Content in the course but filed in no chapter — where a submission lands before anybody
	 * decides which week it belongs to, and where everything lives in a course using no chapters. */
	unfiledItems: CourseItem[];
	/** 0 for anybody who cannot act on the queue. */
	pendingContributionCount: number;
}

export interface Enrollment {
	id: string;
	courseId: string;
	courseTitle: string;
	participant: Participant;
	status: EnrollmentStatus;
	requestNote: string;
	notify: boolean;
	requestedAt: string;
	decidedAt: string | null;
}

export interface TaughtCourseDraft {
	title: string;
	summary: string;
	description: string;
	subjects: string[];
	field: string | null;
	visibility: CourseVisibility;
	status: CourseStatus;
	enrollmentPolicy: EnrollmentPolicy;
	capacity: number;
	discussionMode: DiscussionMode;
	announceNewLessons: boolean;
	announceNewPosts: boolean;
	contributionPolicy: ContributionPolicy;
	language: string;
	startsOn: string | null;
	endsOn: string | null;
	price: string | null;
	currency: string;
}

export interface ChapterDraft {
	title: string;
	description: string;
	order: number;
	unlocksAt: string | null;
}

export interface CourseInviteDraft {
	role: InviteRole;
	label: string;
	maxUses: number;
	expiresAt: string | null;
}

export interface LessonDraft {
	chapterId: string;
	title: string;
	description: string;
	order: number;
	scheduledAt: string | null;
	durationMinutes: number | null;
	participantNotes: string;
}

/** A person's own notes on a course, or on one lesson in it.
 *
 * There is no author here on purpose: the API only ever returns the caller's own rows, and a field
 * implying otherwise would invite a "notes for this course" view that leaks. Distinct from
 * `Lesson.participantNotes`, which staff write FOR everybody. */
export interface CourseNote {
	id: string;
	/** null for the course-level note. */
	lessonId: string | null;
	body: string;
	updatedAt: string;
}

/** A file the course keeps — last year's exam, Tuesday's slides, somebody's scan.
 *
 * Not a Material: a Material is corpus content, branch-scoped and discoverable site-wide. An
 * attachment belongs to this course, is readable only by people in it, and has its own thread
 * rather than a public review page. */
export interface Attachment {
	id: string;
	title: string;
	description: string;
	fileUrl: string;
	sizeBytes: number;
	uploadedBy: { id: string; displayName: string } | null;
	createdAt: string;
	reviewCount: number;
	/** null, not 0, when nobody has reviewed it — zero is a rating somebody gave. */
	averageRating: number | null;
}

export interface AttachmentReview {
	id: string;
	author: { id: string; displayName: string };
	rating: number;
	body: string;
	createdAt: string;
}
