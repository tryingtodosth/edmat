/** Courses run by users, and enrolment in them.
 *
 * `TaughtCourse`, not `Course`, for the same reason the backend uses that name: `Course` in this
 * app already means a university *subject* (`taxonomy.Course`, e.g. Analiza Matematyczna II), which
 * nobody runs and nobody joins. Users only ever see the word "course"; the distinction lives in the
 * code, where confusing the two would be a real bug.
 */

export type CourseStatus = 'draft' | 'open' | 'running' | 'finished';
export type EnrollmentPolicy = 'open' | 'approval';
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

export interface Participant {
	id: string;
	displayName: string;
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
}

export interface Enrollment {
	id: string;
	courseId: string;
	courseTitle: string;
	participant: Participant;
	status: EnrollmentStatus;
	requestNote: string;
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
	language: string;
	startsOn: string | null;
	endsOn: string | null;
	price: string | null;
	currency: string;
}

export interface LessonDraft {
	title: string;
	description: string;
	order: number;
	scheduledAt: string | null;
	durationMinutes: number | null;
	participantNotes: string;
}
