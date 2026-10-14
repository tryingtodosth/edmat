// Shared label maps for the two closed-enum Exercise fields (difficulty, source type) — extracted
// once a THIRD component (RandomExerciseButton, after FiltersSidebar and the submit form) needed the
// exact same lists, per this codebase's own "three strikes" convention for when a duplicated pattern
// earns a shared utility.

import type { ExerciseSort } from '$lib/services/exercises';
import type {
	Audience,
	SessionKind,
	SessionLinkRole,
	Difficulty,
	DonationPlatform,
	EventExportKind,
	ExerciseLinkRole,
	FeatureFlagKey,
	BuiltinMaterialType,
	MaterialSort,
	NotificationType,
	ScanDirection,
	SourceType
} from '$lib/types';
import type {
	ChecklistEvidenceKind,
	ChecklistItemStatus,
	ChecklistOwnerRole,
	RoomBookingStatus,
	VenueRole
} from '$lib/types/venue';
// The rota's own four enums, imported on their own line rather than merged into the block above:
// seven conference steps were edited in parallel and a separate line is one fewer merge conflict.
import type {
	AssignmentStatus,
	ClaimBlockReason,
	DropBlockReason,
	StationKind
} from '$lib/types/shift';
// `plans` (MANAGEMENT-BRIEF.md §3.D), its own line for the same reason as the rota's above: six
// management steps were built in parallel and a separate import line is one fewer merge conflict.
import type {
	PlanBlockReason,
	PlanStatus,
	PlanStepStatus,
	PlanSuggestionStatus
} from '$lib/types/plan';

// The management layer's own enums, each step on its own import line for the same reason (six
// branches in parallel, MANAGEMENT-BRIEF.md §4 rule 6).
// `contests` (CONTESTS-BRIEF.md §4 rule 6), on its own line for the same reason — two contest
// branches in parallel. Only the refusal words: the enum labels are step B's.
import type { ContestBlockReason } from '$lib/types/contest';
import type { TaskBlockReason, TaskPriority, TaskStatus } from '$lib/types/task';
import { m } from '$lib/paraglide/messages.js';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

// Mirrors backend config/audience.py — see types/audience.ts.
export const AUDIENCES: Audience[] = [
	'early_years',
	'primary',
	'secondary',
	'university',
	'adult',
	'senior',
	'all'
];
export const AUDIENCE_LABELS: Record<Audience, () => string> = {
	early_years: m.audience_early_years, // "Early years"
	primary: m.audience_primary, // "Primary school"
	secondary: m.audience_secondary, // "Secondary school"
	university: m.audience_university, // "University"
	adult: m.audience_adult, // "Adult learners"
	senior: m.audience_senior, // "Seniors"
	all: m.audience_all // "Everyone"
};

export const DIFFICULTY_LABELS: Record<Difficulty, () => string> = {
	easy: m.difficulty_easy,
	medium: m.difficulty_medium,
	hard: m.difficulty_hard
};

// A hand-maintained mirror of the backend's own `materials.models.CURRENCY_CHOICES` — same "mirror
// a small backend enum, flag the drift risk in both files' own comments" convention
// `DONATION_PLATFORMS`/`SOURCE_TYPES` already establish elsewhere in this file, rather than a
// dedicated read-only endpoint for 4 rarely-changing rows. Currency codes need no per-locale label —
// "PLN"/"EUR"/"USD"/"GBP" read identically in both `en.json`/`pl.json`, so there's no sibling
// `_LABELS` map the way `DIFFICULTY_LABELS`/`SOURCE_TYPE_LABELS` have.
export const MATERIAL_CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP'] as const;

export const SOURCE_TYPES: SourceType[] = ['exercises', 'midterm', 'exam', 'other'];

export const SOURCE_TYPE_LABELS: Record<SourceType, () => string> = {
	exercises: m.sourceType_exercises,
	midterm: m.sourceType_midterm,
	exam: m.sourceType_exam,
	other: m.sourceType_other
};

// Shared between the settings page's own donation-link editor and the public profile's display of
// someone else's — same list, one source, rather than two independently-drifting copies.
export const DONATION_PLATFORMS: DonationPlatform[] = [
	'paypal',
	'payu',
	'blik',
	'card',
	'applePay',
	'googlePay',
	'buyMeACoffee',
	'koFi',
	'patreon',
	'githubSponsors',
	'bankTransfer',
	'other'
];

export const DONATION_PLATFORM_LABELS: Record<DonationPlatform, () => string> = {
	paypal: m.donation_platform_paypal,
	payu: m.donation_platform_payu,
	blik: m.donation_platform_blik,
	card: m.donation_platform_card,
	applePay: m.donation_platform_applePay,
	googlePay: m.donation_platform_googlePay,
	buyMeACoffee: m.donation_platform_buyMeACoffee,
	koFi: m.donation_platform_koFi,
	patreon: m.donation_platform_patreon,
	githubSponsors: m.donation_platform_githubSponsors,
	bankTransfer: m.donation_platform_bankTransfer,
	other: m.donation_platform_other
};

// A plain emoji per platform, not a real icon-font/SVG-sprite dependency — this app has never
// pulled in an icon library (the notification bell/random-dice buttons above already use bare
// emoji too), so a donation link's own platform marker follows the same convention rather than
// introducing a new one just for this.
export const DONATION_PLATFORM_ICONS: Record<DonationPlatform, string> = {
	paypal: '💳',
	payu: '💳',
	blik: '📱',
	card: '💳',
	applePay: '🍎',
	googlePay: '🇬',
	buyMeACoffee: '☕',
	koFi: '☕',
	patreon: '🎁',
	githubSponsors: '💜',
	bankTransfer: '🏦',
	other: '🔗'
};

// Material.type was never actually rendered anywhere in the UI before "expand material types" —
// a real, worthwhile gap to close alongside the expansion itself (an expanded-but-invisible enum
// wouldn't let a visitor tell a script from a practice test at a glance). MaterialCard.svelte is
// the one real consumer today.
// The submit-material form's own type picker needed an iterable list alongside the label map above
// — MATERIAL_TYPE_LABELS only ever had a reader (MaterialCard.svelte's badge), never a `<select>`
// needing every possible value, until this form existed.
export const MATERIAL_TYPES: BuiltinMaterialType[] = [
	'script',
	'examCollection',
	'midtermCollection',
	'exerciseCollection',
	'formulaSheet',
	'lectureSlides',
	'solutionGuide',
	'syllabus',
	'practiceTest',
	'recording',
	'textbookExcerpt',
	'codeDataset',
	'other'
];

// Keyed by the BUILT-IN union, not the open one: these thirteen have curated wording in both
// locales and a proposed type never will. `materialTypesStore.nameFor()` is what resolves a
// label safely for either — indexing this map directly throws for anything not in it.
export const MATERIAL_TYPE_LABELS: Record<BuiltinMaterialType, () => string> = {
	script: m.materialType_script,
	examCollection: m.materialType_examCollection,
	midtermCollection: m.materialType_midtermCollection,
	exerciseCollection: m.materialType_exerciseCollection,
	formulaSheet: m.materialType_formulaSheet,
	lectureSlides: m.materialType_lectureSlides,
	solutionGuide: m.materialType_solutionGuide,
	syllabus: m.materialType_syllabus,
	practiceTest: m.materialType_practiceTest,
	recording: m.materialType_recording,
	textbookExcerpt: m.materialType_textbookExcerpt,
	codeDataset: m.materialType_codeDataset,
	other: m.materialType_other
};

// The overhaul's own `sort=` values (materials/views.py's own `_SORT_KEYS`) — `undefined`/no
// selection deliberately isn't a fifth option here, matching MaterialSort's own doc comment
// (material.ts): "the platform's own curated order" is the absence of a sort choice, not one.
export const MATERIAL_SORTS: MaterialSort[] = ['recent', 'level', 'votes', 'alphabetical'];

export const MATERIAL_SORT_LABELS: Record<MaterialSort, () => string> = {
	recent: m.materialSort_recent,
	level: m.materialSort_level,
	votes: m.materialSort_votes,
	alphabetical: m.materialSort_alphabetical
};

// The three coarse Profile.notify_on_* fields each real NotificationType falls under — mirrors the
// backend's own notifications/services.py `NOTIFICATION_TYPES` catalog (that file's own doc comment
// names this exact frontend list as the one place drift could otherwise creep in, so keep the two
// in sync by hand if a new notification type is ever added). `null` for `newTaggedContent`, which
// has no coarse category at all — its own gating happens per-tag (TagFollow.notify), not here; it
// still gets an entry so the settings UI can offer a SEPARATE, standalone "mute this type
// account-wide" override layered on top of the per-tag choice (Profile.muted_notification_types).
export type NotificationPreferenceCategory =
	| 'notifyOnCommentReply'
	| 'notifyOnModerationDecision'
	| 'notifyOnContentAction'
	| 'notifyOnCourseActivity'
	| 'notifyOnBooking'
	| 'notifyOnEvent'
	| null;

export const NOTIFICATION_TYPE_CATEGORY: Record<NotificationType, NotificationPreferenceCategory> =
	{
		commentReply: 'notifyOnCommentReply',
		submissionApproved: 'notifyOnModerationDecision',
		submissionRejected: 'notifyOnModerationDecision',
		editSuggestionApproved: 'notifyOnModerationDecision',
		editSuggestionRejected: 'notifyOnModerationDecision',
		translationApproved: 'notifyOnModerationDecision',
		translationRejected: 'notifyOnModerationDecision',
		solutionEntryApproved: 'notifyOnModerationDecision',
		solutionEntryRejected: 'notifyOnModerationDecision',
		contentAutoHidden: 'notifyOnContentAction',
		contentRestored: 'notifyOnContentAction',
		contentRemoved: 'notifyOnContentAction',
		newTaggedContent: null,
		// All six share one coarse category — somebody who does not want branch traffic does not want
		// any of it — while the per-type list below still allows peeling off one of them.
		courseEnrollmentRequested: 'notifyOnCourseActivity',
		courseEnrollmentApproved: 'notifyOnCourseActivity',
		courseEnrollmentDeclined: 'notifyOnCourseActivity',
		courseRemoved: 'notifyOnCourseActivity',
		courseNewLesson: 'notifyOnCourseActivity',
		courseNewPost: 'notifyOnCourseActivity',
		// All four share one category, on the branch types' own reasoning. This is the one worth
		// reading the coarse label carefully before switching off: a tutor who mutes it stops hearing
		// that anybody has asked for an hour of their time.
		bookingRequested: 'notifyOnBooking',
		bookingConfirmed: 'notifyOnBooking',
		bookingDeclined: 'notifyOnBooking',
		bookingCancelled: 'notifyOnBooking',
		// Their own category rather than a share of `notifyOnCourseActivity`: a switch labelled
		// "branches" that also governed events would be a setting whose label lies.
		eventAttendance: 'notifyOnEvent',
		eventUpdated: 'notifyOnEvent',
		eventCancelled: 'notifyOnEvent',
		eventPosted: 'notifyOnEvent',
		sessionChanged: 'notifyOnEvent',
		registrationConfirmed: 'notifyOnEvent',
		registrationWaitlisted: 'notifyOnEvent',
		registrationPromoted: 'notifyOnEvent',
		registrationDeclined: 'notifyOnEvent',
		contributionSubmitted: 'notifyOnEvent',
		contributionDecided: 'notifyOnEvent',
		// Under the existing moderation-decision category rather than a new switch: somebody proposed
		// a word and a moderator decided on it, which is the same kind of event as a decision on a
		// submitted exercise.
		courseContributionSubmitted: 'notifyOnCourseActivity',
		courseContributionApproved: 'notifyOnCourseActivity',
		courseContributionRejected: 'notifyOnCourseActivity',
		courseStaffAdded: 'notifyOnCourseActivity',
		courseInviteUsed: 'notifyOnCourseActivity',
		materialSubmissionApproved: 'notifyOnModerationDecision',
		materialSubmissionRejected: 'notifyOnModerationDecision',
		taxonomyApproved: 'notifyOnModerationDecision',
		taxonomyMerged: 'notifyOnModerationDecision',
		taxonomyMoved: 'notifyOnModerationDecision',
		taxonomyRejected: 'notifyOnModerationDecision',
		issueStatusChanged: 'notifyOnModerationDecision',
		// Same category as `issueStatusChanged`, on its own precedent above — this is the same kind
		// of "somebody decided on something I filed" event, just for a DSA legal notice.
		legalNoticeDecided: 'notifyOnModerationDecision',
		// Applying to look after content, and the answer. Both under the moderation-decision switch
		// — the first is somebody asking a moderator to decide, the second is the decision.
		governorApplicationSubmitted: 'notifyOnModerationDecision',
		governorApplicationDecided: 'notifyOnModerationDecision',
		// Co-authoring (coauthoring/). Split exactly as the backend's own `_PREFERENCE_FIELD_FOR_TYPE`
		// splits them, because a preference that disagreed with the field the server actually reads
		// would show a switch that does not do what its row says: the five "something happened on a
		// project of mine" types are content actions, while the two that answer something this person
		// submitted are decisions. No new coarse category — these seven genuinely belong to two that
		// already exist, and a switch per feature is how a settings page becomes unreadable.
		materialVersionProposed: 'notifyOnContentAction',
		materialVersionDecided: 'notifyOnModerationDecision',
		materialVersionPublished: 'notifyOnContentAction',
		projectInviteUsed: 'notifyOnContentAction',
		projectMemberAdded: 'notifyOnContentAction',
		projectJoinRequested: 'notifyOnContentAction',
		projectJoinDecided: 'notifyOnModerationDecision',
		// Concepts (concepts/). Split on the same line co-authoring's are, and for the same reason:
		// "a revision is waiting on an article you look after" and "a page you may have read has
		// changed" are things happening to content, while "your revision was accepted/refused" is a
		// decision about something this person submitted.
		conceptRevisionPending: 'notifyOnContentAction',
		conceptRevisionDecided: 'notifyOnModerationDecision',
		conceptRevisionPublished: 'notifyOnContentAction'
	};

