/** Sign-in provider drafts, institutions, and the education claim.
 *
 * These shapes are deliberately close to the API's own, and mapped rather than consumed raw only
 * where the two genuinely differ (snake_case → camelCase), matching this app's existing
 * mappers.ts convention. The provider/USOS *state* objects are the exception: they are computed
 * server-side from real settings, and the UI's job is to render what it is told rather than to
 * re-derive any of it — so a blocker string arrives as a sentence, not as a flag the frontend then
 * has to turn back into words that would drift from the backend's own.
 */

export type ProviderId = 'school' | 'google' | 'apple' | 'github';
export type ProviderProtocol = 'oidc' | 'oauth2' | 'saml';

export interface ProviderState {
	id: ProviderId;
	label: string;
	protocol: ProviderProtocol;
	/** 'draft' until a real client id/secret exists; computed from settings, never hardcoded. */
	status: 'draft' | 'configured';
	scopes: string[];
	authorizeUrl: string;
	tokenUrl: string;
	userinfoUrl: string;
	jwksUrl: string;
	usesPkce: boolean;
	responseMode: 'query' | 'form_post';
	/** The thing a first implementation typically gets wrong for this provider. */
	quirk: string;
	/** What specifically stands between this provider and a working sign-in, right now. */
	blockers: string[];
	/** Checks a real callback route owes, written down rather than discovered later. */
	callbackRequirements: string[];
}

export interface School {
	slug: string;
	name: string;
	shortName: string;
	country: string;
	city: string;
	gradeScale: 'polish_2_5' | 'ects_letter';
	runsUsos: boolean;
}

export type Verification = 'self_declared' | 'school_email' | 'usos';
export type StudentStatus = 'unknown' | 'student' | 'alumnus' | 'staff';

export interface Diploma {
	id: number;
	title: string;
	level: string;
	programme: string;
	issuedOn: string | null;
	finalGrade: string;
}

export interface CourseGrade {
	id: number;
	code: string;
	name: string;
	term: string;
	ects: number;
	value: string;
	scale: 'polish_2_5' | 'ects_letter';
	branchSlug: string | null;
}

/** One academic year of a transcript, grouped and averaged server-side.
 *
 * Not derived in the browser, deliberately: a year's average has real rules (ECTS-weighted, and null
 * outright when that year mixes grading scales), and a second implementation of them here is how the
 * per-year figures and the overall one start disagreeing on the same screen. */
export interface GradeYear {
	/** e.g. `'2023/24'`. Empty when the registry's own term was unreadable — sorts last, and is not
	 * the same thing as the oldest year. */
	year: string;
	terms: string[];
	count: number;
	ects: number;
	average: number | null;
}

export interface EducationProfile {
	school: string | null;
	schoolLabel: string;
	otherSchoolName: string;
	verification: Verification;
	status: StudentStatus;
	programme: string;
	studyYear: number | null;
	usosConnected: boolean;
	usosStudentNumber: string;
	usosScopes: string[];
	shareSchool: boolean;
	shareDiploma: boolean;
	shareGrades: boolean;
	diplomas: Diploma[];
	grades: CourseGrade[];
	gradeYears: GradeYear[];
}

export interface StandingReason {
	code: string;
	tier: string;
	detail: string;
}

export interface Standing {
	/** The verification ceiling from LAUNCHCHECKLIST §3 — a cap on capability, never authority. */
	tier: string;
	usosTier: string | null;
	reasons: StandingReason[];
	skillSeeds: { branchSlug: string; courseName: string; ects: number; basis: string }[];
	average: number | null;
}

export interface UsosState {
	protocol: string;
	isMock: boolean;
	configuredSchools: string[];
	baseScopes: string[];
	gradesScope: string;
	schoolRunsUsos: boolean;
	capabilities: { identity: boolean; studies: boolean; grades: boolean; diplomas: boolean };
	blockers: string[];
	grants: string[];
}

export interface EducationSnapshot {
	education: EducationProfile;
	standing: Standing;
	usos: UsosState;
	/** True when the account's address is on the declared institution's domain — which is NOT
	 * verification here, because EdMat cannot confirm an address yet. The UI uses this to explain
	 * why, rather than to grant anything. */
	schoolEmailEligible: boolean;
}

/** What a stranger may see, which is nothing at all unless consent says otherwise. */
export interface PublicEducation {
	school: string;
	verification: Verification;
	status: StudentStatus;
	programme: string;
	diplomas: { title: string; programme: string; issuedOn: string; finalGrade: string }[];
	grades: {
		name: string;
		term: string;
		ects: number;
		value: string;
		scale: string;
		branchSlug: string | null;
	}[];
	gradeYears: GradeYear[];
	average: number | null;
}
