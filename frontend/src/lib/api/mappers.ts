// Backend JSON -> frontend TS shape, one function per domain type. Kept in one file since several
// lib/services/*.ts functions need the SAME mapping (e.g. getExercisesForCourse/getTopRatedExercises/
// getRandomExercise all need "raw exercise JSON -> ResolvedExercise") — the "three strikes" extraction
// convention this codebase already follows elsewhere (see CLAUDE.md's Random Exercise feature note).
//
// id-format convention used throughout: Field/Course ids are the backend's own slug (already a
// stable, human-readable string, and every URL on both sides already keys by it — no PK<->slug
// lookup ever needed). Every other id (Topic, Exercise, Review, Comment, User, ...) is the backend's
// numeric PK converted to a string via String(n) — opaque everywhere in this app (never parsed back
// into a number, never constructed by hand outside this file), so the specific format doesn't matter
// beyond "stable and unique," which a PK-as-string already is.

import type {
	Comment,
	CommentTargetType,
	Course,
	CoverageVoteSummary,
	DonationLink,
	EditSuggestion,
	Exercise,
	ExerciseRequirement,
	ExerciseSet,
	ExerciseSource,
	ExerciseSubmission,
	ExerciseTranslation,
	FeatureFlag,
	Field,
	Material,
	MaterialCoverage,
	MaterialRequirement,
	MaterialReview,
	MaterialSubmission,
	MaterialType,
	Message,
	ModerationStatus,
	NodeGovernorGrant,
	Notification,
	ReportGroup,
	ReportKind,
	ResolvedExercise,
	Review,
	Service,
	ServiceReview,
	ServiceWatch,
	Subtopic,
	TagFollowState,
	Topic,
	User
} from '$lib/types';

function undefinedIfEmpty(value: string | null | undefined): string | undefined {
	return value ? value : undefined;
}

function idOrUndefined(value: number | null | undefined): string | undefined {
	return value === null || value === undefined ? undefined : String(value);
}

// ---- taxonomy ------------------------------------------------------------------------------

export interface RawField {
	id: number;
	slug: string;
	published: boolean;
	name: string;
	description: string;
}

export function mapField(json: RawField): Field {
	return {
		id: json.slug,
		name: json.name,
		description: json.description,
		published: json.published
	};
}

export interface RawTopic {
	id: number;
	slug: string;
	course: number;
	order: number;
	name: string;
}

/** `courseId` is the frontend course id (= slug) — the raw JSON's own `course` field is a PK int,
 * not a slug, but a Topic is always resolved from a request already scoped to one known course, so
 * the caller passes that course's own id straight through rather than needing a second lookup. */
export function mapTopic(json: RawTopic, courseId: string): Topic {
	return { id: String(json.id), slug: json.slug, courseId, name: json.name, order: json.order };
}

export interface RawSubtopic {
	id: number;
	slug: string;
	topic: number;
	order: number;
	name: string;
}

/** Nested inside RawMaterialCoverage (below), same "no standalone list endpoint" treatment
 * mapTopic's own `courseId` parameter gets — `topicId` is passed straight through from the
 * enclosing coverage row rather than re-derived from `json.topic` (a bare PK with no course
 * context of its own to compose an id from, unlike mapTopic's `courseId` which the caller already
 * has in hand). */
export function mapSubtopic(json: RawSubtopic, topicId: string): Subtopic {
	return { id: String(json.id), slug: json.slug, topicId, name: json.name, order: json.order };
}

export interface RawCourse {
	id: number;
	slug: string;
	field: string; // already the field's own slug (backend SlugRelatedField)
	university: string;
	published: boolean;
	order: number;
	name: string;
	description: string;
	topics: RawTopic[];
}

export function mapCourse(json: RawCourse): Course {
	return {
		id: json.slug,
		fieldId: json.field,
		name: json.name,
		description: json.description,
		university: json.university,
		published: json.published,
		order: json.order,
		topics: json.topics.map((t) => mapTopic(t, json.slug))
	};
}

// ---- exercises ------------------------------------------------------------------------------

export interface RawExerciseSource {
	type: ExerciseSource['type'];
	collection: string;
	original_problem_number: number | null;
	pages: string;
	chapter: number | null;
	name: string;
}