// Short, parameter-free labels for the settings page's own per-type fine-tune list — deliberately
// NOT the same message keys NotificationCard.svelte already uses (those are full sentence templates
// needing an actor/title, e.g. "X approved your submission 'Y'"; a settings toggle just wants a
// plain noun phrase like "Submission approved"). `commentReply` has no entry — it's the sole member
// of its own category, so the existing coarse checkbox already says everything a per-type row would.
/** Notification types whose sentence asks the reader to decide something (accept, decline, review,
 *  approve). NotificationCard draws these with a 3px info rule; decision OUTCOMES (approved,
 *  rejected, decided, published) are deliberately absent — the sentence already says it. A
 *  hand-kept classification (house rule 13): a new request-shaped type must be added here or it
 *  ships without the rule. */
export const NOTIFICATION_NEEDS_ACTION: ReadonlySet<NotificationType> = new Set<NotificationType>([
	'courseEnrollmentRequested',
	'bookingRequested',
	'contributionSubmitted',
	'courseContributionSubmitted',
	'governorApplicationSubmitted',
	'materialVersionProposed',
	'projectJoinRequested',
	'conceptRevisionPending'
]);

export const NOTIFICATION_TYPE_LABELS: Partial<Record<NotificationType, () => string>> = {
	submissionApproved: m.notifPref_submissionApproved,
	submissionRejected: m.notifPref_submissionRejected,
	editSuggestionApproved: m.notifPref_editSuggestionApproved,
	editSuggestionRejected: m.notifPref_editSuggestionRejected,
	translationApproved: m.notifPref_translationApproved,
	translationRejected: m.notifPref_translationRejected,
	solutionEntryApproved: m.notifPref_solutionEntryApproved,
	solutionEntryRejected: m.notifPref_solutionEntryRejected,
	contentAutoHidden: m.notifPref_contentAutoHidden,
	contentRestored: m.notifPref_contentRestored,
	contentRemoved: m.notifPref_contentRemoved,
	newTaggedContent: m.notifPref_newTaggedContent,
	courseEnrollmentRequested: m.notifPref_courseEnrollmentRequested,
	courseEnrollmentApproved: m.notifPref_courseEnrollmentApproved,
	courseEnrollmentDeclined: m.notifPref_courseEnrollmentDeclined,
	courseRemoved: m.notifPref_courseRemoved,
	courseNewLesson: m.notifPref_courseNewLesson,
	courseNewPost: m.notifPref_courseNewPost,
	bookingRequested: m.notifPref_bookingRequested,
	bookingConfirmed: m.notifPref_bookingConfirmed,
	bookingDeclined: m.notifPref_bookingDeclined,
	bookingCancelled: m.notifPref_bookingCancelled,
	eventAttendance: m.notifPref_eventAttendance,
	eventUpdated: m.notifPref_eventUpdated,
	eventCancelled: m.notifPref_eventCancelled,
	eventPosted: m.notifPref_eventPosted,
	sessionChanged: m.notifPref_sessionChanged,
	registrationConfirmed: m.notifPref_registrationConfirmed,
	registrationWaitlisted: m.notifPref_registrationWaitlisted,
	registrationPromoted: m.notifPref_registrationPromoted,
	registrationDeclined: m.notifPref_registrationDeclined,
	contributionSubmitted: m.notifPref_contributionSubmitted,
	contributionDecided: m.notifPref_contributionDecided,
	courseContributionSubmitted: m.notifPref_courseContributionSubmitted,
	courseContributionApproved: m.notifPref_courseContributionApproved,
	courseContributionRejected: m.notifPref_courseContributionRejected,
	courseStaffAdded: m.notifPref_courseStaffAdded,
	courseInviteUsed: m.notifPref_courseInviteUsed,
	materialSubmissionApproved: m.notifPref_materialSubmissionApproved,
	materialSubmissionRejected: m.notifPref_materialSubmissionRejected,
	taxonomyApproved: m.notifPref_taxonomyApproved,
	taxonomyMerged: m.notifPref_taxonomyMerged,
	taxonomyMoved: m.notifPref_taxonomyMoved,
	taxonomyRejected: m.notifPref_taxonomyRejected,
	issueStatusChanged: m.notifPref_issueStatusChanged,
	legalNoticeDecided: m.notifPref_legalNoticeDecided,
	governorApplicationSubmitted: m.notifPref_governorApplicationSubmitted,
	governorApplicationDecided: m.notifPref_governorApplicationDecided,
	materialVersionProposed: m.notifPref_materialVersionProposed,
	materialVersionDecided: m.notifPref_materialVersionDecided,
	materialVersionPublished: m.notifPref_materialVersionPublished,
	projectInviteUsed: m.notifPref_projectInviteUsed,
	projectMemberAdded: m.notifPref_projectMemberAdded,
	projectJoinRequested: m.notifPref_projectJoinRequested,
	projectJoinDecided: m.notifPref_projectJoinDecided,
	conceptRevisionPending: m.notifPref_conceptRevisionPending, // "Concept revision waiting"
	conceptRevisionDecided: m.notifPref_conceptRevisionDecided, // "Concept revision decided"
	conceptRevisionPublished: m.notifPref_conceptRevisionPublished // "New concept revision"
};

// The platform-wide moderator kill switches (backend moderation/models.py's FEATURE_FLAG_CHOICES)
// — mirrored by hand here, same "small, rarely-changing enum, flag the drift risk rather than fetch
// a labels endpoint for it" call this codebase already made for DONATION_PLATFORMS/SOURCE_TYPES.
// The drift risk is not hypothetical: this map and `FeatureFlagKey` (types/featureFlag.ts, which
// says the same thing from its side) have both been left behind by a backend-only flag twice —
// `classroom` after the rename, and `galleries` after migration 0032 seeded it. Add a key in both
// files, in the same change as the backend one.
export const FEATURE_FLAG_LABELS: Record<FeatureFlagKey, () => string> = {
	tutoring: m.featureFlags_label_tutoring,
	courses: m.featureFlags_label_classroom,
	messaging: m.featureFlags_label_messaging,
	exercise_submissions: m.featureFlags_label_exerciseSubmissions,
	material_submissions: m.featureFlags_label_materialSubmissions,
	events: m.featureFlags_label_events,
	issues: m.featureFlags_label_issues,
	posts: m.featureFlags_label_posts,
	chemistry: m.featureFlags_label_chemistry,
	sketches: m.featureFlags_label_sketches, // "Freehand sketches (whiteboard)"
	galleries: m.featureFlags_label_galleries, // "Picture galleries on content"
	age_verification: m.featureFlags_label_ageVerification, // "Age gate on self-registration"
	coauthoring: m.featureFlags_label_coauthoring, // "Co-authoring materials: versions, teams, proposals"
	concepts: m.featureFlags_label_concepts, // "Concepts: wiki articles per audience"
	about_discussions: m.featureFlags_label_aboutDiscussions, // "Discussions under the standing pages and the project board (/about, the manual, tasks, plans, needs, polls)"
	venues: m.featureFlags_label_venues, // "Venues, rooms and checklists"
	event_documents: m.featureFlags_label_eventDocuments, // "Event documents and briefings"
	tickets: m.featureFlags_label_tickets, // "Tickets, QR codes and scanning"
	shifts: m.featureFlags_label_shifts, // "Volunteer rota (shifts)"
	cloakroom: m.featureFlags_label_cloakroom, // "Cloakroom desk"
	role_preview: m.featureFlags_label_rolePreview, // "View an event as a visitor"
	organizations: m.featureFlags_label_organizations, // "Organisations"
	tasks: m.featureFlags_label_tasks, // "Tasks on courses, events and materials"
	needs: m.featureFlags_label_needs, // "Needs board (help wanted)"
	plans: m.featureFlags_label_plans, // "Plans and roadmaps"
	decisions: m.featureFlags_label_decisions, // "Decisions and polls"
	work_dashboard: m.featureFlags_label_workDashboard, // "Personal work dashboard"
	volunteering: m.featureFlags_label_volunteering, // "Volunteering offers"
	school_demo: m.featureFlags_label_schoolDemo, // "School-management demo"
	// The learning cycle (prompts/00-DESIGN.md): mirrors moderation/models.py's three 0047 keys.
	flashcards: m.featureFlags_label_flashcards, // "Flashcards: decks and spaced review"
	learning_record: m.featureFlags_label_learningRecord, // "Learning record on public profiles"
	creation_requires_verification: m.featureFlags_label_creationRequiresVerification, // "Creating courses, events, listings and organisations: verified contributors only"
	// The "AI-assisted" mark (provenance/, 2026-10-08) — mirrors moderation/models.py's 0050 key.
	ai_assisted: m.featureFlags_label_aiAssisted, // "The \"AI-assisted\" mark: author marks and community votes"
	// Goals and their definitions of done (goals/, 2026-10-08) — mirrors moderation/models.py's
	// 0051 key. A key is a THREE-file change and this is the third (root CLAUDE.md).
	goals: m.featureFlags_label_goals, // "Goals and their definitions of done"
	attachments: m.featureFlags_label_attachments, // "Attachments on courses, events, board rows and comments"
	// Contests (contests/, 2026-10-09) — mirrors moderation/models.py's 0053 key; the third file of
	// the three-file change.
	contests: m.featureFlags_label_contests, // "Contests: staged competitions with a jury, results and the obligations a prize brings"
	// Sign in with Google / Apple / Microsoft (sso/, 2026-10-14) — mirrors moderation/models.py's
	// 0054 key; the third file of the three-file change.
	social_login: m.featureFlags_label_socialLogin, // "Sign in with Google, Apple or Microsoft"
	material_uploads_verified_only: m.featureFlags_label_materialUploadsVerifiedOnly
};

