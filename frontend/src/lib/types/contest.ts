// `contests` — a staged competition somebody organises, a jury scores, and results close
// (CONTESTS-BRIEF.md §3.A). A hand-maintained mirror of `backend/contests/models.py`'s choices and
// of `backend/contests/presets.py`'s three enums; house rule 13 says to say so in both files, and
// both of those modules name this one.
//
// Nothing in here is writable just because it is typed: `status`, `announcedAt`,
// `resultsPublishedAt`, `advanced`, every point total and every result row are the server's
// (`contests/rules.py` is their only writer). `ContestDraft` below is the writable half.

import type { TextVersion } from '$lib/types/translation';
import type { NodeRef } from './node';

/** The lifecycle, in the order a contest moves through it. One `status` field, never two booleans
 *  (root CLAUDE.md, shape 4). `cancelled` is reachable from everything but `closed`. */
export type ContestStatus =
	| 'draft'
	| 'announced'
	| 'registration_open'
	| 'running'
	| 'judging'
	| 'results_published'
	| 'closed'
	| 'cancelled';

/** The eight statuses as the status strip draws them, in order, with `cancelled` off to the side
 *  because it is not a step forward. */
export const CONTEST_STATUS_FLOW: ContestStatus[] = [
	'draft',
	'announced',
	'registration_open',
	'running',
	'judging',
	'results_published',
	'closed'
];

export type ContestVisibility = 'private' | 'public';

/** Role presets, never a permission editor. `jury` scores and nothing else; `proctor` supervises a
 *  stage; `secretary` handles registrations and complaints but does not score. */
export type ContestStaffRole = 'organiser' | 'jury' | 'proctor' | 'secretary';

/** `presets.PRIZE_REGIMES`. `none` is the default and the whole point of the `challenge` preset. */
export type PrizeRegime = 'none' | 'pupil_exempt_115' | 'science_68_then_10pct' | 'flat_10pct';

/** `presets.ORGANISER_KINDS` — who the *przyrzekający*, the controller and the płatnik is. */
export type OrganiserKind = 'person' | 'organization' | 'kurator' | 'committee';

/** `presets.ADVANCEMENTS`. There is deliberately no `draw`: chance deciding any stage makes the
 *  whole thing a *gra losowa* needing a permit (CONTESTS-LAW.md §2). */
export type Advancement = 'all' | 'top_n' | 'threshold' | 'final';

export type StageMode = 'online' | 'onsite';
export type StageStatus = 'scheduled' | 'open' | 'closed' | 'scored';

export type RegistrationStatus =
	| 'requested'
	| 'accepted'
	| 'declined'
	| 'withdrawn'
	| 'disqualified';

export type SubmissionStatus = 'draft' | 'submitted' | 'scored';

export type ResultTitle = 'participant' | 'distinction' | 'finalist' | 'laureate';

export type ComplaintStatus = 'open' | 'answered' | 'withdrawn';

export type EntryLicence = 'none' | 'non_exclusive';
export type PublicationDefault = 'initials' | 'full_name_opt_in';

/** How sure the research is of a citation (`presets.LAW_MARKERS`). The compliance panel draws one
 *  of these beside every article number, because an unverified number must never read as settled. */
export type LawMarker = 'verified' | 'secondary' | 'unverified' | 'disputed';

/** Every refusal word `contests/rules.py` can answer with. `CONTEST_BLOCK_LABELS` in
 *  `lib/utils/labels.ts` has one sentence per word (house rule 6). */