function mapSource(json: RawExerciseSource): ExerciseSource {
	return {
		type: json.type,
		name: undefinedIfEmpty(json.name),
		collection: undefinedIfEmpty(json.collection),
		originalProblemNumber: json.original_problem_number ?? undefined,
		pages: undefinedIfEmpty(json.pages),
		chapter: json.chapter ?? undefined
	};
}

/** Fields present on EVERY exercise response, list or detail. */
export interface RawExerciseCommon {
	id: number;
	course: number;
	course_slug: string;
	number: number;
	topics: number[];
	difficulty: Exercise['difficulty'];
	tags: string[];
	published: boolean;
	verified: boolean;
	original_locale: string;
	submitted_by: number | null;
	title: string;
	resolved_locale: string;
	source: RawExerciseSource;
	average_rating: number | null;
	review_count: number;
	created_at: string;
}

/** Detail-only fields — resolving these needs a full per-locale translation walk, so the List
 * shape (used for course/top-rated/recent listings, where nothing reads them) skips them entirely
 * rather than paying that cost for every exercise in a 383-item course listing. */
export interface RawExerciseDetail extends RawExerciseCommon {
	statement: string;
	hint: string;
	answer: string;
	solution: string;
	translated_by: number | null;
	available_locales: string[];
	requirements: RawExerciseRequirement[];
}

export interface RawExerciseRequirement {
	id: number;
	label: string;
	order: number;
	vote_summary: RawCoverageVoteSummary;
}

/** The exact same mapping `mapMaterialRequirement` already does for a Material's own requirement
 * row — kept as its own function (not a shared generic one) purely because the two Raw shapes are
 * declared as separate interfaces (`RawExerciseRequirement`/`RawMaterialRequirement`), matching how
 * the backend keeps `ExerciseRequirementSerializer`/`MaterialRequirementSerializer` as two thin,
 * identical-shaped serializers rather than one shared one. */
export function mapExerciseRequirement(json: RawExerciseRequirement): ExerciseRequirement {
	return {
		id: String(json.id),
		label: json.label,
		order: json.order,
		voteSummary: mapVoteSummary(json.vote_summary)
	};
}

function mapExerciseBase(json: RawExerciseCommon): Exercise {
	return {
		id: String(json.id),
		courseId: json.course_slug,
		number: json.number,
		topicIds: json.topics.map(String),
		difficulty: json.difficulty,
		source: mapSource(json.source),
		tags: json.tags,
		published: json.published,
		verified: json.verified,
		originalLocale: json.original_locale,
		submittedByUserId: idOrUndefined(json.submitted_by),
		createdAt: json.created_at,
		averageRating: json.average_rating ?? undefined,
		reviewCount: json.review_count
	};
}

/** Used by list endpoints (course/exercises, top-rated, recent, random) — `statement`/`hint`/
 * `answer`/`solution` are cheap empty-string placeholders (never read by a card/list view, see
 * lib/components/exercise/ExerciseCard.svelte) rather than real content, matching the type contract
 * without paying for detail resolution nothing on that page actually needs. */
export function mapResolvedExerciseList(json: RawExerciseCommon): ResolvedExercise {
	return {
		...mapExerciseBase(json),
		locale: json.resolved_locale,
		isOriginal: json.resolved_locale === json.original_locale,
		title: json.title,
		statement: '',
		hint: '',
		answer: '',
		solution: '',
		translatedByUserId: undefined,
		availableLocales: [],
		requirements: []
	};
}

export function mapResolvedExerciseDetail(json: RawExerciseDetail): ResolvedExercise {
	return {
		...mapExerciseBase(json),
		locale: json.resolved_locale,
		isOriginal: json.resolved_locale === json.original_locale,
		title: json.title,
		statement: json.statement,
		hint: json.hint,
		answer: json.answer,
		solution: json.solution,
		translatedByUserId: idOrUndefined(json.translated_by),
		availableLocales: json.available_locales,
		requirements: (json.requirements ?? []).map(mapExerciseRequirement)
	};
}

export interface RawExerciseTranslation {
	id: number;
	exercise: number;
	locale: string;
	title: string;
	statement: string;
	hint: string;
	answer: string;
	solution: string;
	status: ExerciseTranslation['status'];
	translated_by: number | null;
	reviewed_by: number | null;
	review_note: string;
	created_at: string;
}