// ---- goals (backend `goals/models.py: GOAL_STATUS_CHOICES`) ------------------------------------
import type { GoalStatus } from '$lib/types/goal';
//
// A hand-maintained mirror, said in both files (house rule 13). `met` is in the list because the
// server sends it, NOT because anything here may ask for it: it is derived from the goal's criteria
// (`goals/rules.py: recount`) and a PATCH asking for it comes back 400 with its reason.
export const GOAL_STATUS_LABELS: Record<GoalStatus, () => string> = {
	open: m.goals_status_open, // "Open"
	met: m.goals_status_met, // "Met"
	abandoned: m.goals_status_abandoned // "Abandoned"
};

/** The refusal words `backend/goals/rules.py` answers with, as sentences (house rule 6). */
const GOAL_REFUSAL_LABELS: Record<string, () => string> = {
	not_manager: m.goals_reason_notManager, // "Only the people who run this body, or whoever wrote the goal, can change it."
	not_staff: m.goals_reason_notStaff, // "Only somebody on this body can record a condition as met."
	illegal_transition: m.goals_reason_illegalTransition, // "That move is not available from here."
	other_node: m.goals_reason_otherNode, // "That goal belongs to something else."
	has_work: m.goals_reason_hasWork, // "A task or a plan is work towards this goal, so it is abandoned rather than deleted."
	has_comments: m.goals_reason_hasComments // "People have talked under this goal, so it is abandoned rather than deleted."
};

/** Reads a refusal word off a goal action's `ApiError` — `{detail: '<word>'}` for an action and
 * `{goal: ['<word>']}` for the "serves this goal" link — and returns its sentence. Falls back to
 * the error's own message, the `pollRefusalMessage` shape it is modelled on. */
export function goalRefusalMessage(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.body && typeof err.body === 'object') {
		const body = err.body as Record<string, unknown>;
		const detail = body.detail;
		if (typeof detail === 'string' && detail in GOAL_REFUSAL_LABELS) {
			return GOAL_REFUSAL_LABELS[detail]();
		}
		const field = body.goal;
		if (Array.isArray(field) && typeof field[0] === 'string' && field[0] in GOAL_REFUSAL_LABELS) {
			return GOAL_REFUSAL_LABELS[field[0]]();
		}
	}
	return err instanceof Error ? err.message : fallback;
}

// The concepts app's own closed enums (revision status, block kind, relation, link refusal reason)
// are deliberately NOT mirrored here: they live beside the components that read them, in
// `lib/components/concept/labels.ts`, which names `backend/concepts/models.py`,
// `backend/concepts/blocks.py` and `backend/concepts/access.py` as the things it mirrors
// (house rule 13 — one owner per mirrored enum; two copies is exactly how drift starts). Only the
// flag key above is shared, because the Flags tab renders every key from one map.

/** The label for a flag the API actually returned, which is not necessarily one this build knows
 * about — a backend seeded ahead of the frontend (or simply an older bundle in someone's tab) sends
 * keys that are missing from the map above. Reading it directly is what crashed the whole Flags tab
 * when `galleries` was added backend-side: `FEATURE_FLAG_LABELS[key]()` on a missing key is
 * `undefined()`. Falling back to the raw key keeps every OTHER flag togglable and makes the gap
 * visible as an untranslated row, which is the honest failure — a moderator can still turn the
 * thing off, and the missing label is obvious to whoever sees it. */
export function featureFlagLabel(key: FeatureFlagKey): string {
	return FEATURE_FLAG_LABELS[key]?.() ?? key;
}

// Programme (AUDIENCE-BRIEF.md §3.2) — mirrors events/models.py's SESSION_KIND_CHOICES / LINK_ROLE_CHOICES.
export const SESSION_KIND_LABELS: Record<SessionKind, () => string> = {
	talk: m.events_sessionKind_talk, // "Talk"
	workshop: m.events_sessionKind_workshop, // "Workshop"
	poster: m.events_sessionKind_poster, // "Poster session"
	break: m.events_sessionKind_break, // "Break"
	social: m.events_sessionKind_social, // "Social"
	other: m.events_sessionKind_other // "Other"
};
export const SESSION_LINK_ROLES: SessionLinkRole[] = [
	'prepare',
	'live',
	'homework',
	'slides',
	'recording',
	'solutions',
	'other'
];
export const SESSION_LINK_ROLE_LABELS: Record<SessionLinkRole, () => string> = {
	prepare: m.events_linkRole_prepare, // "Read or try before"
	live: m.events_linkRole_live, // "Worked through in the room"
	homework: m.events_linkRole_homework, // "Afterwards, on your own"
	slides: m.events_linkRole_slides, // "Slides"
	recording: m.events_linkRole_recording, // "Recording"
	solutions: m.events_linkRole_solutions, // "Solutions"
	other: m.events_linkRole_other // "Related"
};

// Exercise sort keys (AUDIENCE-BRIEF.md §4) — mirrors exercises/views.py's EXERCISE_SORT_KEYS.
export const EXERCISE_SORTS: ExerciseSort[] = [
	'number',
	'title',
	'difficulty',
	'rating',
	'reviews',
	'solutions',
	'views',
	'recent'
];
export const EXERCISE_SORT_LABELS: Record<ExerciseSort, () => string> = {
	number: m.sort_number, // "Course number"
	title: m.sort_title, // "Title"
	difficulty: m.sort_difficulty, // "Difficulty"
	rating: m.sort_rating, // "Rating"
	reviews: m.sort_reviews, // "Most reviewed"
	solutions: m.sort_solutions, // "Most solutions"
	views: m.sort_views, // "Most read"
	recent: m.sort_recent // "Newest"
};

// Exercise ↔ material link roles — a hand-maintained mirror of `EXERCISE_LINK_ROLE_CHOICES` in
// backend/exercises/models.py, which names this file back (house rule 13: say so in BOTH files,
// because a mirrored enum is where drift creeps in). Two values, and the difference between them is
// the whole point of the feature: `source` means the exercise is IN that material, `practice` means
// it is not in it at all and practises what it teaches.
export const EXERCISE_LINK_ROLES: ExerciseLinkRole[] = ['source', 'practice'];
export const EXERCISE_LINK_ROLE_LABELS: Record<ExerciseLinkRole, () => string> = {
	source: m.exLink_roleSource, // "In this material"
	practice: m.exLink_rolePractice // "Practises this material"
};

// ---- the cloakroom desk (CONFERENCE-BRIEF.md §3.F) -------------------------------------------
// A hand-maintained mirror of `ITEM_STATUS_CHOICES` and `IDENTITY_KIND_CHOICES` in
// backend/cloakroom/models.py, and of the refusal words `backend/cloakroom/rules.py` returns —
// all three of those name this file back (house rule 13: say so in BOTH files, because a mirrored
// enum is where drift creeps in). Imported from `$lib/types/cloakroom` directly rather than
// through `$lib/types`, so that seven conference branches are not all appending to one barrel file.
import type {
	CloakroomBlockReason,
	CloakroomIdentityKind,
	CloakroomItemStatus,
	CloakroomReturnResult
} from '$lib/types/cloakroom';

export const CLOAKROOM_ITEM_STATUSES: CloakroomItemStatus[] = [
	'stored',
	'returned',
	'returned_by_exception',
	'unclaimed'
];
export const CLOAKROOM_ITEM_STATUS_LABELS: Record<CloakroomItemStatus, () => string> = {
	stored: m.cloakroom_status_stored, // "On the rack"
	returned: m.cloakroom_status_returned, // "Handed back"
	returned_by_exception: m.cloakroom_status_returnedByException, // "Handed back without a ticket"
	unclaimed: m.cloakroom_status_unclaimed // "Left unclaimed"
};

// `none` is deliberately offered nowhere in the exception dialog — it is the value every ordinary
// item carries, and an illegal answer when somebody is being handed a coat without a ticket
// (`cloakroom/rules.py: exception_block_reason`). The label exists because the rack grid and the
// CSV still render the field.
export const CLOAKROOM_IDENTITY_KINDS: CloakroomIdentityKind[] = [
	'student_card',
	'id_document',
	'account'
];
export const CLOAKROOM_IDENTITY_KIND_LABELS: Record<CloakroomIdentityKind, () => string> = {
	none: m.cloakroom_identity_none, // "Nothing shown"
	student_card: m.cloakroom_identity_studentCard, // "Student card"
	id_document: m.cloakroom_identity_idDocument, // "Identity document"
	account: m.cloakroom_identity_account // "Signed-in EdMat account"
};

// House rule 6, spelled out: every refusal this desk can produce has its own sentence, because
// "no" tells the person at the counter nothing.
export const CLOAKROOM_BLOCK_REASON_LABELS: Record<CloakroomBlockReason, () => string> = {
	not_staff: m.cloakroom_reason_notStaff, // "You are not on this event's staff."
	desk_closed: m.cloakroom_reason_deskClosed, // "This desk is closed."
	rack_taken: m.cloakroom_reason_rackTaken, // "That rack already has something on it."
	unknown_rack: m.cloakroom_reason_unknownRack, // "This desk has no such rack."
	description_required: m.cloakroom_reason_descriptionRequired, // "Write down what the item looks like."
	identity_required: m.cloakroom_reason_identityRequired, // "Say what kind of identity you were shown."
	not_stored: m.cloakroom_reason_notStored, // "That item is not on the rack any more."
	has_items: m.cloakroom_reason_hasItems // "A desk that has taken a coat cannot be deleted."
};

// The four verdicts of a return, in the words a clerk says out loud. `returned` takes the rack as
// a parameter — "hand over what is on hook 12" is the whole answer.
export const CLOAKROOM_RETURN_RESULT_LABELS: Record<
	Exclude<CloakroomReturnResult, 'returned'>,
	() => string
> = {
	unknown_token: m.cloakroom_resultUnknownToken, // "No coat at this desk carries that number."
	already_returned: m.cloakroom_resultAlreadyReturned, // "That coat has already gone home."
	blacklisted: m.cloakroom_resultBlacklisted, // "That ticket was cancelled — the coat was handed back without it."
	desk_closed: m.cloakroom_resultDeskClosed // "The desk is closed."
};

// ---- venues, rooms, bookings and checklists (conference step A) ---------------------------------
// A hand-maintained mirror of the `_CHOICES` lists in **backend/venues/models.py**, which names this
// file back (house rule 13: say so in BOTH files, because a mirrored enum is where drift creeps in).
// The types themselves live in `types/venue.ts`.

export const VENUE_ROLES: VenueRole[] = ['administrator', 'porter'];
export const VENUE_ROLE_LABELS: Record<VenueRole, () => string> = {
	administrator: m.venues_role_administrator, // "Administrator"
	porter: m.venues_role_porter // "Porter"
};

export const ROOM_BOOKING_STATUS_LABELS: Record<RoomBookingStatus, () => string> = {
	requested: m.venues_status_requested, // "Waiting for the building"
	approved: m.venues_status_approved, // "Approved"
	rejected: m.venues_status_rejected, // "Refused"
	cancelled: m.venues_status_cancelled // "Withdrawn"
};

