/** Courses run by users, and enrolment in them.
 *
 * `TaughtCourse`, not `Course`, for the same reason the backend uses that name: `Course` in this
 * app already means a university *subject* (`taxonomy.Course`, e.g. Analiza Matematyczna II), which
 * nobody runs and nobody joins. Users only ever see the word "course"; the distinction lives in the
 * code, where confusing the two would be a real bug.
 */

export type CourseStatus = 'draft' | 'open' | 'running' | 'finished';
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
	chapter: string | null;
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
	items: CourseItem[];
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

export interface Lesson {
	id: string;
	title: string;
	description: string;
	order: number;
	scheduledAt: string | null;
	durationMinutes: number | null;
	exerciseIds: string[];
	materialIds: string[];
	/** Empty unless the viewer is actually in the course — the field is always present, so no
	 * client ever has to branch on whether a key exists. */
	participantNotes: string;
}

export interface TaughtCourse {
	id: string;
	instructor: Participant;
	title: string;
	summary: string;
	description: string;
	subjectSlugs: string[];
	fieldSlug: string | null;
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
	title: string;
	description: string;
	order: number;
	scheduledAt: string | null;
	durationMinutes: number | null;
	participantNotes: string;
}