export function mapExerciseTranslation(json: RawExerciseTranslation): ExerciseTranslation {
	return {
		id: String(json.id),
		exerciseId: String(json.exercise),
		locale: json.locale,
		title: json.title,
		statement: json.statement,
		hint: json.hint,
		answer: json.answer,
		solution: json.solution,
		status: json.status,
		translatedByUserId: idOrUndefined(json.translated_by),
		reviewedByUserId: idOrUndefined(json.reviewed_by),
		reviewNote: undefinedIfEmpty(json.review_note),
		createdAt: json.created_at
	};
}

// ---- materials ------------------------------------------------------------------------------

const BACKEND_TO_FRONTEND_MATERIAL_TYPE: Record<string, MaterialType> = {
	script: 'script',
	exam_collection: 'examCollection',
	midterm_collection: 'midtermCollection',
	exercise_collection: 'exerciseCollection',
	formula_sheet: 'formulaSheet',
	lecture_slides: 'lectureSlides',
	solution_guide: 'solutionGuide',
	syllabus: 'syllabus',
	practice_test: 'practiceTest',
	recording: 'recording',
	textbook_excerpt: 'textbookExcerpt',
	code_dataset: 'codeDataset',
	other: 'other'
};

// The reverse of the map right above — derived FROM it, not hand-duplicated, so the two can never
// silently drift apart the moment a new material type is ever added on one side and not the other.
// Needed for the material-submission upload form (submitMaterial, materials.ts), which sends a
// type value INTO the backend rather than only ever reading one back out.
export const FRONTEND_TO_BACKEND_MATERIAL_TYPE = Object.fromEntries(
	Object.entries(BACKEND_TO_FRONTEND_MATERIAL_TYPE).map(([backend, frontend]) => [
		frontend,
		backend
	])
) as Record<MaterialType, string>;

export interface RawCoverageVoteSummary {
	agree_count: number;
	disagree_count: number;
	agree_weight: number;
	disagree_weight: number;
	net_weight: number;
	percent_agree: number | null;
	current_user_vote: number | null;
}

function mapVoteSummary(json: RawCoverageVoteSummary): CoverageVoteSummary {
	return {
		agreeCount: json.agree_count,
		disagreeCount: json.disagree_count,
		agreeWeight: json.agree_weight,
		disagreeWeight: json.disagree_weight,
		netWeight: json.net_weight,
		percentAgree: json.percent_agree ?? undefined,
		currentUserVote: (json.current_user_vote ?? undefined) as CoverageVoteSummary['currentUserVote']
	};
}

export interface RawMaterialCoverage {
	id: number;
	material: number;
	topic: RawTopic;
	subtopic: RawSubtopic | null;
	level: number;
	proposed_by: number | null;
	created_at: string;
	vote_summary: RawCoverageVoteSummary;
	comment_count: number;
}

export function mapMaterialCoverage(json: RawMaterialCoverage): MaterialCoverage {
	const topicId = String(json.topic.id);
	return {
		id: String(json.id),
		materialId: String(json.material),
		topicId,
		topicName: json.topic.name,
		subtopicId: json.subtopic ? String(json.subtopic.id) : undefined,
		subtopicName: json.subtopic?.name,
		level: json.level,
		proposedByUserId: idOrUndefined(json.proposed_by),
		createdAt: json.created_at,
		voteSummary: mapVoteSummary(json.vote_summary),
		commentCount: json.comment_count
	};
}

export interface RawMaterialRequirement {
	id: number;
	label: string;
	order: number;
	vote_summary: RawCoverageVoteSummary;
}

export function mapMaterialRequirement(json: RawMaterialRequirement): MaterialRequirement {
	return {
		id: String(json.id),
		label: json.label,
		order: json.order,
		voteSummary: mapVoteSummary(json.vote_summary)
	};
}

export interface RawMaterial {
	id: number;
	course: number;
	course_slug: string;
	slug: string;
	type: string;
	coverage: RawMaterialCoverage[];
	requirements: RawMaterialRequirement[];
	file: string | null;
	author: string;
	source_url: string;
	submitted_by: number | null;
	submitted_by_display_name: string | null;
	tags: string[];
	published: boolean;
	featured: boolean;
	order: number;
	title: string;
	description: string;
	price_amount: string | null;
	price_currency: string;
	estimated_minutes: number | null;
	average_rating: number | null;
	review_count: number;
	created_at: string;
}