export const CHECKLIST_STATUSES: ChecklistItemStatus[] = [
	'pending',
	'in_progress',
	'done',
	'not_applicable'
];
export const CHECKLIST_STATUS_LABELS: Record<ChecklistItemStatus, () => string> = {
	pending: m.checklist_status_pending, // "Not started"
	in_progress: m.checklist_status_in_progress, // "Being done"
	done: m.checklist_status_done, // "Done"
	not_applicable: m.checklist_status_not_applicable // "Does not apply"
};

export const CHECKLIST_OWNER_LABELS: Record<ChecklistOwnerRole, () => string> = {
	organiser: m.checklist_owner_organiser, // "Yours"
	venue: m.checklist_owner_venue // "The building's"
};

export const CHECKLIST_EVIDENCE_LABELS: Record<ChecklistEvidenceKind, () => string> = {
	none: m.checklist_evidence_none, // "Nothing to attach"
	text: m.checklist_evidence_text, // "A short note"
	link: m.checklist_evidence_link, // "A link"
	file: m.checklist_evidence_file // "A file"
};

// Every refusal word `venues/access.py` and `venues/views.py` can hand back, each with its own
// sentence (house rule 6). A word with no entry falls through to a generic line at the call site
// rather than rendering `undefined` — the same safety net `FEATURE_FLAG_LABELS` grew after a
// missing key took a whole tab down.
export const VENUE_BLOCK_LABELS: Record<string, () => string> = {
	bad_times: m.venues_block_bad_times, // "A booking has to end after it starts."
	room_closed: m.venues_block_room_closed, // "That room is not taking bookings."
	over_fire_capacity: m.venues_block_over_fire_capacity, // "More people than the room's fire safety instruction allows…"
	room_busy: m.venues_block_room_busy, // "That room is already booked for part of this time."
	already_decided: m.venues_block_already_decided, // "Somebody has already answered this request."
	not_allowed: m.venues_block_not_allowed, // "You are not allowed to do that here."
	last_administrator: m.venues_block_last_administrator, // "A building cannot be left without an administrator…"
	already_started: m.venues_block_already_started, // "This event already has a checklist from that building."
	venue_required: m.venues_block_venue_required, // "Choose which building this checklist is for."
	no_such_template: m.venues_block_no_such_template, // "That checklist no longer exists."
	na_not_allowed: m.checklist_block_na_not_allowed, // "The building does not allow this item to be waved away."
	na_reason_required: m.checklist_block_na_reason_required, // "Say why this does not apply."
	needs_venue_signoff: m.checklist_block_needs_venue_signoff, // "Only the building can mark this one done…"
	no_signoff_needed: m.checklist_block_no_signoff_needed, // "This item does not need the building's signature."
	checklist_pending: m.checklist_block_checklist_pending // "A required checklist item has not been started…"
};

// Event-document visibility tiers — a hand-maintained mirror of `VISIBILITY_CHOICES` in
// backend/documents/models.py and of `DocumentTier` in `lib/types/document.ts`, both of which name
// this file back (house rule 13: say so in every file a mirrored enum lives in, because that is
// where drift creeps in). The order is the LADDER — `public ⊂ attendees ⊂ staff ⊂ organisers` —
// with `venue` last and deliberately off it: the building's administrators are neither above nor
// below an organiser. The inline `import(...)` type is what keeps this map honest without adding a
// line to this file's import block (CONFERENCE-BRIEF.md §4 rule 5 asks each parallel step to touch
// the END of this file only): `Record` refuses to compile if a tier is added there and not here.
export const DOCUMENT_TIERS: import('$lib/types/document').DocumentTier[] = [
	'public',
	'attendees',
	'staff',
	'organisers',
	'venue'
];
/** The attachment ladder (backend `attachments/models.py: VISIBILITY_CHOICES`, 2026-10-08). A
 *  hand-maintained mirror of a backend enum, which is what this whole file is and what the root
 *  CLAUDE.md's house rule 13 asks to be said out loud in BOTH files — the backend's own module
 *  docstring names this one. `venue` is off the ladder on purpose: a building's administrators are
 *  neither above nor below an organiser. */
export const ATTACHMENT_TIER_LABELS: Record<
	import('$lib/types/attachment').AttachmentTier,
	() => string
> = {
	public: m.attachments_tier_public, // "Anybody who can see this page"
	members: m.attachments_tier_members, // "People in the room"
	staff: m.attachments_tier_staff, // "The people running it"
	managers: m.attachments_tier_managers, // "Whoever may manage it"
	venue: m.attachments_tier_venue // "The building's administrators"
};

export const DOCUMENT_TIER_LABELS: Record<
	import('$lib/types/document').DocumentTier,
	() => string
> = {
	public: m.documents_tier_public, // "Everybody"
	attendees: m.documents_tier_attendees, // "People going"
	staff: m.documents_tier_staff, // "Event staff"
	organisers: m.documents_tier_organisers, // "Organisers"
	venue: m.documents_tier_venue // "The venue"
};

// Event export kinds — a hand-maintained mirror of `EXPORT_KIND_CHOICES` in
// backend/events/models.py, which names this file back (house rule 13). Two values, and the
// difference between them is the whole of `backend/events/exports.py`: `full_csv` names people and
// carries their answers, `door_list` is a name, a status and a tick.
export const EVENT_EXPORT_KIND_LABELS: Record<EventExportKind, () => string> = {
	full_csv: m.exports_kind_fullCsv, // "Full registration CSV"
	door_list: m.exports_kind_doorList // "Door list"
};

