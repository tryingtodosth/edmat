// Backend JSON -> frontend TS shape, one function per domain type. Kept in one file since several
// lib/services/*.ts functions need the SAME mapping (e.g. getExercisesForBranch/getTopRatedExercises/
// getRandomExercise all need "raw exercise JSON -> ResolvedExercise") — the "three strikes" extraction
// convention this codebase already follows elsewhere (see CLAUDE.md's Random Exercise feature note).
//
// id-format convention used throughout: Discipline/Branch ids are the backend's own slug (already a
// stable, human-readable string, and every URL on both sides already keys by it — no PK<->slug
// lookup ever needed). Every other id (Topic, Exercise, Review, Comment, User, ...) is the backend's
// numeric PK converted to a string via String(n) — opaque everywhere in this app (never parsed back
// into a number, never constructed by hand outside this file), so the specific format doesn't matter
// beyond "stable and unique," which a PK-as-string already is.

import type {
	AvailabilityException,
	AvailabilityRule,
	Booking,
	Comment,
	CommentTargetType,
	Branch,
	EffectiveWeek,
	ScheduleWindow,
	WeekApplyResult,
	WeekTemplate,
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
	Discipline,
	Material,
	MaterialCoverage,
	MaterialRequirement,
	MaterialReview,
	MaterialSubmission,
	MaterialType,
	Message,
	ModerationStatus,
	GovernableNodeKind,
	NodeGovernorGrant,
	Notification,
	ReportGroup,
	ReportKind,
	ResolvedExercise,
	Review,
	ScheduleEvent,
	Service,
	ServiceAvailability,
	ServiceReview,
	ServiceWatch,
	Subtopic,
	TaxonomyStatus,
	TagFollowState,
	TutorSchedule,
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

export interface RawDiscipline {
	id: number;
	slug: string;
	published: boolean;
	status: TaxonomyStatus;
	name: string;
	description: string;
}

export function mapDiscipline(json: RawDiscipline): Discipline {
	return {
		id: json.slug,
		name: json.name,
		description: json.description,
		published: json.published,
		status: json.status ?? 'approved'
	};
}

export interface RawTopic {
	id: number;
	slug: string;
	branch: number;
	order: number;
	name: string;
	status: TaxonomyStatus;
}

/** `branchId` is the frontend branch id (= slug) — the raw JSON's own `branch` field is a PK int,
 * not a slug, but a Topic is always resolved from a request already scoped to one known branch, so
 * the caller passes that branch's own id straight through rather than needing a second lookup. */
export function mapTopic(json: RawTopic, branchId: string): Topic {
	return {
		id: String(json.id),
		slug: json.slug,
		branchId,
		name: json.name,
		order: json.order,
		status: json.status ?? 'approved'
	};
}

export interface RawSubtopic {
	id: number;
	slug: string;
	topic: number;
	order: number;
	name: string;
}

/** Nested inside RawMaterialCoverage (below), same "no standalone list endpoint" treatment
 * mapTopic's own `branchId` parameter gets — `topicId` is passed straight through from the
 * enclosing coverage row rather than re-derived from `json.topic` (a bare PK with no branch
 * context of its own to compose an id from, unlike mapTopic's `branchId` which the caller already
 * has in hand). */
export function mapSubtopic(json: RawSubtopic, topicId: string): Subtopic {
	return { id: String(json.id), slug: json.slug, topicId, name: json.name, order: json.order };
}

export interface RawBranch {
	id: number;
	slug: string;
	discipline: string; // already the discipline's own slug (backend SlugRelatedField)
	published: boolean;
	status: TaxonomyStatus;
	order: number;
	name: string;
	description: string;
	topics: RawTopic[];
}

export function mapBranch(json: RawBranch): Branch {
	return {
		id: json.slug,
		disciplineId: json.discipline,
		name: json.name,
		description: json.description,
		published: json.published,
		status: json.status ?? 'approved',
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
	branch: number;
	branch_slug: string;
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
 * shape (used for branch/top-rated/recent listings, where nothing reads them) skips them entirely
 * rather than paying that cost for every exercise in a 383-item branch listing. */
export interface RawExerciseDetail extends RawExerciseCommon {
	statement: string;
	hint: string;
	answer: string;
	solution: string;
	translated_by: number | null;
	available_locales: string[];
	requirements: RawExerciseRequirement[];
	contributors: RawExerciseContributor[];
}

export interface RawExerciseContributor {
	id: number;
	display_name: string;
	role: 'submitted' | 'translated' | 'reviewed';
	locale: string | null;
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
		branchId: json.branch_slug,
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

/** Used by list endpoints (branch/exercises, top-rated, recent, random) — `statement`/`hint`/
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
		// Empty on the list shape for the same reason `requirements` is: a card never credits anybody,
		// and resolving contributors for all 383 exercises in a branch listing would be paid for
		// nothing. Empty here means "not asked for", not "nobody worked on it".
		requirements: [],
		contributors: []
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
		requirements: (json.requirements ?? []).map(mapExerciseRequirement),
		// Names come resolved from the API rather than as bare ids the page then fetches one by one —
		// that was a real N+1 over the network on a page that already knows it needs every one.
		contributors: (json.contributors ?? []).map((c) => ({
			id: String(c.id),
			displayName: c.display_name,
			role: c.role,
			locale: c.locale ?? undefined
		}))
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

export interface RawMaterialType {
	id: number;
	slug: string;
	order: number;
	status: 'pending' | 'approved';
	name: string;
}

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
/** Callers should use `toBackendMaterialType` rather than indexing this directly — a proposed
 * type is absent from it and is already a backend slug. */
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
	// Exactly one of these: `material` from /materials, `course` from /courses/{id}/claims/,
	// `exercise` from /exercises/{id}/claims/.
	material?: number;
	course?: number;
	exercise?: number;
	kind: 'covers' | 'requires';
	topic: RawTopic;
	subtopic: RawSubtopic | null;
	level: number;
	proposed_by: number | null;
	created_at: string;
	vote_summary: RawCoverageVoteSummary;
	importance_summary: RawCoverageVoteSummary;
	comment_count: number;
}

export function mapMaterialCoverage(json: RawMaterialCoverage): MaterialCoverage {
	const topicId = String(json.topic.id);
	return {
		id: String(json.id),
		ownerKind:
			json.course !== undefined ? 'course' : json.exercise !== undefined ? 'exercise' : 'material',
		ownerId: String(json.course ?? json.exercise ?? json.material),
		kind: json.kind,
		topicId,
		topicName: json.topic.name,
		subtopicId: json.subtopic ? String(json.subtopic.id) : undefined,
		subtopicName: json.subtopic?.name,
		level: json.level,
		proposedByUserId: idOrUndefined(json.proposed_by),
		createdAt: json.created_at,
		voteSummary: mapVoteSummary(json.vote_summary),
		importanceSummary: mapVoteSummary(json.importance_summary),
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
	branch: number;
	branch_slug: string;
	slug: string;
	type: string;
	coverage: RawMaterialCoverage[];
	requirements: RawMaterialRequirement[];
	file: string | null;
	url?: string | null;
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
		branchId: json.branch_slug,
		slug: json.slug,
		// A proposed type has no camelCase alias, so it passes through as its own slug. This used
		// to be `?? 'other'`, which was right while the set was closed and became a silent lie the
		// moment it was not: a material filed under a brand-new kind would have displayed as Other.
		type: BACKEND_TO_FRONTEND_MATERIAL_TYPE[json.type] ?? json.type,
		title: json.title,
		description: json.description,
		coverage: json.coverage.map(mapMaterialCoverage),
		requirements: (json.requirements ?? []).map(mapMaterialRequirement),
		fileName: fileUrl ? (fileUrl.split('/').pop() ?? fileUrl) : '',
		fileUrl,
		// Where a link-only material lives. Distinct from `sourceUrl` below, which is provenance:
		// a hosted file can have a source, and a link has no file to have come from anywhere.
		url: json.url || undefined,
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
	reply_count: number;
}

export function mapMaterialReview(json: RawMaterialReview): MaterialReview {
	return {
		id: String(json.id),
		materialId: String(json.material),
		userId: String(json.author),
		rating: json.rating,
		body: json.body || undefined,
		createdAt: json.created_at,
		replyCount: json.reply_count
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
	reply_count: number;
}

export function mapReview(json: RawReview): Review {
	return {
		id: String(json.id),
		exerciseId: String(json.exercise),
		userId: String(json.author),
		rating: json.rating,
		body: undefinedIfEmpty(json.body),
		createdAt: json.created_at,
		replyCount: json.reply_count
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
	is_edited: boolean;
	removed_by_author: boolean;
	upvotes: number;
	downvotes: number;
	score: number;
	current_user_vote: number | null;
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
		isAutoHidden: json.is_auto_hidden,
		isEdited: json.is_edited,
		removedByAuthor: json.removed_by_author,
		upvotes: json.upvotes,
		downvotes: json.downvotes,
		score: json.score,
		currentUserVote: (json.current_user_vote ?? undefined) as Comment['currentUserVote']
	};
}

// ---- moderation -------------------------------------------------------------------------------

export interface RawExerciseSubmission {
	id: number;
	branch: string; // slug (SlugRelatedField)
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
		branchId: json.branch,
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
	branch: string; // slug (SlugRelatedField), same convention as RawExerciseSubmission.branch
	submitted_by: number;
	type: string;
	title: string;
	description: string;
	locale: string;
	file: string | null;
	url?: string | null;
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
		branchId: json.branch,
		submittedByUserId: String(json.submitted_by),
		// A proposed type has no camelCase alias, so it passes through as its own slug. This used
		// to be `?? 'other'`, which was right while the set was closed and became a silent lie the
		// moment it was not: a material filed under a brand-new kind would have displayed as Other.
		type: BACKEND_TO_FRONTEND_MATERIAL_TYPE[json.type] ?? json.type,
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
	course_new_post: 'courseNewPost',
	booking_requested: 'bookingRequested',
	booking_confirmed: 'bookingConfirmed',
	booking_declined: 'bookingDeclined',
	booking_cancelled: 'bookingCancelled',
	event_attendance: 'eventAttendance',
	event_updated: 'eventUpdated',
	event_cancelled: 'eventCancelled',
	course_contribution_submitted: 'courseContributionSubmitted',
	course_contribution_approved: 'courseContributionApproved',
	course_contribution_rejected: 'courseContributionRejected',
	course_staff_added: 'courseStaffAdded',
	course_invite_used: 'courseInviteUsed',
	material_submission_approved: 'materialSubmissionApproved',
	material_submission_rejected: 'materialSubmissionRejected',
	taxonomy_approved: 'taxonomyApproved',
	taxonomy_merged: 'taxonomyMerged',
	taxonomy_moved: 'taxonomyMoved',
	taxonomy_rejected: 'taxonomyRejected'
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
	time_format?: string;
	week_starts_on?: string;
	save_menu_layout?: string;
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
	notify_on_booking?: boolean;
	notify_on_event?: boolean;
	muted_notification_types?: string[]; // snake_case type strings — converted below
	donation_links?: RawDonationLink[];
	// Always present on BOTH /auth/me/ and /users/{id}/ — accounts/serializers.py's
	// ProfileSerializer/PublicProfileSerializer both include these unconditionally, regardless of
	// show_profile_publicly (opting in to tutoring is itself the point of setting it).
	offers_tutoring: boolean;
	tutoring_note: string;
	exercises_published_count?: number;
	exercises_private_count?: number | null;
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
		exercisesPublishedCount: json.exercises_published_count ?? 0,
		exercisesPrivateCount: json.exercises_private_count,
		isProfilePublic: json.is_profile_public ?? json.show_profile_publicly,
		donationLinks: json.donation_links?.map(mapDonationLink),
		showProfilePublicly: json.show_profile_publicly,
		notifyOnCommentReply: json.notify_on_comment_reply,
		notifyOnModerationDecision: json.notify_on_moderation_decision,
		notifyOnContentAction: json.notify_on_content_action,
		// Anything unrecognised falls back to the app's own defaults rather than to whatever the
		// browser would pick — same reasoning as the fields themselves.
		timeFormat: json.time_format === '12h' ? '12h' : '24h',
		weekStartsOn: json.week_starts_on === 'sunday' ? 'sunday' : 'monday',
		saveMenuLayout: json.save_menu_layout === 'above' ? 'above' : 'beside',
		notifyOnCourseActivity: json.notify_on_course_activity,
		notifyOnBooking: json.notify_on_booking,
		notifyOnEvent: json.notify_on_event,
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
	node_type: GovernableNodeKind | null; // null only if the underlying Discipline/Branch row was since
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
		nodeType: json.node_type ?? 'branch',
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
	course_id: number | null;
	event_id: number | null;
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
		courseId:
			json.course_id !== null && json.course_id !== undefined ? String(json.course_id) : undefined,
		eventId:
			json.event_id !== null && json.event_id !== undefined ? String(json.event_id) : undefined,
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
	branch_slugs: string[];
	hourly_rate: string | null; // DRF's DecimalField serializes as a string, not a JS number
	currency: string;
	is_active: boolean;
	delivery_mode: string;
	location_label: string;
	location_lat: string | null; // DRF DecimalField -> string, same as hourly_rate above
	location_lon: string | null;
	availability_mode: string;
	session_minutes: number;
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
		branchIds: json.branch_slugs,
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
		// Anything unrecognised falls back to `derived`, matching the backend default and the safer
		// of the two: `derived` shows less than it might, whereas a wrongly-assumed `declared` would
		// tell a student an hour is on offer when it has already gone.
		availabilityMode: json.availability_mode === 'declared' ? 'declared' : 'derived',
		sessionMinutes: json.session_minutes ?? 60,
		averageRating: json.average_rating,
		reviewCount: json.review_count,
		createdAt: json.created_at,
		updatedAt: json.updated_at
	};
}

// ---- booking ----------------------------------------------------------------------------------

export interface RawAvailabilityRule {
	id: number;
	service: number | null;
	weekday: number;
	start_time: string;
	end_time: string;
}

export function mapAvailabilityRule(json: RawAvailabilityRule): AvailabilityRule {
	return {
		id: String(json.id),
		serviceId: json.service !== null ? String(json.service) : undefined,
		weekday: json.weekday,
		// Django serializes a TimeField as 'HH:MM:SS'. Every input and label in this feature works in
		// 'HH:MM', so the seconds are dropped once here rather than at each of those sites.
		startTime: json.start_time.slice(0, 5),
		endTime: json.end_time.slice(0, 5)
	};
}

export interface RawScheduleWindow {
	weekday: number;
	start_time: string;
	end_time: string;
	service: number | null;
}

export function mapScheduleWindow(json: RawScheduleWindow): ScheduleWindow {
	return {
		weekday: json.weekday,
		// Django serializes a TimeField as 'HH:MM:SS' from a ModelSerializer and as 'HH:MM' from the
		// week endpoint's own hand-built payload. `slice(0, 5)` is right for both, which is why it is
		// done here rather than being assumed either way at the call sites.
		startTime: json.start_time.slice(0, 5),
		endTime: json.end_time.slice(0, 5),
		serviceId: json.service !== null ? String(json.service) : undefined
	};
}

/** The wire shape a window is WRITTEN in. Separate from the read mapper because `service` is omitted
 * rather than sent as null when absent, and because the backend rejects seconds it never asked for. */
export function scheduleWindowToRaw(window: ScheduleWindow): Record<string, unknown> {
	return {
		weekday: window.weekday,
		start_time: window.startTime,
		end_time: window.endTime,
		service: window.serviceId ? Number(window.serviceId) : null
	};
}

export interface RawWeekTemplate {
	id: number;
	name: string;
	windows: RawScheduleWindow[];
}

export function mapWeekTemplate(json: RawWeekTemplate): WeekTemplate {
	return {
		id: String(json.id),
		name: json.name,
		windows: (json.windows ?? []).map(mapScheduleWindow)
	};
}

export interface RawEffectiveWeek {
	/** Null for a week that is only following the repeating pattern — there is no stored row, which
	 * is exactly what `detached: false` means. */
	id: number | null;
	week_start: string;
	detached: boolean;
	source_template: number | null;
	source_template_name: string;
	windows: RawScheduleWindow[];
}

export function mapEffectiveWeek(json: RawEffectiveWeek): EffectiveWeek {
	return {
		id: json.id !== null && json.id !== undefined ? String(json.id) : undefined,
		weekStart: json.week_start,
		detached: json.detached,
		sourceTemplateId: json.source_template !== null ? String(json.source_template) : undefined,
		sourceTemplateName: json.source_template_name ?? '',
		windows: (json.windows ?? []).map(mapScheduleWindow)
	};
}

export interface RawWeekApplyResult {
	written: string[];
	skipped: string[];
}

export function mapWeekApplyResult(json: RawWeekApplyResult): WeekApplyResult {
	return { written: json.written ?? [], skipped: json.skipped ?? [] };
}

export interface RawAvailabilityException {
	id: number;
	date: string;
	kind: string;
	start_time: string | null;
	end_time: string | null;
	note: string;
}

export function mapAvailabilityException(json: RawAvailabilityException): AvailabilityException {
	return {
		id: String(json.id),
		date: json.date,
		kind: json.kind === 'open' ? 'open' : 'block',
		startTime: json.start_time ? json.start_time.slice(0, 5) : undefined,
		endTime: json.end_time ? json.end_time.slice(0, 5) : undefined,
		note: json.note ?? ''
	};
}

export interface RawServiceAvailability {
	service: number;
	availability_mode: string;
	session_minutes: number;
	has_schedule: boolean;
	days: { date: string; slots: { start: string; end: string }[] }[];
}

export function mapServiceAvailability(json: RawServiceAvailability): ServiceAvailability {
	return {
		serviceId: String(json.service),
		mode: json.availability_mode === 'declared' ? 'declared' : 'derived',
		sessionMinutes: json.session_minutes,
		hasSchedule: json.has_schedule,
		days: json.days.map((day) => ({ date: day.date, slots: day.slots }))
	};
}

export interface RawBooking {
	id: number;
	service: number;
	service_title: string;
	availability_mode: string;
	tutor: number;
	tutor_display_name: string;
	student: number;
	student_display_name: string;
	starts_at: string;
	ends_at: string;
	status: string;
	student_note: string;
	tutor_note: string;
	cancelled_by: number | null;
	overlapping_count: number;
	created_at: string;
}

export interface RawTutorSchedule {
	days: { date: string; windows: { start: string; end: string }[] }[];
	bookings: RawBooking[];
	// Added when events started feeding this endpoint. Optional on the wire, and defaulted below, so
	// a frontend deployed ahead of the backend renders a calendar without events rather than throwing
	// on `undefined.map`.
	events?: {
		id: number;
		title: string;
		starts_at: string;
		ends_at: string;
		status: string;
		location_kind: string;
		is_host: boolean;
	}[];
}

export function mapTutorSchedule(json: RawTutorSchedule): TutorSchedule {
	return {
		days: json.days.map((day) => ({ date: day.date, windows: day.windows })),
		bookings: json.bookings.map(mapBooking),
		events: (json.events ?? []).map((event) => ({
			id: String(event.id),
			title: event.title,
			startsAt: event.starts_at,
			endsAt: event.ends_at,
			status: event.status as ScheduleEvent['status'],
			locationKind: event.location_kind as ScheduleEvent['locationKind'],
			isHost: event.is_host
		}))
	};
}

export function mapBooking(json: RawBooking): Booking {
	return {
		id: String(json.id),
		serviceId: String(json.service),
		serviceTitle: json.service_title,
		availabilityMode: json.availability_mode === 'declared' ? 'declared' : 'derived',
		tutorId: String(json.tutor),
		tutorDisplayName: json.tutor_display_name,
		studentId: String(json.student),
		studentDisplayName: json.student_display_name,
		startsAt: json.starts_at,
		endsAt: json.ends_at,
		status: json.status as Booking['status'],
		studentNote: json.student_note ?? '',
		tutorNote: json.tutor_note ?? '',
		cancelledById: json.cancelled_by !== null ? String(json.cancelled_by) : undefined,
		overlappingCount: json.overlapping_count ?? 0,
		createdAt: json.created_at
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
	reply_count: number;
}

export function mapServiceReview(json: RawServiceReview): ServiceReview {
	return {
		id: String(json.id),
		serviceId: String(json.service),
		userId: String(json.author),
		rating: json.rating,
		body: json.body || undefined,
		createdAt: json.created_at,
		replyCount: json.reply_count
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