export function mapMaterial(json: RawMaterial): Material {
	const fileUrl = json.file ?? '';
	return {
		id: String(json.id),
		courseId: json.course_slug,
		slug: json.slug,
		type: BACKEND_TO_FRONTEND_MATERIAL_TYPE[json.type] ?? 'other',
		title: json.title,
		description: json.description,
		coverage: json.coverage.map(mapMaterialCoverage),
		requirements: (json.requirements ?? []).map(mapMaterialRequirement),
		fileName: fileUrl ? (fileUrl.split('/').pop() ?? fileUrl) : '',
		fileUrl,
		author: json.author,
		sourceUrl: json.source_url || undefined,
		submittedByUserId: idOrUndefined(json.submitted_by),
		submittedByDisplayName: json.submitted_by_display_name ?? undefined,
		tags: json.tags ?? [],
		published: json.published,
		featured: json.featured,
		order: json.order,
		averageRating: json.average_rating,
		reviewCount: json.review_count,
		priceAmount: json.price_amount != null ? Number(json.price_amount) : undefined,
		priceCurrency: json.price_currency,
		estimatedMinutes: json.estimated_minutes ?? undefined,
		createdAt: json.created_at
	};
}

export interface RawMaterialReview {
	id: number;
	material: number;
	author: number;
	author_display_name: string;
	rating: number;
	body: string;
	created_at: string;
}

export function mapMaterialReview(json: RawMaterialReview): MaterialReview {
	return {
		id: String(json.id),
		materialId: String(json.material),
		userId: String(json.author),
		rating: json.rating,
		body: json.body || undefined,
		createdAt: json.created_at
	};
}

// ---- community: reviews & comments -----------------------------------------------------------

export interface RawReview {
	id: number;
	exercise: number;
	author: number;
	author_display_name: string;
	rating: number;
	body: string;
	created_at: string;
}

export function mapReview(json: RawReview): Review {
	return {
		id: String(json.id),
		exerciseId: String(json.exercise),
		userId: String(json.author),
		rating: json.rating,
		body: undefinedIfEmpty(json.body),
		createdAt: json.created_at
	};
}

export interface RawComment {
	id: number;
	parent: number | null;
	author: number;
	author_display_name: string;
	body: string;
	created_at: string;
	is_removed: boolean;
	is_auto_hidden: boolean;
}

/** `targetType`/`targetId` come from the calling context (every comment fetch/post in this app is
 * already scoped to one known target, CLAUDE.md's own note on why a Comment's raw `content_type`/
 * `object_id` PKs are never resolved frontend-side) rather than from the raw JSON's own
 * ContentType-framework fields, which have no meaning on the frontend anyway. */
export function mapComment(
	json: RawComment,
	targetType: CommentTargetType,
	targetId: string
): Comment {
	return {
		id: String(json.id),
		targetType,
		targetId,
		parentId: idOrUndefined(json.parent),
		authorId: String(json.author),
		body: json.body,
		createdAt: json.created_at,
		isRemoved: json.is_removed,
		isAutoHidden: json.is_auto_hidden
	};
}

// ---- moderation -------------------------------------------------------------------------------

export interface RawExerciseSubmission {
	id: number;
	course: string; // slug (SlugRelatedField)
	submitted_by: number;
	payload: unknown; // round-trips as ExerciseSubmissionDraft verbatim, see submissions.ts
	status: ModerationStatus;
	reviewed_by: number | null;
	review_note: string;
	resulting_exercise: number | null;
	created_at: string;
}

export function mapExerciseSubmission(json: RawExerciseSubmission): ExerciseSubmission {
	return {
		id: String(json.id),
		courseId: json.course,
		submittedByUserId: String(json.submitted_by),
		draft: json.payload as ExerciseSubmission['draft'],
		status: json.status,
		reviewedByUserId: idOrUndefined(json.reviewed_by),
		reviewNote: undefinedIfEmpty(json.review_note),
		createdAt: json.created_at,
		resultingExerciseId: idOrUndefined(json.resulting_exercise)
	};
}

