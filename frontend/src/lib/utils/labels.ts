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
	venues: m.featureFlags_label_venues, // "Venues, rooms and checklists"
	event_documents: m.featureFlags_label_eventDocuments, // "Event documents and briefings"
	tickets: m.featureFlags_label_tickets, // "Tickets, QR codes and scanning"
	shifts: m.featureFlags_label_shifts, // "Volunteer rota (shifts)"
	cloakroom: m.featureFlags_label_cloakroom, // "Cloakroom desk"
	role_preview: m.featureFlags_label_rolePreview, // "View an event as a visitor"
	material_uploads_verified_only: m.featureFlags_label_materialUploadsVerifiedOnly
};

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