// ---------------------------------------------------------------------------------------------
// The volunteer rota — a hand-maintained mirror of `backend/shifts/models.py` (station kinds,
// assignment statuses) and `backend/shifts/rules.py` (`HARD_REASONS` + `SOFT_REASONS`, and the
// drop reasons). Both of those modules name this file back, per house rule 13: a mirrored enum is
// exactly where drift creeps in, and a missing key here is a blank where a refusal should be.
export const STATION_KIND_LABELS: Record<StationKind, () => string> = {
	door: m.shifts_kind_door, // "Door"
	room: m.shifts_kind_room, // "Session room"
	info: m.shifts_kind_info, // "Information desk"
	cloakroom: m.shifts_kind_cloakroom, // "Cloakroom"
	runner: m.shifts_kind_runner, // "Runner"
	setup: m.shifts_kind_setup, // "Set-up and tear-down"
	other: m.shifts_kind_other // "Other"
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, () => string> = {
	offered: m.shifts_status_offered, // "Offered"
	claimed: m.shifts_status_claimed, // "Waiting to be confirmed"
	confirmed: m.shifts_status_confirmed, // "Confirmed"
	dropped: m.shifts_status_dropped, // "Given back"
	no_show: m.shifts_status_noShow, // "Did not turn up"
	done: m.shifts_status_done // "Done"
};

// Why a Claim button is disabled — or, for the last two, what the claim will become rather than a
// refusal at all.
export const CLAIM_BLOCK_REASON_LABELS: Record<ClaimBlockReason, () => string> = {
	sign_in: m.shifts_reason_signIn, // "Sign in to take a shift."
	event_over: m.shifts_reason_eventOver, // "This event is over."
	not_volunteer: m.shifts_reason_notVolunteer, // "The organiser has to put you on the event as a volunteer first."
	organiser_assigns: m.shifts_reason_organiserAssigns, // "You run this event — put yourself on a shift with Assign, below."
	minor_no_consent: m.shifts_reason_minorNoConsent, // "The organiser has to record a guardian's consent first."
	already_assigned: m.shifts_reason_alreadyAssigned, // "You are already on this shift."
	shift_full: m.shifts_reason_shiftFull, // "This shift is full."
	overlap: m.shifts_reason_overlap, // "You are already somewhere else at that time."
	too_close: m.shifts_reason_tooClose, // "Too close to another of your shifts — 15 minutes between them."
	minor_station: m.shifts_reason_minorStation, // "This station is not open to under-16s."
	minor_night: m.shifts_reason_minorNight, // "Under-16s cannot be rostered between 22:00 and 06:00."
	minor_daily_cap: m.shifts_reason_minorDailyCap, // "That would be more than 7 hours in one day."
	needs_adult: m.shifts_reason_needsAdult, // "You can take it, but it waits until an adult is on the same shift."
	needs_confirmation: m.shifts_reason_needsConfirmation // "You can take it, but the organiser confirms it."
};

export const DROP_BLOCK_REASON_LABELS: Record<DropBlockReason, () => string> = {
	sign_in: m.shifts_reason_signIn, // "Sign in to take a shift."
	not_yours: m.shifts_dropReason_notYours, // "That shift is not yours."
	not_active: m.shifts_dropReason_notActive, // "That shift has already been decided."
	cutoff: m.shifts_dropReason_cutoff // "Less than four hours to go — tell the organiser instead."
};

// Tickets and scanning — a hand-maintained mirror of `SCAN_RESULT_CHOICES` in
// backend/events/models.py, which names this file back (house rule 13: say so in BOTH files).
//
// Two functions rather than one map, because the door's vocabulary has one word for "nothing
// changed" (`already_in`) and a person at the door needs two different sentences for it: entering
// when you are already inside, and leaving when you never came in. `scanning.py`'s module docstring
// records that choice; this is its other half.
export function scanResultLabel(result: string, direction: ScanDirection): () => string {
	if (result === 'already_in') {
		return direction === 'exit' ? m.tickets_result_already_out : m.tickets_result_already_in;
	}
	const map: Record<string, () => string> = {
		admitted: m.tickets_result_admitted, // "Come in"
		not_going: m.tickets_result_not_going, // "Not on the going list"
		unknown: m.tickets_result_unknown, // "No such ticket for this event"
		exited: m.tickets_result_exited, // "Recorded as leaving"
		collision: m.tickets_result_collision // "This ticket has already come in — it may have been passed back"
	};
	return map[result] ?? m.tickets_result_unknown; // "No such ticket for this event"
}

/** Green, amber or red — the only thing a volunteer reads from two metres away. */
export function scanResultTone(result: string): 'ok' | 'warn' | 'bad' {
	if (result === 'admitted' || result === 'exited') return 'ok';
	if (result === 'already_in') return 'warn';
	return 'bad';
}

/** Why there is no ticket yet. The backend answers 409 with the attendance status itself
 *  (`ticket_views.my_ticket`), so the reasons ARE the registration states — a refusal that carries
 *  its reason (house rule 6) is only worth carrying if the frontend has a line for each one. */
export const TICKET_BLOCK_REASONS: Record<string, () => string> = {
	pending: m.tickets_blocked_pending, // "The organiser has not confirmed your place yet."
	waitlisted: m.tickets_blocked_waitlisted, // "You are on the waiting list. A ticket appears when a seat is offered."
	expired: m.tickets_blocked_expired, // "Your seat offer expired and the seat went to the next person."
	not_going: m.tickets_blocked_notGoing, // "You said you are not coming to this."
	not_registered: m.tickets_blocked_notRegistered, // "You have not registered for this event."
	not_yours: m.tickets_blocked_notYours // "This is somebody else's ticket."
};

// `plans` — a hand-maintained mirror of `PLAN_STATUS_CHOICES`/`STEP_STATUS_CHOICES`/
// `SUGGESTION_STATUS_CHOICES` in backend/plans/models.py, which names this file back
// (house rule 13: say so in both files).

export const PLAN_STATUS_LABELS: Record<PlanStatus, () => string> = {
	draft: m.plans_status_draft, // "Draft"
	active: m.plans_status_active, // "Active"
	completed: m.plans_status_completed, // "Completed"
	archived: m.plans_status_archived // "Archived"
};

export const PLAN_STEP_STATUS_LABELS: Record<PlanStepStatus, () => string> = {
	pending: m.plans_stepStatus_pending, // "Pending"
	in_progress: m.plans_stepStatus_inProgress, // "In progress"
	done: m.plans_stepStatus_done, // "Done"
	skipped: m.plans_stepStatus_skipped // "Skipped"
};

export const PLAN_SUGGESTION_STATUS_LABELS: Record<PlanSuggestionStatus, () => string> = {
	pending: m.plans_suggestionStatus_pending, // "Pending"
	accepted: m.plans_suggestionStatus_accepted, // "Accepted"
	rejected: m.plans_suggestionStatus_rejected, // "Rejected"
	withdrawn: m.plans_suggestionStatus_withdrawn // "Withdrawn"
};

// `plans/rules.py`'s refusal words — one sentence each (house rule 6).
export const PLAN_BLOCK_REASON_LABELS: Record<PlanBlockReason, () => string> = {
	not_editor: m.plans_reason_notEditor, // "Only this plan's editors can do that."
	not_active: m.plans_reason_notActive, // "This plan is not active."
	minor: m.plans_reason_minor, // "Under-16 accounts cannot suggest here — it's treated as messaging a stranger."
	own_plan: m.plans_reason_ownPlan, // "You edit this plan directly — add a step instead of suggesting one."
	steps_pending: m.plans_reason_stepsPending, // "Every step must be done or skipped before this plan can be marked complete."
	already_decided: m.plans_reason_alreadyDecided, // "This has already been decided."
	illegal_transition: m.plans_reason_illegalTransition, // "That change isn't allowed from here."
	nested: m.plans_reason_nested, // "A step can only be nested one level deep."
	not_draft: m.plans_reason_notDraft, // "Only a draft plan can be deleted — archive it instead."
	not_own_suggestion: m.plans_reason_notOwnSuggestion // "This is somebody else's suggestion."
};

// ---- needs: help wanted (MANAGEMENT-BRIEF.md §3.C) --------------------------------------------
// A hand-maintained mirror of `NEED_KIND_CHOICES`, `NEED_STATUS_CHOICES`, `SKILL_LEVEL_CHOICES` and
// `APPLICATION_STATUS_CHOICES` in backend/needs/models.py, and of the refusal words
// backend/needs/rules.py returns — all of those name this file back (house rule 13: say so in BOTH
// files). Imported from `$lib/types/need` directly, the same reason the cloakroom section above
// does: six management branches are not all appending to one barrel file.
import type {
	ApplyBlockReason,
	DecideBlockReason,
	NeedApplicationStatus,
	NeedKind,
	NeedStatus,
	OfferStatus,
	SkillLevel
} from '$lib/types/need';

export const NEED_KINDS: NeedKind[] = ['help', 'expertise', 'equipment', 'venue', 'other'];
export const NEED_KIND_LABELS: Record<NeedKind, () => string> = {
	help: m.needs_kind_help, // "General help"
	expertise: m.needs_kind_expertise, // "Expertise"
	equipment: m.needs_kind_equipment, // "Equipment"
	venue: m.needs_kind_venue, // "Venue"
	other: m.needs_kind_other // "Other"
};

export const NEED_STATUS_LABELS: Record<NeedStatus, () => string> = {
	open: m.needs_status_open, // "Open"
	in_progress: m.needs_status_inProgress, // "In progress"
	fulfilled: m.needs_status_fulfilled, // "Fulfilled"
	cancelled: m.needs_status_cancelled // "Cancelled"
};

// The supply side's own lifecycle (backend `needs.OFFER_STATUS_CHOICES`, 2026-10-01) — one field,
// never a pair of booleans, and mirrored here the way every backend enum in this file is: say so
// in both places, because this is where drift creeps in.
export const OFFER_STATUSES: OfferStatus[] = ['open', 'paused', 'closed'];
export const OFFER_STATUS_LABELS: Record<OfferStatus, () => string> = {
	open: m.offers_status_open, // "Open to being asked"
	paused: m.offers_status_paused, // "Paused"
	closed: m.offers_status_closed // "Closed"
};

export const SKILL_LEVELS: SkillLevel[] = ['none', 'beginner', 'intermediate', 'advanced'];
export const SKILL_LEVEL_LABELS: Record<SkillLevel, () => string> = {
	none: m.needs_skill_none, // "No particular skill needed"
	beginner: m.needs_skill_beginner, // "Beginner"
	intermediate: m.needs_skill_intermediate, // "Intermediate"
	advanced: m.needs_skill_advanced // "Advanced"
};

export const NEED_APPLICATION_STATUS_LABELS: Record<NeedApplicationStatus, () => string> = {
	pending: m.needs_appStatus_pending, // "Pending"
	accepted: m.needs_appStatus_accepted, // "Accepted"
	declined: m.needs_appStatus_declined, // "Declined"
	withdrawn: m.needs_appStatus_withdrawn // "Withdrawn"
};

// `needs/rules.py: apply_block_reason` — five words, five sentences (house rule 6).
export const APPLY_BLOCK_REASON_LABELS: Record<ApplyBlockReason, () => string> = {
	not_open: m.needs_applyReason_notOpen, // "This posting is not open any more."
	own_node: m.needs_applyReason_ownNode, // "You already run this — post the need, don't apply to it."
	minor: m.needs_applyReason_minor, // "You need to be 16 or older to apply."
	already_applied: m.needs_applyReason_alreadyApplied, // "You already applied to this."
	full: m.needs_applyReason_full // "Enough people have already been accepted."
};

// `needs/rules.py: decide_block_reason`, and reused by a too-late withdraw.
export const DECIDE_BLOCK_REASON_LABELS: Record<DecideBlockReason, () => string> = {
	already_decided: m.needs_decideReason_alreadyDecided // "This was already decided."
};

// ---------------------------------------------------------------------------------------------
// Tasks (management step B) — a hand-maintained mirror of `STATUS_CHOICES`, `PRIORITY_CHOICES` and
// the refusal words in `backend/tasks/models.py` + `backend/tasks/rules.py`, both of which name
// this file back (house rule 13: say it in BOTH files). Adding a status, a priority or a refusal
// word there means adding a line here in the same change.

export const TASK_STATUS_LABELS: Record<TaskStatus, () => string> = {
	todo: m.tasks_status_todo, // "To do"
	in_progress: m.tasks_status_inProgress, // "In progress"
	review: m.tasks_status_review, // "In review"
	done: m.tasks_status_done, // "Done"
	cancelled: m.tasks_status_cancelled // "Cancelled"
};

/** The button that MOVES a task into a status reads differently from the status itself: "Mark
 *  done" is an instruction, "Done" is a state, and a button labelled with a state reads as a
 *  filter. Two maps rather than one, for that reason alone. */
export const TASK_MOVE_LABELS: Record<TaskStatus, () => string> = {
	todo: m.tasks_move_todo, // "Reopen"
	in_progress: m.tasks_move_inProgress, // "Start"
	review: m.tasks_move_review, // "Send to review"
	done: m.tasks_move_done, // "Mark done"
	cancelled: m.tasks_move_cancelled // "Cancel it"
};

export const TASK_PRIORITIES: TaskPriority[] = [1, 2, 3, 4];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, () => string> = {
	1: m.tasks_priority_1, // "Urgent"
	2: m.tasks_priority_2, // "High"
	3: m.tasks_priority_3, // "Normal"
	4: m.tasks_priority_4 // "Low"
};

/** A refusal carries its reason (house rule 6), and a reason is only worth carrying if there is a
 *  sentence for each one. */
export const TASK_BLOCK_REASON_LABELS: Record<TaskBlockReason, () => string> = {
	not_manager: m.tasks_reason_notManager, // "Only somebody who runs this can do that."
	not_staff: m.tasks_reason_notStaff, // "That person is not on this team."
	not_allowed: m.tasks_reason_notAllowed, // "This is not yours to change."
	already_assigned: m.tasks_reason_alreadyAssigned, // "They are already on this task."
	not_assigned: m.tasks_reason_notAssigned, // "They are not on this task."
	nested: m.tasks_reason_nested, // "A step cannot have steps of its own."
	has_subtasks: m.tasks_reason_hasSubtasks, // "Remove its steps first."
	illegal_transition: m.tasks_reason_illegalTransition // "That is not the next step from here — reload and try again."
};

// ---- Organisations (management step A, MANAGEMENT-BRIEF.md §3.A) ---------------------------------
//
// A hand-maintained mirror of `ORGANIZATION_KIND_CHOICES`, `ORGANIZATION_ROLE_CHOICES` and
// `LINK_KIND_CHOICES` in **backend/organizations/models.py**, which names this file back — house
// rule 13's "say so in BOTH files", because a value added on one side and not the other is exactly
// how a filter starts showing a blank option.

export const ORGANIZATION_KIND_LABELS: Record<string, () => string> = {
	university: m.orgs_kind_university, // "University"
	faculty: m.orgs_kind_faculty, // "Faculty or institute"
	school: m.orgs_kind_school, // "School"
	student_circle: m.orgs_kind_studentCircle, // "Student circle"
	ngo: m.orgs_kind_ngo, // "Non-governmental organisation"
	company: m.orgs_kind_company, // "Company"
	other: m.orgs_kind_other // "Other"
};

export const ORGANIZATION_ROLE_LABELS: Record<string, () => string> = {
	owner: m.orgs_role_owner, // "Owner"
	admin: m.orgs_role_admin, // "Administrator"
	member: m.orgs_role_member // "Member"
};

export const ORGANIZATION_LINK_KIND_LABELS: Record<string, () => string> = {
	runs: m.orgs_linkKind_runs, // "Runs"
	supports: m.orgs_linkKind_supports // "Supports"
};

/** The management node kinds (`config/nodes.py`'s `NODE_KINDS`), for the "link something" picker and
 *  for a link's own row. Kept here rather than in `types/node.ts` for the reason this whole file
 *  exists: a label is a message, and a type is not. */
export const NODE_KIND_LABELS: Record<string, () => string> = {
	course: m.orgs_node_course, // "Course"
	event: m.orgs_node_event, // "Event"
	material: m.orgs_node_material, // "Material"
	organization: m.orgs_node_organization // "Organisation"
};

/** Why the API said no. Every word `backend/organizations/access.py` can answer with has a sentence
 *  here — a refusal that carries its reason (house rule 6) is only worth carrying if the frontend
 *  has a line for each one. */
export const ORGANIZATION_BLOCK_LABELS: Record<string, () => string> = {
	minor: m.orgs_blocked_minor, // "You have to be 16 or over to found an organisation."
	last_owner: m.orgs_blocked_lastOwner, // "An organisation needs at least one owner. Make somebody else an owner first."
	not_org_manager: m.orgs_blocked_notOrgManager, // "You do not run this organisation."
	not_org_owner: m.orgs_blocked_notOrgOwner, // "Only an owner can do this."
	not_node_manager: m.orgs_blocked_notNodeManager, // "You do not run the thing you are linking, and both sides have to agree."
	not_linkable: m.orgs_blocked_notLinkable, // "Only a course, an event or a material can be linked."
	already_linked: m.orgs_blocked_alreadyLinked, // "This is already linked to this organisation."
	already_member: m.orgs_blocked_alreadyMember, // "This person is already on the roster."
	no_such_user: m.orgs_blocked_noSuchUser // "There is no account with that id."
};

/** The one lookup every organisation surface uses, so that an unknown word is still a sentence
 *  rather than a raw token on the screen. */
export function organizationBlockLabel(reason: string): string {
	return (ORGANIZATION_BLOCK_LABELS[reason] ?? m.orgs_blocked_generic)(); // "That did not work."
}

// work — personal work dashboard (backend/work/builtin.py mirrors this, house rule 13)
export const WORK_KIND_LABELS: Record<string, () => string> = {
	task: m.work_kind_task, // "Task"
	need_application: m.work_kind_needApplication, // "Help wanted application"
	need_decision: m.work_kind_needDecision, // "Help wanted decision"
	plan_step: m.work_kind_planStep, // "Plan step"
	plan_suggestion: m.work_kind_planSuggestion, // "Plan suggestion"
	poll: m.work_kind_poll, // "Poll"
	event: m.work_kind_event, // "Event"
	course_request: m.work_kind_courseRequest, // "Course request"
	proposal: m.work_kind_proposal, // "Material proposal"
	shift: m.work_kind_shift, // "Shift"
	booking: m.work_kind_booking // "Tutoring booking"
};

export function workKindLabel(kind: string): () => string {
	return WORK_KIND_LABELS[kind] ?? (() => kind);
}

// Poll enums — a hand-maintained mirror of `decisions/models.py` and the refusal words
// `decisions/rules.py` returns (house rule 13: say so in both files). The enum TYPES themselves
// live in `$lib/types/poll.ts` and are imported, not redefined, here — only the label maps live
// in this file, the same split every other app in this file uses.
import { ApiError } from '$lib/api/client';
import type { PollEligibility, PollMode, PollRefusalReason, PollStatus } from '$lib/types/poll';

export const POLL_MODES: Record<PollMode, () => string> = {
	single: m.polls_mode_single, // "Single choice"
	multiple: m.polls_mode_multiple // "Multiple choices"
};

export const POLL_STATUSES: Record<PollStatus, () => string> = {
	draft: m.polls_status_draft, // "Draft"
	open: m.polls_status_open, // "Open"
	closed: m.polls_status_closed // "Closed"
};

export const POLL_ELIGIBILITIES: Record<PollEligibility, () => string> = {
	staff: m.polls_eligibility_staff, // "Staff only"
	members: m.polls_eligibility_members // "Members (staff and enrolled)"
};

// House rule 6, spelled out: every refusal a poll action can answer with has its own sentence.
// `not_draft` is left out — the frontend never PATCHes or DELETEs a poll (MANAGEMENT-BRIEF.md
// §3.E's frontend list has no edit/delete form), so no UI ever surfaces that word.
export const POLL_REFUSAL_LABELS: Record<PollRefusalReason, () => string> = {
	not_open: m.polls_reason_notOpen, // "This poll is not open for voting."
	not_eligible: m.polls_reason_notEligible, // "You are not eligible to vote in this poll."
	already_voted: m.polls_reason_alreadyVoted, // "You have already voted in this poll."
	too_many_choices: m.polls_reason_tooManyChoices, // "This is a single-choice poll — pick only one option."
	unknown_option: m.polls_reason_unknownOption, // "Pick an option before voting."
	no_options: m.polls_reason_noOptions, // "Add at least two options before opening this poll."
	already_open: m.polls_reason_alreadyOpen, // "This poll is already open."
	already_closed: m.polls_reason_alreadyClosed // "This poll is already closed."
};

/** Reads a refusal word off a poll action's `ApiError` (`{detail: '<word>'}`) and returns its
 * sentence; falls back to the error's own message (or `fallback`) for anything this map does not
 * recognise, so a future refusal word still shows something rather than throwing. Shared between
 * `PollsPanel` and `/polls/[id]` — both once carried their own copy of this exact check. */
export function pollRefusalMessage(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.body && typeof err.body === 'object') {
		const detail = (err.body as Record<string, unknown>).detail;
		if (typeof detail === 'string' && detail in POLL_REFUSAL_LABELS) {
			return POLL_REFUSAL_LABELS[detail as PollRefusalReason]();
		}
	}
	return err instanceof Error ? err.message : fallback;
}