export interface RawMaterialSubmission {
	id: number;
	course: string; // slug (SlugRelatedField), same convention as RawExerciseSubmission.course
	submitted_by: number;
	type: string;
	title: string;
	description: string;
	locale: string;
	file: string | null;
	author: string;
	source_url: string;
	requirements: string[];
	price_amount: string | null;
	price_currency: string;
	estimated_minutes: number | null;
	scan_status: MaterialSubmission['scanStatus'];
	scan_detail: string;
	status: ModerationStatus;
	reviewed_by: number | null;
	review_note: string;
	resulting_material: number | null;
	created_at: string;
}

export function mapMaterialSubmission(json: RawMaterialSubmission): MaterialSubmission {
	const fileUrl = json.file ?? '';
	return {
		id: String(json.id),
		courseId: json.course,
		submittedByUserId: String(json.submitted_by),
		type: BACKEND_TO_FRONTEND_MATERIAL_TYPE[json.type] ?? 'other',
		title: json.title,
		description: json.description,
		locale: json.locale,
		fileName: fileUrl ? (fileUrl.split('/').pop() ?? fileUrl) : '',
		fileUrl,
		author: json.author ?? '',
		sourceUrl: json.source_url || undefined,
		requirements: json.requirements ?? [],
		priceAmount: json.price_amount != null ? Number(json.price_amount) : undefined,
		priceCurrency: json.price_currency,
		estimatedMinutes: json.estimated_minutes ?? undefined,
		scanStatus: json.scan_status,
		scanDetail: json.scan_detail,
		status: json.status,
		reviewedByUserId: idOrUndefined(json.reviewed_by),
		reviewNote: undefinedIfEmpty(json.review_note),
		createdAt: json.created_at,
		resultingMaterialId: idOrUndefined(json.resulting_material)
	};
}

export interface RawEditSuggestion {
	id: number;
	exercise: number;
	locale: string;
	field: EditSuggestion['field'];
	proposed_value: string;
	reason: string;
	submitted_by: number;
	status: ModerationStatus;
	reviewed_by: number | null;
	review_note: string;
	created_at: string;
}

export function mapEditSuggestion(json: RawEditSuggestion): EditSuggestion {
	return {
		id: String(json.id),
		exerciseId: String(json.exercise),
		locale: json.locale,
		field: json.field,
		proposedValue: json.proposed_value,
		reason: undefinedIfEmpty(json.reason),
		submittedByUserId: String(json.submitted_by),
		status: json.status,
		reviewedByUserId: idOrUndefined(json.reviewed_by),
		reviewNote: undefinedIfEmpty(json.review_note),
		createdAt: json.created_at
	};
}

export interface RawReportGroup {
	kind: ReportKind;
	object_id: number;
	report_count: number;
	view_count: number | null;
	percent_reported: number | null;
	is_auto_hidden: boolean;
	reasons: string[];
	preview: string;
	exercise_id: number | null;
	exercise_title: string | null;
	last_reported_at: string;
}

export function mapReportGroup(json: RawReportGroup): ReportGroup {
	return {
		kind: json.kind,
		objectId: String(json.object_id),
		reportCount: json.report_count,
		viewCount: json.view_count ?? undefined,
		percentReported: json.percent_reported ?? undefined,
		isAutoHidden: json.is_auto_hidden,
		reasons: json.reasons,
		preview: json.preview,
		exerciseId: idOrUndefined(json.exercise_id),
		exerciseTitle: json.exercise_title ?? undefined,
		lastReportedAt: json.last_reported_at
	};
}

// ---- study: exercise sets -----------------------------------------------------------------------

export interface RawExerciseSet {
	id: number;
	slug: string;
	owner: number;
	owner_display_name: string;
	name: string;
	items: {
		id: number;
		exercise: number;
		order: number;
		include_hint: boolean;
		include_answer: boolean;
		include_solution: boolean;
	}[];
	is_public: boolean;
	created_at: string;
}

export function mapExerciseSet(json: RawExerciseSet): ExerciseSet {
	const sortedItems = [...json.items].sort((a, b) => a.order - b.order);
	const itemOptions: ExerciseSet['itemOptions'] = {};
	for (const item of sortedItems) {
		itemOptions[String(item.exercise)] = {
			includeHint: item.include_hint,
			includeAnswer: item.include_answer,
			includeSolution: item.include_solution
		};
	}
	return {
		id: json.slug,
		ownerId: String(json.owner),
		ownerDisplayName: json.owner_display_name,
		name: json.name,
		exerciseIds: sortedItems.map((i) => String(i.exercise)),
		itemOptions,
		isPublic: json.is_public,
		createdAt: json.created_at
	};
}