export type ContestBlockReason =
	// announce
	| 'claim_deadline_missing'
	| 'jury_missing'
	| 'criteria_missing'
	| 'controller_missing'
	| 'external_reference_missing'
	| 'no_stages'
	| 'chance_element'
	| 'rules_missing'
	// the lifecycle
	| 'illegal_transition'
	| 'closed'
	| 'stages_locked'
	// registering
	| 'anonymous'
	| 'not_open'
	| 'own_staff'
	| 'minor'
	| 'guardian_consent_required'
	| 'already_registered'
	| 'full'
	| 'team_required'
	// answering
	| 'stage_not_open'
	| 'not_accepted'
	| 'already_submitted'
	| 'not_advanced'
	| 'no_problems'
	// scoring and publishing
	| 'not_juror'
	| 'stage_open'
	| 'own_submission'
	| 'stage_unscored'
	| 'already_published'
	| 'not_published'
	| 'window_closed'
	// complaints
	| 'not_participant'
	| 'already_open'
	| 'already_answered'
	// authority
	| 'not_manager'
	| 'not_staff'
	| 'last_organiser'
	| 'already_staff'
	| 'has_submissions';

export interface ContestPerson {
	id: string;
	displayName: string;
}

// ---- the presets endpoint ------------------------------------------------------------------

export interface LawCitation {
	citation: string;
	marker: LawMarker;
}

export interface PresetStage {
	key: string;
	nameEn: string;
	namePl: string;
	/** `either` means the founder chooses in the wizard; a stored stage is only ever one of two. */
	mode: StageMode | 'either';
	offsetDays: number;
	durationDays: number;
	advancement: Advancement;
}

export interface PresetRulesSection {
	key: string;
	headingEn: string;
	headingPl: string;
	required: boolean;
	law: string[];
	guidanceEn: string;
	guidancePl: string;
}

export interface PresetChecklistItem {
	key: string;
	titleEn: string;
	titlePl: string;
	law: string[];
	role: 'organiser' | 'secretary';
	phase: 'before_announce' | 'before_results' | 'after_results' | 'at_close';
}

export interface PresetRoleSlot {
	role: ContestStaffRole;
	count: number;
	required: boolean;
}

export interface PresetInfo {
	en: string;
	pl: string;
	law: string[];
}

export interface ContestPreset {
	key: string;
	nameEn: string;
	namePl: string;
	summaryEn: string;
	summaryPl: string;
	organiserKind: OrganiserKind;
	audience: string;
	allowsMinors: boolean;
	minorsOnly: boolean;
	hasPrize: boolean;
	prizeRegime: PrizeRegime;
	team: boolean;
	stages: PresetStage[];
	stagesLocked: boolean;
	juryMin: number;
	juryRecommended: number;
	externalReferenceRequired: boolean;
	staffOnly: boolean;
	consumerBlock: 'never' | 'if_business' | 'always';
	complaintWindowDays: number;
	publicationDefault: PublicationDefault;
	rulesSections: PresetRulesSection[];
	checklist: PresetChecklistItem[];
	goalCriteria: { en: string; pl: string }[];
	needs: { kind: string; titleEn: string; titlePl: string; wantedCount: number }[];
	roles: PresetRoleSlot[];
	info: PresetInfo[];
}

export interface PresetsPayload {
	law: Record<string, LawCitation>;
	presets: ContestPreset[];
}

// ---- the contest itself --------------------------------------------------------------------

export interface ContestRegistrationRow {
	id: string;
	user: ContestPerson | null;
	/** The anonymised label the jury scores against: this row's position among the contest's
	 *  registrations, by arrival. Recounted server-side, never stored. */
	number: number;
	initials: string;
	status: RegistrationStatus;
	affiliation: string;
	guardianName: string;
	hasGuardianConsent: boolean;
	/** Its own revocable consent, defaulting to false — never bundled into entry. */
	publishName: boolean;
	teamName: string;
	acceptedRulesVersion: number;
	createdAt: string;
	decidedAt: string | null;
}