/** Poll turnout text, shared between the panel and `/polls/[id]` — both render the same
 * `eligible_count`/`ballots` pair `decisions/rules.py: eligible_count` answers. */
export function pollTurnout(ballots: number, eligible: number): string {
	return m.polls_turnout({ ballots, eligible }); // "{ballots} of {eligible} voted"
}

// ---- the creation gate (learning step F) -------------------------------------------------------
//
// A hand-maintained mirror of the three refusal words `backend/config/creation.py:
// creation_block_reason` answers with, plus one sentence per kind for the hub that no longer draws
// its create button. House rule 13: `CREATION_KINDS` in that module names both this file and
// `lib/types/creation.ts`, so neither half of the mirror is a surprise to the other.
//
// Two maps rather than one, because they answer two different questions. `GATE_REASON_LABELS` says
// what is true of the PERSON ("you have to be 16") and is the same wherever it is drawn.
// `GATE_HUB_SENTENCES` says what is true of the THING, in the words of the page it is on ("new
// courses are started by verified contributors") — a reader on `/organizations` should not be told
// about courses, and one generic sentence would have to be vague enough to be about neither.
import type { CreationKind } from '$lib/types/creation';

export const GATE_REASON_LABELS: Record<string, () => string> = {
	anonymous: m.gate_reason_anonymous, // "Sign in to start something new here."
	minor: m.gate_reason_minor, // "You have to be 16 or over to start something new here."
	verification_required: m.gate_reason_verificationRequired // "Until the university sign-in exists, starting something new is for verified contributors. Ask a moderator."
};

/** A refusal word → its sentence. Falls back to the generic error line, the same way
 *  `REFUSAL[...]?.() ?? m.common_error_generic()` already does on the course page: a word this
 *  build has never heard of still gets something readable rather than a blank line. */
export function gateReasonLabel(reason: string): string {
	return (GATE_REASON_LABELS[reason] ?? m.common_error_generic)(); // "Something went wrong."
}

export const GATE_HUB_SENTENCES: Record<CreationKind, () => string> = {
	course: m.gate_hub_course, // "Until the university sign-in exists, new courses are started by verified contributors. Ask a moderator."
	event: m.gate_hub_event, // "Until the university sign-in exists, new events are hosted by verified contributors. Ask a moderator."
	service: m.gate_hub_service, // "Until the university sign-in exists, new tutoring listings are posted by verified contributors. Ask a moderator."
	organization: m.gate_hub_organization, // "Until the university sign-in exists, new organisations are founded by verified contributors. Ask a moderator."
	contest: m.gate_hub_contest // "Until the university sign-in exists, new contests are organised by verified contributors. Ask a moderator."
};

/** The sentence for one kind. The map above is typed `Record<CreationKind, …>`, so a fifth kind
 *  added to the mirror in `lib/types/creation.ts` is a type error here rather than a blank line on
 *  somebody's hub. */
export function gateHubSentence(kind: CreationKind): string {
	return GATE_HUB_SENTENCES[kind]();
}

import type { CompletionBlockReason } from '$lib/types/course';

// Course completion certificates — mirrors `backend/courses/rules.py`'s refusal words
// (`completion_block_reason`, `revoke_block_reason`), which names this file back (house rule 13).
// House rule 6 from the client's side: every word the server can answer with has its own sentence,
// because "they are not finished yet" and "somebody already issued one" are the same 4xx to a
// boolean and completely different to a person.
//
// `not_staff` is in the map although the API answers it as a 404 rather than as a word: the
// frontend never shows the issue form to somebody who does not run the course, so the sentence is
// the honest fallback for the one case where the two could disagree.
export const COMPLETION_BLOCK_LABELS: Record<CompletionBlockReason, () => string> = {
	not_staff: m.school_reason_notStaff, // "Only the people running this course can issue a certificate."
	not_participant: m.school_reason_notParticipant, // "That person is not on this course's roster."
	not_done: m.school_reason_notDone, // "Their own progress statements do not yet say every lesson is done."
	already_issued: m.school_reason_alreadyIssued, // "This participant already has a certificate for this course."
	already_revoked: m.school_reason_alreadyRevoked // "This certificate has already been withdrawn."
};

/** The sentence for a `CompletionRefused`, falling back to the error's own message so a future
 *  refusal word still shows something rather than throwing. */
export function completionRefusalMessage(err: unknown, fallback: string): string {
	if (err instanceof Error && err.name === 'CompletionRefused') {
		const reason = (err as Error & { reason?: string }).reason;
		if (reason && reason in COMPLETION_BLOCK_LABELS) {
			return COMPLETION_BLOCK_LABELS[reason as CompletionBlockReason]();
		}
	}
	return err instanceof Error ? err.message : fallback;
}

// Flashcards enums — a hand-maintained mirror of `backend/flashcards/models.py`
// (`SOURCE_KIND_CHOICES`, `GRADE_CHOICES`) and of the refusal words `flashcards/rules.py` answers
// with. That file says so from its side (house rule 13: say it in both places, because this is
// where drift creeps in). The TYPES live in `$lib/types/flashcards.ts` and are imported, not
// redefined here — the same split every other app in this file uses.
import type { DeckRefusalReason, DeckSourceKind, ReviewGrade } from '$lib/types/flashcards';

export const DECK_SOURCE_LABELS: Record<DeckSourceKind, () => string> = {
	set: m.decks_source_set, // "From an exercise set"
	lesson: m.decks_source_lesson, // "From a course lesson"
	session: m.decks_source_session, // "From an event session"
	concept: m.decks_source_concept // "From a concept"
};

/** `null` is a real answer, not a missing one: somebody built this deck card by card. */
export function deckSourceLabel(kind: DeckSourceKind | null): string {
	return kind ? DECK_SOURCE_LABELS[kind]() : m.decks_source_manual(); // "Built by hand"
}

export const REVIEW_GRADES: ReviewGrade[] = [1, 2, 3, 4];

export const REVIEW_GRADE_LABELS: Record<ReviewGrade, () => string> = {
	1: m.decks_grade_again, // "Again"
	2: m.decks_grade_hard, // "Hard"
	3: m.decks_grade_good, // "Good"
	4: m.decks_grade_easy // "Easy"
};

// House rule 6, spelled out: every refusal `place_block_reason` / `public_block_reason` can answer
// with has its own sentence. A boolean would make "you do not run this course" and "it is already
// here" the same message, and they are completely different things to be told.
export const DECK_REFUSAL_LABELS: Record<DeckRefusalReason, () => string> = {
	not_owner: m.decks_reason_notOwner, // "You can only place your own decks."
	cannot_manage: m.decks_reason_cannotManage, // "You do not run this course or event."
	already_placed: m.decks_reason_alreadyPlaced, // "This deck is already there."
	kind: m.decks_reason_kind, // "A deck can only go on a course or an event."
	minor: m.decks_reason_minor // "Accounts under 16 cannot share a deck publicly."
};

/** Reads a refusal word off an `ApiError` (`{detail: '<word>'}`) and returns its sentence,
 * falling back to the error's own message for anything this map does not recognise — so a future
 * refusal word still shows something rather than throwing. The same shape, and the same reason,
 * as `pollRefusalMessage` above. */
export function deckRefusalMessage(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.body && typeof err.body === 'object') {
		const detail = (err.body as Record<string, unknown>).detail;
		if (typeof detail === 'string' && detail in DECK_REFUSAL_LABELS) {
			return DECK_REFUSAL_LABELS[detail as DeckRefusalReason]();
		}
	}
	return err instanceof Error ? err.message : fallback;
}

// Standing-page discussions — a hand-maintained mirror of `backend/community/discussions.py`'s
// `AUDIENCE_CHOICES` and of the refusal words `post_block_reason` answers with. That module says so
// from its side (house rule 13), because a word added on the server and not here shows a reader a
// blank line where a sentence should be.
import type { DiscussionAudience, DiscussionBlockReason } from '$lib/types/discussion';

export const DISCUSSION_AUDIENCES: DiscussionAudience[] = ['anyone', 'users', 'verified', 'staff'];

