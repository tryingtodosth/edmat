// Shared label maps for the two closed-enum Exercise fields (difficulty, source type) — extracted
// once a THIRD component (RandomExerciseButton, after FiltersSidebar and the submit form) needed the
// exact same lists, per this codebase's own "three strikes" convention for when a duplicated pattern
// earns a shared utility.

import type {
	Difficulty,
	DonationPlatform,
	FeatureFlagKey,
	BuiltinMaterialType,
	MaterialSort,
	NotificationType,
	SourceType
} from '$lib/types';
import { m } from '$lib/paraglide/messages.js';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

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
		issueStatusChanged: 'notifyOnModerationDecision'
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
	issueStatusChanged: m.notifPref_issueStatusChanged
};

// The platform-wide moderator kill switches (backend moderation/models.py's FEATURE_FLAG_CHOICES)
// — mirrored by hand here, same "small, rarely-changing enum, flag the drift risk rather than fetch
// a labels endpoint for it" call this codebase already made for DONATION_PLATFORMS/SOURCE_TYPES.
export const FEATURE_FLAG_LABELS: Record<FeatureFlagKey, () => string> = {
	tutoring: m.featureFlags_label_tutoring,
	classroom: m.featureFlags_label_classroom,
	messaging: m.featureFlags_label_messaging,
	exercise_submissions: m.featureFlags_label_exerciseSubmissions,
	material_submissions: m.featureFlags_label_materialSubmissions,
	events: m.featureFlags_label_events,
	issues: m.featureFlags_label_issues,
	posts: m.featureFlags_label_posts,
	material_uploads_verified_only: m.featureFlags_label_materialUploadsVerifiedOnly
};