export interface Contest {
	id: string;
	/** The title and description in every language somebody has written them in
	 *  (`translations/`, kind `contest`); `title`/`description` above are already the reader's. */
	textVersions: TextVersion[];
	node: NodeRef | null;
	title: string;
	description: string;
	presetKey: string;
	/** The full preset payload — only on a detail read; a card does not pay for it. */
	preset: ContestPreset | null;
	organiser: ContestPerson | null;
	organization: string | null;
	status: ContestStatus;
	visibility: ContestVisibility;
	audience: string;
	allowsMinors: boolean;
	startsAt: string | null;
	endsAt: string | null;
	registrationOpensAt: string | null;
	registrationClosesAt: string | null;
	hasPrize: boolean;
	prizeClaimDeadline: string | null;
	prizeDescription: string;
	prizeTotalValuePln: number | null;
	prizeRegime: PrizeRegime;
	organiserIsBusiness: boolean;
	externalReferenceUrl: string;
	entryLicence: EntryLicence;
	complaintWindowDays: number;
	publicationDefault: PublicationDefault;
	meritCriteria: string;
	dataControllerName: string;
	dataControllerContact: string;
	accommodationContact: string;
	team: boolean;
	teamSizeMax: number | null;
	capacity: number | null;
	laureateMinPct: number;
	finalistMinPct: number;
	distinctionCount: number;
	announcedAt: string | null;
	resultsPublishedAt: string | null;
	closedAt: string | null;
	complaintsCloseAt: string | null;
	rulesVersion: number;
	resultsArePublished: boolean;
	createdAt: string;
	updatedAt: string;
	myRole: ContestStaffRole | null;
	isMember: boolean;
	canManage: boolean;
	canScore: boolean;
	registrationCount: number;
	juryCount: number;
	stageCount: number;
	/** Why it cannot be announced yet — for its staff only, on every read, so an organiser learns
	 *  which field is missing before they press the button (house rule 6). */
	announceBlockReason: ContestBlockReason | null;
	registerBlockReason: ContestBlockReason | null;
	myRegistration: ContestRegistrationRow | null;
}

/** What `POST /api/contests/` returns on top of the contest: what `personalize.apply_preset` made
 *  on the new contest node, and — honestly — what it skipped. */
export interface ContestCreated extends Contest {
	personalisation: {
		preset: string;
		created: {
			plan: string | null;
			goal: string | null;
			tasks: string[];
			needs: string[];
			polls: string[];
		};
		skipped: string[];
	};
}

/** The writable half. Everything optional: the wizard sends what the founder edited and the
 *  server fills the rest from the preset. */
export interface ContestDraft {
	title?: string;
	description?: string;
	presetKey?: string;
	organization?: string | null;
	visibility?: ContestVisibility;
	audience?: string;
	allowsMinors?: boolean;
	startsAt?: string | null;
	endsAt?: string | null;
	registrationOpensAt?: string | null;
	registrationClosesAt?: string | null;
	hasPrize?: boolean;
	prizeClaimDeadline?: string | null;
	prizeDescription?: string;
	prizeTotalValuePln?: number | null;
	prizeRegime?: PrizeRegime;
	organiserIsBusiness?: boolean;
	externalReferenceUrl?: string;
	entryLicence?: EntryLicence;
	complaintWindowDays?: number;
	publicationDefault?: PublicationDefault;
	meritCriteria?: string;
	dataControllerName?: string;
	dataControllerContact?: string;
	accommodationContact?: string;
	team?: boolean;
	teamSizeMax?: number | null;
	capacity?: number | null;
	laureateMinPct?: number;
	finalistMinPct?: number;
	distinctionCount?: number;
}

export interface ContestStaffRow {
	id: string;
	user: ContestPerson | null;
	role: ContestStaffRole;
	addedAt: string;
}

export interface ContestStage {
	id: string;
	order: number;
	key: string;
	title: string;
	description: string;
	mode: StageMode;
	event: { id: string; title: string } | null;
	opensAt: string | null;
	closesAt: string | null;
	advancement: Advancement;
	advanceCount: number | null;
	advanceThreshold: number | null;
	status: StageStatus;
	advancedAt: string | null;
	/** Derived from the problems, never stored. */
	maxPoints: number;
	problemCount: number;
	/** Whether a non-staff reader may see WHICH exercises this stage uses. */
	problemsVisible: boolean;
	submissionCount: number;
	advancedCount: number;
}