// ---- accounts -----------------------------------------------------------------------------------

export interface RawDonationLink {
	id: number;
	platform: string; // snake_case backend enum values — see PLATFORM_MAP below for the camelCase mapping
	label: string;
	display_label: string;
	url: string;
	order: number;
}

// The backend's DONATION_PLATFORM_CHOICES keys, mapped to this app's own camelCase
// DonationPlatform union — kept as an explicit table (not a blind `snakeToCamel` transform) so an
// unrecognized value from the backend degrades to 'other' instead of producing a value TypeScript
// thinks is valid but isn't.
const DONATION_PLATFORM_MAP: Record<string, DonationLink['platform']> = {
	paypal: 'paypal',
	payu: 'payu',
	blik: 'blik',
	card: 'card',
	apple_pay: 'applePay',
	google_pay: 'googlePay',
	buy_me_a_coffee: 'buyMeACoffee',
	ko_fi: 'koFi',
	patreon: 'patreon',
	github_sponsors: 'githubSponsors',
	bank_transfer: 'bankTransfer',
	other: 'other'
};

export function mapDonationLink(json: RawDonationLink): DonationLink {
	return {
		id: String(json.id),
		platform: DONATION_PLATFORM_MAP[json.platform] ?? 'other',
		label: json.label,
		displayLabel: json.display_label,
		url: json.url,
		order: json.order
	};
}

// Backend snake_case <-> frontend camelCase for a Notification's own `type` — exported (moved
// ahead of its original, single call site in mapNotification below) since `mapUser`'s own
// `muted_notification_types` needs the SAME conversion table, not a second, independently
// hand-maintained copy that could drift from this one.
export const NOTIFICATION_TYPE_MAP: Record<string, Notification['type']> = {
	submission_approved: 'submissionApproved',
	submission_rejected: 'submissionRejected',
	edit_suggestion_approved: 'editSuggestionApproved',
	edit_suggestion_rejected: 'editSuggestionRejected',
	translation_approved: 'translationApproved',
	translation_rejected: 'translationRejected',
	comment_reply: 'commentReply',
	content_auto_hidden: 'contentAutoHidden',
	content_restored: 'contentRestored',
	content_removed: 'contentRemoved',
	new_tagged_content: 'newTaggedContent',
	course_enrollment_requested: 'courseEnrollmentRequested',
	course_enrollment_approved: 'courseEnrollmentApproved',
	course_enrollment_declined: 'courseEnrollmentDeclined',
	course_removed: 'courseRemoved',
	course_new_lesson: 'courseNewLesson',
	course_new_post: 'courseNewPost'
};

// The reverse — needed only when SENDING `mutedNotificationTypes` back to the backend
// (PATCH /auth/me/), which stores/compares snake_case `Notification.type` strings.
export const NOTIFICATION_TYPE_REVERSE_MAP: Record<Notification['type'], string> =
	Object.fromEntries(
		Object.entries(NOTIFICATION_TYPE_MAP).map(([snake, camel]) => [camel, snake])
	) as Record<Notification['type'], string>;

export interface RawProfile {
	id: number; // the USER's own pk (see accounts/serializers.py's own note on why)
	username: string;
	email: string;
	display_name: string;
	bio?: string;
	avatar: string | null;
	preferred_locale: string;
	is_verified_contributor: boolean;
	is_moderator: boolean;
	is_node_governor: boolean;
	joined_at: string | null; // null only on a privacy-gated PublicProfile response
	is_profile_public?: boolean; // present on GET /users/{id}/ only, not on /auth/me/'s own shape
	show_profile_publicly?: boolean; // present on /auth/me/ only — a stranger's own PublicProfile never includes it
	notify_on_comment_reply?: boolean;
	notify_on_moderation_decision?: boolean;
	notify_on_content_action?: boolean;
	notify_on_course_activity?: boolean;
	muted_notification_types?: string[]; // snake_case type strings — converted below
	donation_links?: RawDonationLink[];
	// Always present on BOTH /auth/me/ and /users/{id}/ — accounts/serializers.py's
	// ProfileSerializer/PublicProfileSerializer both include these unconditionally, regardless of
	// show_profile_publicly (opting in to tutoring is itself the point of setting it).
	offers_tutoring: boolean;
	tutoring_note: string;
}

