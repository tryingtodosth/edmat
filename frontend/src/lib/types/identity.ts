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
	/** The learning record's own consent — what this account has DONE on EdMat, as counts per
	 * branch. Its own flag rather than a fourth meaning for `shareGrades`, because an EdMat count
	 * and an institutional mark are two different kinds of fact (`backend/identity/record.py`). */
	shareActivity: boolean;
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

/** One branch of the learning record, in either block. The slug is the id `/branches/[branch]`
 * takes; the title is already resolved for the locale that was asked for, so nothing here resolves
 * a translation a second time. */
export interface LearningRecordBranch {
	slug: string;
	title: string;
}

/** A shared institutional result, grouped per branch. `average` is `null` for a branch that mixes
 * grading scales — there is no honest way to fold an ECTS letter into the Polish 2–5 scale, and the
 * backend refuses rather than inventing one. */
export interface LearningRecordGradeRow {
	branch: LearningRecordBranch;
	average: number | null;
	count: number;
}

/** What somebody did on EdMat in one branch. Counts only, never items: `sets` is how many of their
 * sets involve this branch, `lessonsDone` how many lessons they SAID they finished, `cardsReviewed`
 * how many flashcard reviews they logged. `extra` carries any metric a provider registered that
 * this cycle did not declare (`identity/record.py: METRIC_KEYS`), so a later app's column renders
 * rather than silently disappearing. */
export interface LearningRecordActivityRow {
	branch: LearningRecordBranch;
	sets: number;
	lessonsDone: number;
	cardsReviewed: number;
	extra: Record<string, number>;
}

/** One result somebody was awarded in a contest another person ran
 * (`backend/contests/record.py: placements_for`, CONTESTS-BRIEF.md §3.B).
 *
 * `resultTitle` is the contest's own word — laureate, finalist, distinction, participant — and NOT
 * a score: the organiser decided it against published criteria, and EdMat was the medium
 * (`LEGAL.md`, "Contests"). `publishedAt` is null while the organiser has not published the
 * ranking, which is why the row can exist without a date. */
export interface LearningRecordPlacement {
	contestId: string;
	title: string;
	resultTitle: string;
	publishedAt: string | null;
}

/** The three blocks, and they are never merged.
 *
 * `prompts/00-DESIGN.md` §1 rule 3: an EdMat activity count is never drawn beside an institutional
 * grade as if it were one. Two lists, two headings, two consents — a single list with a nullable
 * `average` column would have read as one measurement with gaps in it.
 *
 * `null` for a block means "not shared" and renders nothing. `isOwner` is true only when the reader
 * is the account holder, and exists so their own profile can tell them what everyone else sees;
 * it never widens the data. `withheldReason` is `'minor'` when the record is withheld because the
 * account belongs to a minor, whatever the consents say (`accounts/minors.py`). */
export interface LearningRecord {
	isOwner: boolean;
	withheldReason: 'minor' | null;
	grades: LearningRecordGradeRow[] | null;
	activity: LearningRecordActivityRow[] | null;
	/** Contest results, behind the SAME consent as `activity` — both answer "what has this person
	 * done here", and asking for a second tick for the half that has titles in it would be a
	 * setting nobody could explain. A third list rather than a column on `activity`, because a
	 * placement is named and dated and is not a count per subject. `null` means "not shared";
	 * `[]` means shared and empty. */
	placements: LearningRecordPlacement[] | null;
}