export interface ContestProblem {
	id: string;
	exercise: { id: string; number: number; branch: string; difficulty: string };
	order: number;
	points: number;
	/** The statement, resolved for the reader's language. There is no `answer` and no solution
	 *  pool in this payload, on purpose — the serializer does not send them. */
	title: string;
	statement: string;
	resolvedLocale: string;
	visibleFrom: string | null;
}

export interface ContestAnswer {
	id: string | null;
	problemId: string;
	text: string;
	attachmentId: string | null;
	updatedAt: string | null;
}

export interface ContestSubmission {
	id: string | null;
	registration: { id: string; number: number; teamName: string; user?: ContestPerson | null };
	status: SubmissionStatus;
	submittedAt: string | null;
	advanced: boolean;
	answers: ContestAnswer[];
	points: number;
	scoredProblems: number;
	updatedAt: string | null;
}

export interface ContestScoreCell {
	problem: string;
	juror: ContestPerson | null;
	points: number;
	note: string;
}

export interface JudgingView {
	stage: ContestStage;
	problems: ContestProblem[];
	submissions: (ContestSubmission & { scores: ContestScoreCell[] })[];
}

export interface ContestResultRow {
	id: string;
	rank: number;
	totalPoints: number;
	maxPoints: number;
	title: ResultTitle;
	/** Initials unless this participant opted in AND the contest's own default allows a full
	 *  name — two separate conditions, both checked server-side. */
	displayName: string;
	registrationNumber: number;
	isMe: boolean;
	publishedAt: string;
}

export interface ResultsPayload {
	publishedAt: string | null;
	complaintsCloseAt: string | null;
	complainBlockReason: ContestBlockReason | null;
	results: ContestResultRow[];
}

export interface RankingRow {
	rank: number;
	registration: string;
	number: number;
	totalPoints: number;
	maxPoints: number;
	stagesEntered: number;
	title: ResultTitle;
}

export interface ContestComplaint {
	id: string;
	registrationNumber: number;
	text: string;
	status: ComplaintStatus;
	answer: string;
	answeredBy: ContestPerson | null;
	answeredAt: string | null;
	createdAt: string;
	isMine: boolean;
}

export interface RulesSectionRow {
	id: string;
	key: string;
	order: number;
	body: string;
	heading: { en: string; pl: string };
	guidance: { en: string; pl: string };
	law: string[];
	required: boolean;
}

export interface RulesPayload {
	version: number;
	sections: RulesSectionRow[];
}

export interface RulesVersionRow {
	id: string;
	number: number;
	publishedAt: string;
	publishedBy: ContestPerson | null;
	snapshot: { key: string; order: number; body: string }[];
}

export type ComplianceState = 'ok' | 'missing' | 'warning';

export interface ComplianceItem {
	key: string;
	state: ComplianceState;
	law: string[];
	/** A KEY, not a sentence — the sentence is the frontend's, in both languages. */
	detail: string;
}

export interface CompliancePayload {
	preset: string;
	items: ComplianceItem[];
	tax: {
		applies: boolean;
		regime?: PrizeRegime;
		valuePln?: number | null;
		thresholdPln?: number;
		aboveThreshold?: boolean;
		grossUpPln?: number | null;
		law?: string[];
	};
	/** Always true. The panel refuses to draw without it. */
	notLegalAdvice: boolean;
}

/** One candidate for a role, with why they are being suggested. `via` entries are
 *  `'<kind>:<title>'` and the sentence is drawn here, not sent by the server. */
export interface SuggestedPerson {
	id: string;
	displayName: string;
	via: string[];
}

export interface CertificatePayload {
	contest: {
		id: string;
		title: string;
		startsAt: string | null;
		endsAt: string | null;
		presetKey: string;
		externalReferenceUrl: string;
	};
	organiser: { displayName: string; kind: OrganiserKind };
	participant: { displayName: string; affiliation: string };
	result: {
		id: string;
		rank: number;
		title: ResultTitle;
		totalPoints: number;
		maxPoints: number;
		publishedAt: string;
	};
}