export function mapUser(json: RawProfile): User {
	return {
		id: String(json.id),
		bio: json.bio,
		displayName: json.display_name || json.username,
		email: json.email,
		avatarUrl: json.avatar ?? undefined,
		joinedAt: json.joined_at,
		isVerifiedContributor: json.is_verified_contributor,
		isModerator: json.is_moderator,
		isNodeGovernor: json.is_node_governor,
		preferredLocale: json.preferred_locale,
		offersTutoring: json.offers_tutoring,
		tutoringNote: json.tutoring_note,
		isProfilePublic: json.is_profile_public ?? json.show_profile_publicly,
		donationLinks: json.donation_links?.map(mapDonationLink),
		showProfilePublicly: json.show_profile_publicly,
		notifyOnCommentReply: json.notify_on_comment_reply,
		notifyOnModerationDecision: json.notify_on_moderation_decision,
		notifyOnContentAction: json.notify_on_content_action,
		notifyOnCourseActivity: json.notify_on_course_activity,
		mutedNotificationTypes: json.muted_notification_types
			?.map((t) => NOTIFICATION_TYPE_MAP[t])
			.filter((t): t is Notification['type'] => t !== undefined)
	};
}

// ---- node governors -----------------------------------------------------------------------------

export interface RawNodeGovernorGrant {
	id: number;
	user: number;
	user_display_name: string;
	node_type: 'field' | 'course' | null; // null only if the underlying Field/Course row was since
	// hard-deleted (GenericForeignKey resolves to None) — not a realistic case for a real grant,
	// but the backend serializer method can genuinely return None, so this stays honest about it.
	node_id: string | null;
	node_label: string;
	granted_by: number | null;
	created_at: string;
}

export function mapNodeGovernorGrant(json: RawNodeGovernorGrant): NodeGovernorGrant {
	return {
		id: String(json.id),
		userId: String(json.user),
		userDisplayName: json.user_display_name,
		nodeType: json.node_type ?? 'course',
		nodeId: json.node_id ?? '',
		nodeLabel: json.node_label,
		grantedByUserId: json.granted_by !== null ? String(json.granted_by) : null,
		createdAt: json.created_at
	};
}

// ---- feature flags ------------------------------------------------------------------------------

export interface RawFeatureFlag {
	key: string;
	is_enabled: boolean;
	updated_at: string;
	updated_by_display_name: string | null;
}

export function mapFeatureFlag(json: RawFeatureFlag): FeatureFlag {
	return {
		key: json.key as FeatureFlag['key'],
		isEnabled: json.is_enabled,
		updatedAt: json.updated_at,
		updatedByDisplayName: json.updated_by_display_name
	};
}

// ---- tags -------------------------------------------------------------------------------------

export interface RawTagFollow {
	tag: string; // already the slug — TagFollowSerializer's own SlugRelatedField(slug_field='slug')
	notify: boolean;
}

export function mapTagFollow(json: RawTagFollow): TagFollowState {
	return { tag: json.tag, notify: json.notify };
}

// ---- notifications --------------------------------------------------------------------------------

export interface RawNotification {
	id: number;
	type: string; // backend's snake_case NOTIFICATION_TYPES key — mapped below
	actor: number | null;
	actor_display_name: string;
	target_label: string;
	exercise_id: number | null;
	material_id: number | null;
	taught_course_id: number | null;
	note: string;
	is_read: boolean;
	created_at: string;
}

export function mapNotification(json: RawNotification): Notification {
	return {
		id: String(json.id),
		type: NOTIFICATION_TYPE_MAP[json.type] ?? 'commentReply',
		actorId: json.actor !== null ? String(json.actor) : undefined,
		actorDisplayName: json.actor_display_name,
		targetLabel: json.target_label,
		exerciseId: json.exercise_id !== null ? String(json.exercise_id) : undefined,
		materialId: json.material_id !== null ? String(json.material_id) : undefined,
		taughtCourseId:
			json.taught_course_id !== null && json.taught_course_id !== undefined
				? String(json.taught_course_id)
				: undefined,
		note: json.note,
		isRead: json.is_read,
		createdAt: json.created_at
	};
}

// ---- services (tutoring listings) --------------------------------------------------------------