export const DISCUSSION_AUDIENCE_LABELS: Record<DiscussionAudience, () => string> = {
	anyone: m.discussions_audience_anyone, // "Anyone, including visitors who are not signed in"
	users: m.discussions_audience_users, // "Any signed-in account"
	verified: m.discussions_audience_verified, // "Verified contributors and staff"
	staff: m.discussions_audience_staff // "Staff only"
};

// House rule 6 spelled out: five words, five sentences. A boolean would make "sign in", "verified
// contributors only" and "a moderator closed this" the same greyed-out box, and they are three
// completely different things to be told.
export const DISCUSSION_BLOCK_LABELS: Record<DiscussionBlockReason, () => string> = {
	off: m.discussions_reason_off, // "This discussion is closed."
	anonymous: m.discussions_reason_anonymous, // "Sign in to join this discussion."
	verification_required: m.discussions_reason_verificationRequired, // "Only verified contributors can write here."
	staff_only: m.discussions_reason_staffOnly, // "Only the site's moderators can write here."
	minor: m.discussions_reason_minor // "Accounts under 16 cannot write where visitors who are not signed in can read and reply."
};

/** The sentence for a refusal word, falling back to the generic one for anything this map does not
 *  recognise — so a word added on the server still shows something rather than nothing. */
export function discussionRefusalMessage(reason: DiscussionBlockReason | null): string {
	if (reason && reason in DISCUSSION_BLOCK_LABELS) return DISCUSSION_BLOCK_LABELS[reason]();
	return m.discussions_reason_off();
}

// The learning record's metric columns — a hand-maintained mirror of `backend/identity/record.py`'s
// `METRIC_KEYS` (house rule 13: said in both files). One label and one hint per metric, because a
// column headed "Lessons finished" over a number somebody TYPED about themselves needs the sentence
// that says so — `courses.LessonProgress` is a statement, not a measurement.
//
// A provider may answer with a key this map does not know (`identity/record.py` keeps it rather than
// dropping it), so the lookup falls back to the raw key: an ugly column beats a disappeared one.
export const LEARNING_RECORD_METRICS: Record<string, () => string> = {
	sets: m.record_metric_sets, // "Sets"
	lessons_done: m.record_metric_lessonsDone, // "Lessons finished"
	cards_reviewed: m.record_metric_cardsReviewed // "Cards reviewed"
};

export const LEARNING_RECORD_METRIC_HINTS: Record<string, () => string> = {
	sets: m.record_metricHint_sets, // "Study sets that include an exercise from this subject."
	lessons_done: m.record_metricHint_lessonsDone, // "Lessons on a course about this subject that they said they had finished."
	cards_reviewed: m.record_metricHint_cardsReviewed // "Flashcard reviews logged on cards about this subject."
};

export function learningRecordMetricLabel(key: string): () => string {
	return LEARNING_RECORD_METRICS[key] ?? (() => key);
}

// Contests — step B's key lists and helper; the six enum maps the brief gave B were folded into
// step A's typed block at the END of this file at integration (2026-10-09), because A had written
// them typed against `lib/types/contest` and B's `Record<string>` copies said the same thing with
// different message keys. A hand-maintained mirror of `backend/contests/presets.py` (`PRESET_KEYS`,
// `PRIZE_REGIMES`, `ORGANISER_KINDS`, `LAW_MARKERS`/`MARKER_WORDS`) and of
// `backend/contests/models.py` (`STATUS_CHOICES`, `STAFF_ROLE_CHOICES`). Both of those files say
// so from their side (house rule 13: said in both, because this is where drift creeps in). A value
// added on the server and not here shows a reader the raw key, which is ugly rather than broken —
// every lookup below falls through to it on purpose.
//
// `Record<string, …>` and not a string-literal union, deliberately: steps A and B of the contests
// cycle were built at the same time and a type declared in both halves is a merge conflict for no
// benefit. The ORDER of `CONTEST_PRESET_KEYS` is `presets.PRESET_KEYS` — the safe default first,
// the two staff-only ones last — because that is the order the wizard shows them in.

export const CONTEST_PRESET_KEYS: string[] = [
	'challenge',
	'school',
	'staged',
	'university',
	'student_circle',
	'organization',
	'open_online',
	'team',
	'kuratorium',
	'olympiad'
];

// Not a tax calculation and never drawn as one — each label says which exemption a contest of this
// kind PLEADS, which is the organiser's decision and not this site's. `presets.py` carries the
// article numbers and their verification markers; the compliance panel (step A) draws those.
// WHO promised the prize — which under KC art. 919 §1 is who is bound by it, who is the data
// controller and who is the płatnik. It is the first thing on a contest page for that reason.
// How well a legal citation was checked (`CONTESTS-LAW.md`'s own four markers). Shown next to every
// article number this site prints, because the research behind them was done by nobody who is a
// lawyer and presenting an unverified number as settled would be the dishonest part.
// One lifecycle field, in the order a contest moves through it (`contests/models.py`). `cancelled`
// is reachable from anything but `closed` and is last here because it is off the main line.
export const CONTEST_STATUS_KEYS: string[] = [
	'draft',
	'announced',
	'registration_open',
	'running',
	'judging',
	'results_published',
	'closed',
	'cancelled'
];

// Role presets, never a permission editor (MANAGEMENT-BRIEF.md §1). Only `organiser` manages;
// `jury` scores and nothing else; a `proctor` supervises a stage without scoring; a `secretary`
// handles entries and complaints.
/** The label for a value this map does not know, falling back to the raw key — the
 *  `learningRecordMetricLabel` posture: an ugly word beats a blank space. */
export function contestLabel(map: Record<string, () => string>, key: string): string {
	return (map[key] ?? (() => key))();
}

// ---- contests: the refusal words (step A, CONTESTS-BRIEF.md §4 rule 6) ---------------------
//
// One sentence per word `backend/contests/rules.py` can answer with (house rule 6, said in both
// files — that module's own "the words" block names this map). Step A appends ONLY this; the enum
// label maps the brief assigns to step B (`PRESET_LABELS`, `PRIZE_REGIME_LABELS`,
// `ORGANISER_KIND_LABELS`, `LAW_MARKER_LABELS`, `CONTEST_STATUS_LABELS`,
// `CONTEST_STAFF_ROLE_LABELS`) are not here. On A's branch they live in
// `lib/utils/contestLabels.ts`, whose header says what integration does with it.
//
// Why thirty-odd sentences rather than five: "this contest is full", "the organiser disqualified
// you", "you help run this one" and "registration has not opened" are the same `false` to a
// boolean and four completely different things to be told. Several of these are the only place a
// person learns a legal fact about the contest they are entering — `claim_deadline_missing` is why
// an organiser cannot announce, and the reason is that without that date the whole promise is
// ineffective.
export const CONTEST_BLOCK_LABELS: Record<ContestBlockReason, () => string> = {
	// announce — what an organiser is still missing
	claim_deadline_missing: m.contests_block_claimDeadlineMissing, // "Set the deadline within which the prize may be claimed. Without it a prize contest is ineffective in Polish law, so this cannot be announced."
	jury_missing: m.contests_block_juryMissing, // "This kind of contest needs more people on its jury before it can be announced."
	criteria_missing: m.contests_block_criteriaMissing, // "Write the criteria the jury will mark against. Published criteria are what keep a contest from being treated as a lottery."
	controller_missing: m.contests_block_controllerMissing, // "Name who is responsible for the entrants' personal data, and how to reach them."
	external_reference_missing: m.contests_block_externalReferenceMissing, // "Link the kurator's or the committee's own announcement of this contest."
	no_stages: m.contests_block_noStages, // "Add at least one stage."
	chance_element: m.contests_block_chanceElement, // "Something here decides an outcome by chance. A contest whose result depends on a draw is a lottery under Polish law and needs a permit, so it cannot be run here."
	rules_missing: m.contests_block_rulesMissing, // "Publish the regulamin first. Entrants have to be able to read and keep the rules before they enter."
	// the lifecycle
	illegal_transition: m.contests_block_illegalTransition, // "A contest cannot move that way."
	closed: m.contests_block_closed, // "This contest is closed. Nothing more can be changed on it."
	stages_locked: m.contests_block_stagesLocked, // "An olympiad's three stages come from the 2002 regulation and cannot be changed here."
	// registering
	anonymous: m.contests_block_anonymous, // "Sign in to take part."
	not_open: m.contests_block_notOpen, // "Registration is not open."
	own_staff: m.contests_block_ownStaff, // "You help run this contest, so you cannot enter it."
	minor: m.contests_block_minor, // "This contest does not accept entrants under 16."
	guardian_consent_required: m.contests_block_guardianConsentRequired, // "An entrant under 16 needs a parent's or guardian's name and consent."
	already_registered: m.contests_block_alreadyRegistered, // "You have already entered."
	full: m.contests_block_full, // "This contest is full."
	team_required: m.contests_block_teamRequired, // "Give your team a name."
	// answering
	stage_not_open: m.contests_block_stageNotOpen, // "This stage is not open."
	not_accepted: m.contests_block_notAccepted, // "You are not one of this contest's entrants."
	already_submitted: m.contests_block_alreadySubmitted, // "You have already handed this stage in."
	not_advanced: m.contests_block_notAdvanced, // "You did not go through from the previous stage."
	no_problems: m.contests_block_noProblems, // "Add at least one problem before opening the stage."
	// scoring and publishing
	not_juror: m.contests_block_notJuror, // "Only this contest's jury scores it."
	stage_open: m.contests_block_stageOpen, // "Scoring starts when the stage closes."
	own_submission: m.contests_block_ownSubmission, // "You cannot score your own work."
	stage_unscored: m.contests_block_stageUnscored, // "Every stage has to be scored first."
	already_published: m.contests_block_alreadyPublished, // "The results are already published."
	not_published: m.contests_block_notPublished, // "The results have not been published yet."
	window_closed: m.contests_block_windowClosed, // "The complaints window has closed."
	// complaints
	not_participant: m.contests_block_notParticipant, // "Only somebody who took part can do that."
	already_open: m.contests_block_alreadyOpen, // "You already have a complaint waiting for an answer."
	already_answered: m.contests_block_alreadyAnswered, // "That complaint has already been answered."
	// authority
	not_manager: m.contests_block_notManager, // "Only this contest's organiser can do that."
	not_staff: m.contests_block_notStaff, // "Only the people running this contest can see that."
	last_organiser: m.contests_block_lastOrganiser, // "A contest has to keep an organiser."
	already_staff: m.contests_block_alreadyStaff, // "That person already has a role on this contest."
	has_submissions: m.contests_block_hasSubmissions // "Somebody has already handed work in to this stage, so it cannot be removed."
};

/** The sentence for a refusal word, falling back to the generic one — so a word added on the
 *  server shows something rather than nothing. The same shape `discussionRefusalMessage` has. */
export function contestRefusalMessage(reason: ContestBlockReason | null | undefined): string {
	if (reason && reason in CONTEST_BLOCK_LABELS) return CONTEST_BLOCK_LABELS[reason]();
	return m.contests_block_generic(); // "That is not possible right now."
}

// ---- contests: the enum label maps (step A, folded in at integration — see the note above) ----
//
// A hand-maintained mirror of `backend/contests/models.py`'s choices and of
// `backend/contests/presets.py`'s three enums (house rule 13: said in both files, and both of
// those modules name `labels.ts`). Every map answers a function rather than a string, like every
// other map here: a Paraglide message is a function, and calling it at module scope would freeze
// the reader's language at import time.
import type {
	Advancement,
	ComplianceState,
	ContestStaffRole,
	ContestStatus,
	LawMarker,
	OrganiserKind,
	PrizeRegime,
	ResultTitle,
	StageStatus
} from '$lib/types/contest';