// Mirrors services/models.py's own DELIVERY_MODE_CHOICES. Snake_case on the wire, camelCase in
// this app's own types — the same small hand-maintained enum mirror (and the same honestly-flagged
// drift risk) as FRONTEND_TO_BACKEND_MATERIAL_TYPE and DONATION_PLATFORMS.
export const BACKEND_TO_FRONTEND_DELIVERY_MODE: Record<string, Service['deliveryMode']> = {
	online: 'online',
	in_person: 'inPerson',
	hybrid: 'hybrid'
};

export const FRONTEND_TO_BACKEND_DELIVERY_MODE: Record<Service['deliveryMode'], string> = {
	online: 'online',
	inPerson: 'in_person',
	hybrid: 'hybrid'
};

export interface RawService {
	id: number;
	provider_id: number;
	provider_username: string;
	provider_display_name: string;
	title: string;
	description: string;
	course_slugs: string[];
	hourly_rate: string | null; // DRF's DecimalField serializes as a string, not a JS number
	currency: string;
	is_active: boolean;
	delivery_mode: string;
	location_label: string;
	location_lat: string | null; // DRF DecimalField -> string, same as hourly_rate above
	location_lon: string | null;
	average_rating: number | null;
	review_count: number;
	created_at: string;
	updated_at: string;
}

export function mapService(json: RawService): Service {
	return {
		id: String(json.id),
		providerId: String(json.provider_id),
		providerUsername: json.provider_username,
		providerDisplayName: json.provider_display_name,
		title: json.title,
		description: json.description,
		courseIds: json.course_slugs,
		hourlyRate: json.hourly_rate !== null ? Number(json.hourly_rate) : null,
		currency: (json.currency as Service['currency']) || 'PLN',
		isActive: json.is_active,
		deliveryMode: BACKEND_TO_FRONTEND_DELIVERY_MODE[json.delivery_mode] ?? 'online',
		// Built only when BOTH coordinates are really present. A half-set location is not a location,
		// and leaving it undefined lets every consumer use one plain `{#if service.location}` instead
		// of separately null-checking two fields it would then have to keep in step.
		location:
			json.location_lat !== null && json.location_lon !== null
				? {
						label: json.location_label ?? '',
						lat: Number(json.location_lat),
						lon: Number(json.location_lon)
					}
				: undefined,
		averageRating: json.average_rating,
		reviewCount: json.review_count,
		createdAt: json.created_at,
		updatedAt: json.updated_at
	};
}

export interface RawServiceReview {
	id: number;
	service: number;
	author: number;
	author_display_name: string;
	rating: number;
	body: string;
	created_at: string;
}

export function mapServiceReview(json: RawServiceReview): ServiceReview {
	return {
		id: String(json.id),
		serviceId: String(json.service),
		userId: String(json.author),
		rating: json.rating,
		body: json.body || undefined,
		createdAt: json.created_at
	};
}

export interface RawServiceWatch {
	id: number;
	service: RawService;
	created_at: string;
}

export function mapServiceWatch(json: RawServiceWatch): ServiceWatch {
	return {
		id: String(json.id),
		service: mapService(json.service),
		createdAt: json.created_at
	};
}

// ---- messaging ------------------------------------------------------------------------------

export interface RawMessage {
	id: number;
	sender_id: number;
	sender_username: string;
	sender_display_name: string;
	recipient_id: number;
	recipient_username: string;
	recipient_display_name: string;
	subject: string;
	body: string;
	sent_at: string;
	read_at: string | null;
	is_read: boolean;
	parent_id: number | null;
	thread_id: number | null;
	replies_count: number;
}

export function mapMessage(json: RawMessage): Message {
	return {
		id: String(json.id),
		senderId: String(json.sender_id),
		senderUsername: json.sender_username,
		senderDisplayName: json.sender_display_name,
		recipientId: String(json.recipient_id),
		recipientUsername: json.recipient_username,
		recipientDisplayName: json.recipient_display_name,
		subject: json.subject,
		body: json.body,
		sentAt: json.sent_at,
		readAt: json.read_at,
		isRead: json.is_read,
		parentId: idOrUndefined(json.parent_id) ?? null,
		threadId: idOrUndefined(json.thread_id) ?? null,
		repliesCount: json.replies_count
	};
}