/** `contests/models.py: STATUS_CHOICES`. */
export const CONTEST_STATUS_LABELS: Record<ContestStatus, () => string> = {
	draft: m.contests_status_draft, // "Draft"
	announced: m.contests_status_announced, // "Announced"
	registration_open: m.contests_status_registrationOpen, // "Registration open"
	running: m.contests_status_running, // "Running"
	judging: m.contests_status_judging, // "Judging"
	results_published: m.contests_status_resultsPublished, // "Results published"
	closed: m.contests_status_closed, // "Closed"
	cancelled: m.contests_status_cancelled // "Cancelled"
};

export function contestStatusLabel(status: ContestStatus): () => string {
	return CONTEST_STATUS_LABELS[status] ?? (() => status);
}

/** `contests/models.py: STAFF_ROLE_CHOICES`. Role presets, never a permission editor. */
export const CONTEST_STAFF_ROLE_LABELS: Record<ContestStaffRole, () => string> = {
	organiser: m.contests_role_organiser, // "Organiser"
	jury: m.contests_role_jury, // "Jury"
	proctor: m.contests_role_proctor, // "Proctor"
	secretary: m.contests_role_secretary // "Secretary"
};

export function contestStaffRoleLabel(role: ContestStaffRole): () => string {
	return CONTEST_STAFF_ROLE_LABELS[role] ?? (() => role);
}

/** `contests/models.py: STAGE_STATUS_CHOICES`. */
export const STAGE_STATUS_LABELS: Record<StageStatus, () => string> = {
	scheduled: m.contests_stageStatus_scheduled, // "Not open yet"
	open: m.contests_stageStatus_open, // "Open"
	closed: m.contests_stageStatus_closed, // "Closed — being scored"
	scored: m.contests_stageStatus_scored // "Scored"
};

export function stageStatusLabel(status: StageStatus): () => string {
	return STAGE_STATUS_LABELS[status] ?? (() => status);
}

/** `presets.ADVANCEMENTS`. There is deliberately no `draw`. */
export const ADVANCEMENT_LABELS: Record<Advancement, () => string> = {
	all: m.contests_advancement_all, // "Everyone goes on"
	top_n: m.contests_advancement_topN, // "The best N go on"
	threshold: m.contests_advancement_threshold, // "Everyone above a points line goes on"
	final: m.contests_advancement_final // "The last stage"
};

export function advancementLabel(advancement: Advancement): () => string {
	return ADVANCEMENT_LABELS[advancement] ?? (() => advancement);
}

/** `contests/models.py: RESULT_TITLE_CHOICES`. Polish keeps the words people actually use —
 *  *laureat*, *finalista*, *wyróżnienie* — because they are the words the regulations use. */
export const RESULT_TITLE_LABELS: Record<ResultTitle, () => string> = {
	participant: m.contests_title_participant, // "Took part"
	distinction: m.contests_title_distinction, // "Distinction"
	finalist: m.contests_title_finalist, // "Finalist"
	laureate: m.contests_title_laureate // "Laureate"
};

export function resultTitleLabel(title: ResultTitle): () => string {
	return RESULT_TITLE_LABELS[title] ?? (() => title);
}

/** `presets.PRIZE_REGIMES`. */
export const PRIZE_REGIME_LABELS: Record<PrizeRegime, () => string> = {
	none: m.contests_regime_none, // "No prize"
	pupil_exempt_115: m.contests_regime_pupilExempt, // "A pupils' contest on the education-system basis — exempt, no cap"
	science_68_then_10pct: m.contests_regime_science, // "The “science” exemption up to 2 000 zł, 10% above it"
	flat_10pct: m.contests_regime_flat // "10% withheld, no exemption pleaded"
};

export function prizeRegimeLabel(regime: PrizeRegime): () => string {
	return PRIZE_REGIME_LABELS[regime] ?? (() => regime);
}

/** `presets.ORGANISER_KINDS` — who the *przyrzekający*, the controller and the płatnik is. */
export const ORGANISER_KIND_LABELS: Record<OrganiserKind, () => string> = {
	person: m.contests_organiserKind_person, // "A person"
	organization: m.contests_organiserKind_organization, // "An organisation"
	kurator: m.contests_organiserKind_kurator, // "A kurator oświaty"
	committee: m.contests_organiserKind_committee // "A komitet główny"
};

export function organiserKindLabel(kind: OrganiserKind): () => string {
	return ORGANISER_KIND_LABELS[kind] ?? (() => kind);
}

/** `presets.LAW_MARKERS` — how sure the research behind a citation is. The compliance panel and
 *  the regulamin editor both draw one of these beside every article number, because an unverified
 *  number must never be presented as settled (CONTESTS-LAW.md §14). */
export const LAW_MARKER_LABELS: Record<LawMarker, () => string> = {
	verified: m.contests_marker_verified, // "text read"
	secondary: m.contests_marker_secondary, // "restated"
	unverified: m.contests_marker_unverified, // "unchecked"
	disputed: m.contests_marker_disputed // "disputed"
};

export function lawMarkerLabel(marker: LawMarker): () => string {
	return LAW_MARKER_LABELS[marker] ?? (() => marker);
}

/** `compliance.py`'s three states. */
export const COMPLIANCE_STATE_LABELS: Record<ComplianceState, () => string> = {
	ok: m.contests_compliance_ok, // "Done"
	missing: m.contests_compliance_missing, // "Missing"
	warning: m.contests_compliance_warning // "Check this"
};

export function complianceStateLabel(state: ComplianceState): () => string {
	return COMPLIANCE_STATE_LABELS[state] ?? (() => state);
}

/** The preset's NAME. The preset payload already carries `name_pl`/`name_en`, so a page with the
 *  preset in hand should use those; this is for a card, which has only the key. */
export const PRESET_LABELS: Record<string, () => string> = {
	challenge: m.contests_preset_challenge, // "Challenge (no prize)"
	school: m.contests_preset_school, // "School contest"
	staged: m.contests_preset_staged, // "Multi-stage"
	university: m.contests_preset_university, // "University or faculty"
	student_circle: m.contests_preset_studentCircle, // "Student circle"
	organization: m.contests_preset_organization, // "On behalf of an organisation"
	open_online: m.contests_preset_openOnline, // "Open online, with prizes"
	team: m.contests_preset_team, // "Teams"
	kuratorium: m.contests_preset_kuratorium, // "Kurator's subject contest"
	olympiad: m.contests_preset_olympiad // "Subject olympiad"
};

/** Falls back to the raw key: a preset added on the server still shows something rather than
 *  nothing, which is the same posture `learningRecordMetricLabel` takes in `labels.ts`. */
export function presetName(key: string): () => string {
	return PRESET_LABELS[key] ?? (() => key);
}

// ---- the compliance panel's `detail` keys ---------------------------------------------------
//
// `compliance.report` answers each item with a `detail` KEY rather than a sentence, so the
// sentence can be written in both languages here. The shape is `<item key>[:<hint>[:<hint>]]`,
// and the hints are either a word this map knows or a count (`2of3`, `14`). Anything else is
// ignored rather than printed raw — a reader does not need to see `science_68_then_10pct`.

const COMPLIANCE_HINTS: Record<string, () => string> = {
	no_prize: m.contests_hint_noPrize, // "no prize is promised, so this does not apply"
	no_minors: m.contests_hint_noMinors, // "this contest does not accept under-16s"
	not_a_business: m.contests_hint_notABusiness, // "the organiser is not a business"
	not_a_team_contest: m.contests_hint_notATeamContest, // "not a team contest"
	manual: m.contests_hint_manual, // "only a person can check this — the site cannot"
	galleries: m.contests_hint_galleries, // "photos of a contest live in a gallery, which asks for its own consent"
	structural: m.contests_hint_structural, // "built in: it cannot be bundled into entry"
	enforced: m.contests_hint_enforced, // "built in: entry is refused without it"
	below_recommended: m.contests_hint_belowRecommended, // "fewer than the recommended number"
	chance_element: m.contests_hint_chanceElement, // "a stage or the criteria read like a draw"
	no_stages: m.contests_hint_noStages, // "there are no stages yet"
	no_results: m.contests_hint_noResults, // "results have not been published"
	closed: m.contests_hint_closed, // "the contest is closed"
	business_short: m.contests_hint_businessShort, // "a business organiser should allow at least 14 days"
	prizes_section: m.contests_hint_prizesSection, // "§7 of the regulamin is where the split goes"
	adults_only: m.contests_hint_adultsOnly // "every entrant so far is an adult"
};

const COUNT = /^(\d+)of(\d+)$/;

/** The sentence that goes after an item's title, or '' when the detail adds nothing. */
export function complianceHint(detail: string, key: string): string {
	const parts = detail.split(':');
	// The first segment is the item's own key, already drawn as the title.
	const hints = parts[0] === key ? parts.slice(1) : parts;
	const out: string[] = [];
	for (const hint of hints) {
		const known = COMPLIANCE_HINTS[hint];
		if (known) {
			out.push(known());
			continue;
		}
		const count = COUNT.exec(hint);
		if (count) {
			out.push(m.contests_hint_count({ done: count[1], total: count[2] })); // "{done} of {total}"
		}
	}
	return out.join('; ');
}

// ---- sign in with Google / Apple / Microsoft (backend `sso/`, 2026-10-14) ----------------------
//
// One sentence per word the backend can send the done page (`sso/services.py: ERROR_CODES`) or
// answer an exchange / unlink with — a hand-maintained mirror, said in both files (house rule 13).
// A refusal carries its reason (house rule 6): "you cancelled" and "that Google account belongs to
// somebody else" are both a failed sign-in and need completely different next steps.
export const SSO_ERROR_LABELS: Record<string, () => string> = {
	cancelled: m.sso_error_cancelled, // "You cancelled at the provider, so nothing happened. You can try again, or sign in with your password."
	state_invalid: m.sso_error_stateInvalid, // "This sign-in link is not one this site started, or it has already been used. Start again from the sign-in page."
	state_expired: m.sso_error_stateExpired, // "That took longer than ten minutes, so the sign-in expired. Start again."
	provider_error: m.sso_error_providerError, // "The provider's answer could not be verified, so it was not trusted. Try again in a moment."
	email_missing: m.sso_error_emailMissing, // "The provider did not share an email address, and an account here needs one. Allow the address when the provider asks, or register with a password."
	email_in_use: m.sso_error_emailInUse, // "An account here already uses this email address. Sign in with your password, then link this provider in Settings → Sign-in methods. Accounts are never joined by email alone."
	already_linked: m.sso_error_alreadyLinked, // "That provider account is already linked to a different account here. Sign in to that account to unlink it first."
	account_inactive: m.sso_error_accountInactive, // "This account is suspended, so it cannot sign in."
	flag_off: m.sso_error_flagOff, // "Signing in with an outside account is switched off on this site right now. Sign in with your password."
	not_configured: m.sso_error_notConfigured, // "This sign-in method is not set up on this site."
	code_invalid: m.sso_error_codeInvalid, // "This sign-in link has expired or was opened in a different tab or browser from the one that started it. Start again from the sign-in page."
	wrong_account: m.sso_error_wrongAccount, // "Linking has to finish in the account that started it. Sign in to that account and try again."
	ticket_invalid: m.sso_error_ticketInvalid, // "This sign-up has expired (it lasts half an hour) or was opened in a different tab. Start again from the sign-in page."
	set_password_first: m.sso_error_setPasswordFirst // "This is the only way into your account. Set a password first (use “Forgotten your password?”), then unlink it."
};

export function ssoErrorLabel(code: string | null | undefined): string {
	const label = code ? SSO_ERROR_LABELS[code] : undefined;
	return label ? label() : m.sso_error_generic(); // "Signing in did not work. Try again, or sign in with your password."
}
