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
	CommentRevision,
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
	SolutionEntry,
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
import type { Gallery, GalleryImage, GalleryTargetType } from '$lib/types/gallery';
import type {
	GovernorApplication,
	GovernorApplicationStatus,
	GovernorNodeKind
} from '$lib/types/governorApplication';
import type { Issue } from '$lib/types/issue';
import type { LegalNotice, LegalNoticeContentPreview } from '$lib/types/legalNotice';

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
	audience: Exercise['audience'];
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
	answer: string;
	entries: RawSolutionEntry[];
	translated_by: number | null;
	available_locales: string[];
	requirements: RawExerciseRequirement[];
	contributors: RawExerciseContributor[];
}

export interface RawSolutionEntry {
	id: number;
	exercise: number;
	kind: 'hint' | 'solution';
	locale: string;
	body: string;
	author: number | null;
	author_display_name: string;
	status: 'published' | 'pending' | 'rejected';
	pinned: boolean;
	is_removed: boolean;
	auto_hidden_at: string | null;
	reviewed_by: number | null;
	review_note: string;
	vote_summary: RawCoverageVoteSummary;
	comment_count: number;
	created_at: string;
}

export function mapSolutionEntry(json: RawSolutionEntry): SolutionEntry {
	return {
		id: String(json.id),
		exerciseId: String(json.exercise),
		kind: json.kind,
		locale: json.locale,
		body: json.body,
		authorId: idOrUndefined(json.author),
		authorDisplayName: json.author_display_name,
		status: json.status,
		pinned: json.pinned,
		isRemoved: json.is_removed,
		autoHiddenAt: json.auto_hidden_at ?? undefined,
		reviewedByUserId: idOrUndefined(json.reviewed_by),
		reviewNote: json.review_note,
		voteSummary: mapVoteSummary(json.vote_summary),
		commentCount: json.comment_count,
		createdAt: json.created_at
	};
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
		audience: json.audience ?? 'university',
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
		answer: '',
		entries: [],
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
		answer: json.answer,
		entries: (json.entries ?? []).map(mapSolutionEntry),
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
	answer: string;
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
		answer: json.answer,
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

/** A real, found-live bug this function closes: the since-retired `submitMaterial` used to index
 * `FRONTEND_TO_BACKEND_MATERIAL_TYPE` directly with `?? 'other'` — so a freshly PROPOSED type
 * (submit-material's own "Other…" flow resolves one to a real, brand-new slug before submitting)
 * was never in that fixed 13-entry map, and every such submission silently filed as the generic
 * `other` instead of the type the submitter actually named. A proposed type's slug IS ALREADY the
 * backend's own value — it needs no translation at all, only a builtin frontend-side name (e.g.
 * `'examCollection'`) does. Falling back to the value itself (not to `'other'`) is what makes that
 * correct for both cases with one function. */
export function toBackendMaterialType(type: MaterialType): string {
	return FRONTEND_TO_BACKEND_MATERIAL_TYPE[type] ?? type;
}

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
	audience?: string;
	coverage: RawMaterialCoverage[];
	requirements: RawMaterialRequirement[];
	file: string | null;
	url?: string | null;
	// The third payload kind (coauthoring/), plus where the bytes came from and whether the
	// translation being read has fallen behind the published version. All three optional: a backend
	// older than COAUTHORING-BRIEF.md's own migrations sends none of them, and every read site here
	// must keep working when it does.
	body?: string | null;
	project_id?: number | string | null;
	translation_stale?: boolean;
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
		audience: (json.audience ?? 'university') as Material['audience'],
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
		// The third kind: the material written here rather than uploaded or linked. `|| undefined`
		// for the same reason `url` uses it — an empty string is what the backend stores for "this
		// material is not that kind", and a blank `body` that is nonetheless present would put an
		// empty prose block on the detail page.
		body: json.body || undefined,
		// Spelled out rather than `idOrUndefined`, which is typed for the ids that only ever arrive
		// as numbers; this one is null until the project's first publication materialises a
		// `Material`, and `!= null` catches undefined from an older backend in the same test.
		projectId: json.project_id != null ? String(json.project_id) : undefined,
		translationStale: json.translation_stale || undefined,
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
	attachments?: {
		id: number;
		kind: 'image' | 'pdf';
		url: string;
		original_name: string;
		size_bytes: number;
	}[];
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
		attachments: (json.attachments ?? []).map((a) => ({
			id: String(a.id),
			kind: a.kind,
			url: a.url,
			originalName: a.original_name,
			sizeBytes: a.size_bytes
		})),
		isAutoHidden: json.is_auto_hidden,
		isEdited: json.is_edited,
		removedByAuthor: json.removed_by_author,
		upvotes: json.upvotes,
		downvotes: json.downvotes,
		score: json.score,
		currentUserVote: (json.current_user_vote ?? undefined) as Comment['currentUserVote']
	};
}

export interface RawCommentRevision {
	id: number;
	created_at: string;
	edited_by_display_name: string;
	body: string | null;
	is_hidden_by_moderator: boolean;
	is_sealed: boolean;
}

export function mapCommentRevision(json: RawCommentRevision): CommentRevision {
	return {
		id: String(json.id),
		createdAt: json.created_at,
		editedByDisplayName: json.edited_by_display_name,
		body: json.body,
		isHiddenByModerator: json.is_hidden_by_moderator,
		isSealed: json.is_sealed
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

export interface RawEditSuggestion {
	id: number;
	exercise: number;
	locale: string;
	field: EditSuggestion['field'];
	entry: number | null;
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
		entryId: idOrUndefined(json.entry),
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
	audience?: string;
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
		audience: (json.audience ?? 'university') as ExerciseSet['audience'],
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
	solution_entry_approved: 'solutionEntryApproved',
	solution_entry_rejected: 'solutionEntryRejected',
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
	session_changed: 'sessionChanged',
	registration_confirmed: 'registrationConfirmed',
	registration_waitlisted: 'registrationWaitlisted',
	registration_promoted: 'registrationPromoted',
	registration_declined: 'registrationDeclined',
	contribution_submitted: 'contributionSubmitted',
	contribution_decided: 'contributionDecided',
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
	taxonomy_rejected: 'taxonomyRejected',
	issue_status_changed: 'issueStatusChanged',
	legal_notice_decided: 'legalNoticeDecided',
	// `event_posted` has existed backend-side since the event-updates feature and was never added
	// here, so every "the host wrote an update" notification fell through the `?? 'commentReply'`
	// fallback below and rendered as a reply to a comment. The type union, the category map and the
	// card all already knew about it — only this table did not, which is exactly the kind of
	// four-file drift this map's own doc comment exists to warn about.
	event_posted: 'eventPosted',
	governor_application_submitted: 'governorApplicationSubmitted',
	governor_application_decided: 'governorApplicationDecided',
	material_version_proposed: 'materialVersionProposed',
	material_version_decided: 'materialVersionDecided',
	material_version_published: 'materialVersionPublished',
	project_invite_used: 'projectInviteUsed',
	project_member_added: 'projectMemberAdded',
	project_join_requested: 'projectJoinRequested',
	project_join_decided: 'projectJoinDecided',
	// Concepts (concepts/, notifications/models.py). Three types, three arms in the card.
	concept_revision_pending: 'conceptRevisionPending',
	concept_revision_decided: 'conceptRevisionDecided',
	concept_revision_published: 'conceptRevisionPublished'
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
	audience_filter?: string[];
	content_locales?: string[];
	editor_mode?: string;
	text_size?: string;
	high_contrast?: boolean;
	is_verified_contributor: boolean;
	is_minor?: boolean;
	guardian_of?: { id: number; username: string; display_name: string }[];
	guardians?: { id: number; display_name: string }[];
	is_moderator: boolean;
	is_superuser?: boolean; // present on /auth/me/ only
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
		isSuperuser: json.is_superuser,
		isNodeGovernor: json.is_node_governor,
		preferredLocale: json.preferred_locale,
		offersTutoring: json.offers_tutoring,
		isMinor: json.is_minor ?? false,
		guardianOf: (json.guardian_of ?? []).map((c) => ({
			id: String(c.id),
			username: c.username,
			displayName: c.display_name
		})),
		guardians: (json.guardians ?? []).map((g) => ({
			id: String(g.id),
			displayName: g.display_name
		})),
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
		audienceFilter: (json.audience_filter ?? []) as User['audienceFilter'],
		contentLocales: json.content_locales ?? [],
		editorMode: json.editor_mode === 'rich' ? 'rich' : 'source',
		textSize: json.text_size === 'large' || json.text_size === 'larger' ? json.text_size : 'normal',
		highContrast: json.high_contrast ?? false,
		notifyOnCourseActivity: json.notify_on_course_activity,
		notifyOnBooking: json.notify_on_booking,
		notifyOnEvent: json.notify_on_event,
		mutedNotificationTypes: json.muted_notification_types
			?.map((t) => NOTIFICATION_TYPE_MAP[t])
			.filter((t): t is Notification['type'] => t !== undefined)
	};
}

// ---- issues -----------------------------------------------------------------------------------

export interface RawIssue {
	id: number;
	kind: Issue['kind'];
	title: string;
	body: string;
	context: Record<string, string>;
	reporter: number | null;
	reporter_display_name: string;
	contact_email: string;
	is_public: boolean;
	status: Issue['status'];
	staff_note: string;
	comment_count: number;
	created_at: string;
	updated_at: string;
}

export function mapIssue(json: RawIssue): Issue {
	return {
		id: String(json.id),
		kind: json.kind,
		title: json.title,
		body: json.body,
		context: {
			path: json.context?.path,
			pageTitle: json.context?.page_title,
			locale: json.context?.locale,
			viewport: json.context?.viewport,
			userAgent: json.context?.user_agent
		},
		reporterId: json.reporter !== null ? String(json.reporter) : undefined,
		reporterDisplayName: json.reporter_display_name,
		contactEmail: json.contact_email,
		isPublic: json.is_public,
		status: json.status,
		staffNote: json.staff_note,
		commentCount: json.comment_count ?? 0,
		createdAt: json.created_at,
		updatedAt: json.updated_at
	};
}

// ---- legal notices (DSA Art. 16) -----------------------------------------------------------------

export interface RawLegalNotice {
	id: number;
	content_url: string;
	explanation: string;
	good_faith_confirmed: boolean;
	notifier_name: string;
	contact_email: string;
	reporter: number | null;
	status: LegalNotice['status'];
	content_kind: string;
	content_object_id: number | null;
	resolve_note: string;
	created_at: string;
	updated_at: string;
}

export function mapLegalNotice(json: RawLegalNotice): LegalNotice {
	return {
		id: String(json.id),
		contentUrl: json.content_url,
		explanation: json.explanation,
		goodFaithConfirmed: json.good_faith_confirmed,
		notifierName: json.notifier_name,
		contactEmail: json.contact_email,
		reporterId: json.reporter !== null ? String(json.reporter) : undefined,
		status: json.status,
		contentKind: json.content_kind,
		contentObjectId: json.content_object_id ?? undefined,
		resolveNote: json.resolve_note,
		createdAt: json.created_at,
		updatedAt: json.updated_at
	};
}

export interface RawLegalNoticeContentPreview {
	preview: string;
	author_id: number | null;
	author_display_name: string;
}

export function mapLegalNoticeContentPreview(
	json: RawLegalNoticeContentPreview
): LegalNoticeContentPreview {
	return {
		preview: json.preview,
		authorId: json.author_id !== null ? String(json.author_id) : undefined,
		authorDisplayName: json.author_display_name
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
	post_id?: number | null;
	issue_id?: number | null;
	// The co-authoring FK, added after the rest of this shape existed — optional so that a backend
	// without it sends nothing rather than this mapper reading `undefined` as a real absence.
	material_project?: number | null;
	// The concept FK, as its slug. Optional for the same reason `material_project` is: a backend
	// that does not send it yet must read as "nothing here", not as a field this mapper can rely
	// on. `concept` (the numeric pk) is deliberately NOT read — `/concepts/[slug]` cannot be built
	// from a pk, so a card would have nowhere to go with it.
	concept_slug?: string | null;
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
		postId: json.post_id !== null && json.post_id !== undefined ? String(json.post_id) : undefined,
		issueId:
			json.issue_id !== null && json.issue_id !== undefined ? String(json.issue_id) : undefined,
		materialProjectId: idOrUndefined(json.material_project),
		conceptSlug: json.concept_slug ?? undefined,
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
	audience?: string;
	language?: string;
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
		audience: (json.audience ?? 'university') as Service['audience'],
		language: json.language ?? 'pl',
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
	body_unavailable: boolean;
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
		bodyUnavailable: Boolean(json.body_unavailable),
		sentAt: json.sent_at,
		readAt: json.read_at,
		isRead: json.is_read,
		parentId: idOrUndefined(json.parent_id) ?? null,
		threadId: idOrUndefined(json.thread_id) ?? null,
		repliesCount: json.replies_count
	};
}

// ---- galleries (backend/galleries/) -------------------------------------------------------------

export interface RawGalleryImage {
	id: number;
	url: string;
	caption: string;
	order: number;
	width: number;
	height: number;
	size_bytes: number;
	original_name: string;
	uploaded_by: number | null;
	uploaded_by_display_name: string;
	can_edit: boolean;
}

export interface RawGallery {
	id: number | null;
	target_type: string;
	target_id: number;
	images: RawGalleryImage[];
	can_curate: boolean;
	can_add: boolean;
}

export function mapGalleryImage(json: RawGalleryImage): GalleryImage {
	return {
		id: String(json.id),
		url: json.url,
		caption: json.caption ?? '',
		order: json.order ?? 0,
		width: json.width ?? 0,
		height: json.height ?? 0,
		sizeBytes: json.size_bytes ?? 0,
		originalName: json.original_name ?? '',
		uploadedByUserId: idOrUndefined(json.uploaded_by) ?? null,
		uploadedByDisplayName: json.uploaded_by_display_name ?? '',
		canEdit: Boolean(json.can_edit)
	};
}

export function mapGallery(json: RawGallery): Gallery {
	return {
		id: json.id === null ? null : String(json.id),
		targetType: json.target_type as GalleryTargetType,
		targetId: String(json.target_id),
		images: (json.images ?? []).map(mapGalleryImage),
		canCurate: Boolean(json.can_curate),
		canAdd: Boolean(json.can_add)
	};
}

// ---- governor applications (backend/moderation/applications.py) ---------------------------------

export interface RawGovernorApplication {
	id: number;
	applicant: number;
	applicant_display_name: string;
	kind: string;
	node_label: string;
	node_ref: string | number | null;
	statement: string;
	status: string;
	queue_position: number | null;
	decision_note: string;
	decided_by_display_name: string;
	decided_at: string | null;
	created_at: string;
}

export function mapGovernorApplication(json: RawGovernorApplication): GovernorApplication {
	return {
		id: String(json.id),
		applicantUserId: String(json.applicant),
		applicantDisplayName: json.applicant_display_name ?? '',
		kind: json.kind as GovernorNodeKind,
		nodeLabel: json.node_label ?? '',
		nodeRef: json.node_ref === null || json.node_ref === undefined ? '' : String(json.node_ref),
		statement: json.statement ?? '',
		status: json.status as GovernorApplicationStatus,
		queuePosition: json.queue_position ?? null,
		decisionNote: json.decision_note ?? '',
		decidedByDisplayName: json.decided_by_display_name ?? '',
		decidedAt: json.decided_at ?? null,
		createdAt: json.created_at
	};
}

// ---- co-authoring: projects, versions, members, invites, join requests --------------------------
// (backend/coauthoring/, COAUTHORING-BRIEF.md §5 — the serializer shapes are quoted there field for
// field). Appended as one self-contained block with its own import, so nothing above had to move.
//
// Two conventions worth restating here because this block leans on both: every id is `String(pk)`,
// and a nullable id becomes `null` rather than `undefined` (the raw JSON's own absence is not a
// third state — `decided_by` on an undecided row means "nobody has", and a component renders that).

import type {
	JoinBlockReason,
	JoinRequestStatus,
	MaterialProject,
	MaterialVersion,
	MaterialVersionKind,
	MaterialVersionQueueRow,
	MaterialVersionStatus,
	MaterialVersionSummary,
	ProjectCoverageDraft,
	ProjectInvite,
	ProjectInvitePreview,
	ProjectJoinRequest,
	ProjectMember,
	ProjectMemberRole,
	ProjectInviteUnusableReason,
	ProposeBlockReason,
	VersionScanStatus
} from '$lib/types/materialProject';

interface RawProjectCoverage {
	topic_id: number | string;
	level: number;
	kind?: string;
}

function mapProjectCoverage(json: RawProjectCoverage): ProjectCoverageDraft {
	return {
		topicId: String(json.topic_id),
		level: json.level,
		// A catalogue coverage row written before the covers/requires split (or by a caller that
		// only ever meant "covers") has no kind; `covers` is what such a row has always meant.
		kind: json.kind === 'requires' ? 'requires' : 'covers'
	};
}

/** `file_name` is served beside `file_url`, but a row whose blob was reclaimed has neither — and a
 *  URL is still the honest fallback for a name, the same derivation `mapMaterial` already uses. */
function fileNameFrom(fileUrl: string, given?: string | null): string {
	if (given) return given;
	return fileUrl ? (fileUrl.split('/').pop() ?? fileUrl) : '';
}

export interface RawProjectMember {
	user_id: number;
	display_name: string;
	role: string;
	added_at: string;
}

export function mapProjectMember(json: RawProjectMember): ProjectMember {
	return {
		userId: String(json.user_id),
		displayName: json.display_name ?? '',
		role: (json.role ?? 'coauthor') as ProjectMemberRole,
		addedAt: json.added_at
	};
}

export interface RawMaterialVersionSummary {
	id: number;
	number: number;
	status: string;
	kind: string;
	title: string;
	change_note?: string;
	created_by_id: number | null;
	created_by_display_name?: string;
	created_at: string;
	published_at: string | null;
	file_url?: string | null;
	file_name?: string | null;
	url?: string | null;
	scan_status?: string;
}

export function mapMaterialVersionSummary(json: RawMaterialVersionSummary): MaterialVersionSummary {
	const fileUrl = json.file_url ?? '';
	return {
		id: String(json.id),
		number: json.number,
		status: json.status as MaterialVersionStatus,
		kind: json.kind as MaterialVersionKind,
		title: json.title ?? '',
		changeNote: json.change_note ?? '',
		createdByUserId: idOrUndefined(json.created_by_id) ?? null,
		createdByDisplayName: json.created_by_display_name ?? '',
		createdAt: json.created_at,
		publishedAt: json.published_at ?? null,
		fileUrl,
		fileName: fileNameFrom(fileUrl, json.file_name),
		url: json.url ?? '',
		scanStatus: (json.scan_status ?? 'skipped') as VersionScanStatus
	};
}

export interface RawMaterialVersion extends RawMaterialVersionSummary {
	project_id: number;
	material_id: number | null;
	body?: string;
	description?: string;
	based_on_id: number | null;
	decided_by_id: number | null;
	decided_by_display_name?: string;
	decided_at: string | null;
	decision_note?: string;
	scan_detail?: string;
	file_size?: number;
	comment_count?: number;
	can_publish?: boolean;
	can_decide?: boolean;
	can_withdraw?: boolean;
}

export function mapMaterialVersion(json: RawMaterialVersion): MaterialVersion {
	const summary = mapMaterialVersionSummary(json);
	return {
		...summary,
		projectId: String(json.project_id),
		materialId: idOrUndefined(json.material_id) ?? null,
		body: json.body ?? '',
		description: json.description ?? '',
		basedOnId: idOrUndefined(json.based_on_id) ?? null,
		decidedByUserId: idOrUndefined(json.decided_by_id) ?? null,
		decidedByDisplayName: json.decided_by_display_name ?? '',
		decidedAt: json.decided_at ?? null,
		decisionNote: json.decision_note ?? '',
		scanDetail: json.scan_detail ?? '',
		fileSize: json.file_size ?? 0,
		commentCount: json.comment_count ?? 0,
		// The server's answers, never re-derived: the deciding circle differs per state, and a
		// frontend that guessed it would draw buttons that 403.
		canPublish: Boolean(json.can_publish),
		canDecide: Boolean(json.can_decide),
		canWithdraw: Boolean(json.can_withdraw)
	};
}

export interface RawMaterialProject {
	id: number;
	material_id: number | null;
	branch_id: string;
	branch_name: string;
	locale: string;
	type: string;
	audience?: string;
	author?: string;
	source_url?: string;
	price_amount: string | null;
	price_currency?: string;
	estimated_minutes: number | null;
	requirements?: string[];
	coverage?: RawProjectCoverage[];
	seeking_coauthors?: boolean;
	seeking_note?: string;
	created_by_id: number | null;
	created_at: string;
	title?: string;
	description?: string;
	published_version: RawMaterialVersionSummary | null;
	head_version: RawMaterialVersionSummary | null;
	members?: RawProjectMember[];
	member_count?: number;
	my_role: string | null;
	can_edit?: boolean;
	can_manage?: boolean;
	can_propose?: boolean;
	propose_block_reason: string | null;
	join_block_reason: string | null;
	pending_proposals_count?: number;
	pending_join_requests_count?: number;
}

export function mapMaterialProject(json: RawMaterialProject): MaterialProject {
	return {
		id: String(json.id),
		materialId: idOrUndefined(json.material_id) ?? null,
		// The branch travels as its slug, like every other branch reference in this app.
		branchId: json.branch_id,
		branchName: json.branch_name ?? '',
		locale: json.locale ?? 'pl',
		// A proposed type has no camelCase alias and passes through as its own slug — the same
		// reasoning (and the same real bug) `mapMaterial` documents.
		type: BACKEND_TO_FRONTEND_MATERIAL_TYPE[json.type] ?? json.type,
		audience: (json.audience ?? 'university') as MaterialProject['audience'],
		author: json.author ?? '',
		sourceUrl: json.source_url ?? '',
		priceAmount: json.price_amount != null ? Number(json.price_amount) : undefined,
		priceCurrency: json.price_currency ?? 'PLN',
		estimatedMinutes: json.estimated_minutes ?? undefined,
		requirements: json.requirements ?? [],
		coverage: (json.coverage ?? []).map(mapProjectCoverage),
		seekingCoauthors: Boolean(json.seeking_coauthors),
		seekingNote: json.seeking_note ?? '',
		createdByUserId: idOrUndefined(json.created_by_id) ?? null,
		createdAt: json.created_at,
		title: json.title ?? '',
		description: json.description ?? '',
		publishedVersion: json.published_version
			? mapMaterialVersionSummary(json.published_version)
			: null,
		headVersion: json.head_version ? mapMaterialVersionSummary(json.head_version) : null,
		members: (json.members ?? []).map(mapProjectMember),
		memberCount: json.member_count ?? (json.members ?? []).length,
		myRole: (json.my_role ?? null) as ProjectMemberRole | null,
		canEdit: Boolean(json.can_edit),
		canManage: Boolean(json.can_manage),
		canPropose: Boolean(json.can_propose),
		proposeBlockReason: (json.propose_block_reason ?? null) as ProposeBlockReason | null,
		joinBlockReason: (json.join_block_reason ?? null) as JoinBlockReason | null,
		pendingProposalsCount: json.pending_proposals_count ?? 0,
		pendingJoinRequestsCount: json.pending_join_requests_count ?? 0
	};
}

export interface RawProjectInvite {
	id: number;
	token: string;
	url_path?: string;
	label?: string;
	max_uses?: number;
	uses?: number;
	expires_at: string | null;
	revoked_at: string | null;
	created_at: string;
	is_usable?: boolean;
	unusable_reason: string | null;
}

export function mapProjectInvite(json: RawProjectInvite): ProjectInvite {
	return {
		id: String(json.id),
		token: json.token,
		urlPath: json.url_path ?? `/project-invites/${json.token}`,
		label: json.label ?? '',
		maxUses: json.max_uses ?? 0,
		uses: json.uses ?? 0,
		expiresAt: json.expires_at ?? null,
		revokedAt: json.revoked_at ?? null,
		createdAt: json.created_at,
		isUsable: Boolean(json.is_usable),
		unusableReason: (json.unusable_reason ?? null) as ProjectInviteUnusableReason | null
	};
}

export interface RawProjectInvitePreview {
	project_id: number;
	material_id: number | null;
	title: string;
	branch_name?: string;
	created_by_display_name?: string;
	is_usable?: boolean;
	unusable_reason: string | null;
}

export function mapProjectInvitePreview(json: RawProjectInvitePreview): ProjectInvitePreview {
	return {
		projectId: String(json.project_id),
		materialId: idOrUndefined(json.material_id) ?? null,
		title: json.title ?? '',
		branchName: json.branch_name ?? '',
		createdByDisplayName: json.created_by_display_name ?? '',
		isUsable: Boolean(json.is_usable),
		unusableReason: (json.unusable_reason ?? null) as ProjectInviteUnusableReason | null
	};
}

export interface RawProjectJoinRequest {
	id: number;
	project_id: number;
	user_id: number;
	display_name?: string;
	statement: string;
	status: string;
	decided_by_id: number | null;
	decided_at: string | null;
	decision_note?: string;
	created_at: string;
}

export function mapProjectJoinRequest(json: RawProjectJoinRequest): ProjectJoinRequest {
	return {
		id: String(json.id),
		projectId: String(json.project_id),
		userId: String(json.user_id),
		displayName: json.display_name ?? '',
		statement: json.statement ?? '',
		status: json.status as JoinRequestStatus,
		decidedByUserId: idOrUndefined(json.decided_by_id) ?? null,
		decidedAt: json.decided_at ?? null,
		decisionNote: json.decision_note ?? '',
		createdAt: json.created_at
	};
}

export interface RawMaterialVersionQueueRow {
	id: number;
	project_id: number;
	number: number;
	kind: string;
	title: string;
	description?: string;
	file_url?: string | null;
	file_name?: string | null;
	url?: string | null;
	body_excerpt?: string;
	scan_status?: string;
	scan_detail?: string;
	created_by_id: number | null;
	created_by_display_name?: string;
	created_at: string;
	branch_id: string;
	branch_name?: string;
	type: string;
	author?: string;
	source_url?: string;
	requirements?: string[];
	coverage?: RawProjectCoverage[];
	price_amount: string | null;
	price_currency?: string;
	estimated_minutes: number | null;
	audience?: string;
	is_first_publication?: boolean;
}

/** The moderation queue's `material_versions` section. Used by the moderation page, which decides
 *  through the app's own `/api/material-versions/{id}/decide/` endpoint rather than a new
 *  moderation kind (the solution_entries precedent, backend/moderation/CLAUDE.md). */
export function mapMaterialVersionQueueRow(
	json: RawMaterialVersionQueueRow
): MaterialVersionQueueRow {
	const fileUrl = json.file_url ?? '';
	return {
		id: String(json.id),
		projectId: String(json.project_id),
		number: json.number,
		kind: json.kind as MaterialVersionKind,
		title: json.title ?? '',
		description: json.description ?? '',
		fileUrl,
		fileName: fileNameFrom(fileUrl, json.file_name),
		url: json.url ?? '',
		bodyExcerpt: json.body_excerpt ?? '',
		scanStatus: (json.scan_status ?? 'skipped') as VersionScanStatus,
		scanDetail: json.scan_detail ?? '',
		createdByUserId: idOrUndefined(json.created_by_id) ?? null,
		createdByDisplayName: json.created_by_display_name ?? '',
		createdAt: json.created_at,
		branchId: json.branch_id,
		branchName: json.branch_name ?? '',
		type: BACKEND_TO_FRONTEND_MATERIAL_TYPE[json.type] ?? json.type,
		author: json.author ?? '',
		sourceUrl: json.source_url ?? '',
		requirements: json.requirements ?? [],
		coverage: (json.coverage ?? []).map(mapProjectCoverage),
		priceAmount: json.price_amount != null ? Number(json.price_amount) : undefined,
		priceCurrency: json.price_currency ?? 'PLN',
		estimatedMinutes: json.estimated_minutes ?? undefined,
		audience: (json.audience ?? 'university') as MaterialVersionQueueRow['audience'],
		isFirstPublication: Boolean(json.is_first_publication)
	};
}

// ---- exercise ↔ material links ------------------------------------------------------------------
// (backend/exercises/models.py's `ExerciseMaterialLink`, served from both ends: a material's own
// `/exercises/` action carries the EXERCISE, an exercise's own `/materials/` action carries the
// MATERIAL. Two raw shapes, two mappers, one frontend type — the side that is absent is simply
// `undefined`, never a fabricated empty object.)

import type { ExerciseMaterialLink, ExerciseLinkRole } from '$lib/types/exerciseMaterialLink';

interface RawExerciseMaterialLinkCommon {
	id: number;
	role: ExerciseLinkRole;
	locator: string;
	added_by_id: number | null;
	created_at: string;
}

/** A row of `GET /api/materials/{id}/exercises/` — the exercise embedded in the LIST shape, so the
 * card on a material page is the same card a branch listing renders. */
export interface RawMaterialExerciseLink extends RawExerciseMaterialLinkCommon {
	added_by_display_name: string | null;
	exercise: RawExerciseCommon;
}

/** A row of `GET /api/exercises/{id}/materials/` — the material side of the same row. */
export interface RawExerciseMaterialLinkForExercise extends RawExerciseMaterialLinkCommon {
	material: RawMaterial;
}

export function mapMaterialExerciseLink(json: RawMaterialExerciseLink): ExerciseMaterialLink {
	return {
		id: String(json.id),
		role: json.role,
		locator: json.locator ?? '',
		addedByUserId: idOrUndefined(json.added_by_id),
		addedByDisplayName: json.added_by_display_name ?? undefined,
		createdAt: json.created_at,
		exercise: mapResolvedExerciseList(json.exercise)
	};
}

export function mapExerciseMaterialLink(
	json: RawExerciseMaterialLinkForExercise
): ExerciseMaterialLink {
	return {
		id: String(json.id),
		role: json.role,
		locator: json.locator ?? '',
		addedByUserId: idOrUndefined(json.added_by_id),
		createdAt: json.created_at,
		material: mapMaterial(json.material)
	};
}

// ---- concepts ------------------------------------------------------------------------------
// (backend/concepts/, CONCEPTS-BRIEF.md §5's serializer shapes. Read the type file first —
// `lib/types/concept.ts` explains the Concept → Article → Revision shape and what a "page" is.)
//
// Two things here that the other mappers in this file do not need:
//
// 1. **Blocks go BOTH ways.** The read shape carries the backend's `drawing` / `asset`
//    expansions; the write shape is the stored shape and nothing else. `toRawConceptBlocks` is
//    the one place that strips them, so no editor has to remember to.
// 2. **A block is a discriminated union**, so an unknown `kind` coming off the wire has to land
//    somewhere honest rather than as a half-built object. It becomes an empty markdown block —
//    a newer backend that grows a sixth kind renders as a gap in an older frontend, never as a
//    crash (the `_KIND_MODELS` "unknown → 404, never 500" reasoning, one layer up).

import type {
	Concept,
	ConceptArticle,
	ConceptArticleSummary,
	ConceptAsset,
	ConceptAssetKind,
	ConceptBacklink,
	ConceptBlock,
	ConceptLink,
	ConceptLinkBlockReason,
	ConceptLinkOrigin,
	ConceptLinkTargetType,
	ConceptListRow,
	ConceptOpenRevision,
	ConceptPage,
	ConceptPageRef,
	ConceptQueueRow,
	ConceptRelation,
	ConceptRevision,
	ConceptRevisionStatus,
	ConceptRevisionSummary
} from '$lib/types/concept';

export interface RawConceptBlock {
	kind: string;
	body?: string;
	source?: string;
	drawing_id?: number | string;
	asset_id?: number | string;
	alt?: string;
	caption?: string;
	drawing?: {
		image_url?: string;
		label?: string;
		width?: number;
		height?: number;
		source_format?: string;
	} | null;
	asset?: {
		url?: string;
		original_name?: string;
		size_bytes?: number;
		width?: number;
		height?: number;
	} | null;
}

export function mapConceptBlock(json: RawConceptBlock): ConceptBlock {
	switch (json.kind) {
		case 'latex':
			return { kind: 'latex', source: json.source ?? '' };
		case 'chem':
			return {
				kind: 'chem',
				drawingId: String(json.drawing_id ?? ''),
				caption: json.caption ?? '',
				drawing: json.drawing
					? {
							imageUrl: json.drawing.image_url ?? '',
							label: json.drawing.label ?? '',
							width: json.drawing.width ?? 0,
							height: json.drawing.height ?? 0,
							sourceFormat: json.drawing.source_format ?? ''
						}
					: undefined
			};
		case 'pdf':
			return {
				kind: 'pdf',
				assetId: String(json.asset_id ?? ''),
				caption: json.caption ?? '',
				asset: json.asset ? mapConceptBlockAsset(json.asset) : undefined
			};
		case 'image':
			return {
				kind: 'image',
				assetId: String(json.asset_id ?? ''),
				alt: json.alt ?? '',
				caption: json.caption ?? '',
				asset: json.asset ? mapConceptBlockAsset(json.asset) : undefined
			};
		// `markdown`, and anything a newer backend has grown that this build has never heard of.
		default:
			return { kind: 'markdown', body: json.kind === 'markdown' ? (json.body ?? '') : '' };
	}
}

function mapConceptBlockAsset(asset: NonNullable<RawConceptBlock['asset']>) {
	return {
		url: asset.url ?? '',
		originalName: asset.original_name ?? '',
		sizeBytes: asset.size_bytes ?? 0,
		width: asset.width ?? 0,
		height: asset.height ?? 0
	};
}

/** The WRITE shape: exactly the stored keys, with the read-only expansions dropped. The backend
 *  drops unknown keys anyway (`clean_blocks`), but sending a whole expanded drawing back up would
 *  be this frontend asserting something it does not own. */
export function toRawConceptBlocks(blocks: ConceptBlock[]): Record<string, unknown>[] {
	return blocks.map((block) => {
		switch (block.kind) {
			case 'markdown':
				return { kind: 'markdown', body: block.body };
			case 'latex':
				return { kind: 'latex', source: block.source };
			case 'chem':
				return { kind: 'chem', drawing_id: Number(block.drawingId), caption: block.caption };
			case 'pdf':
				return { kind: 'pdf', asset_id: Number(block.assetId), caption: block.caption };
			case 'image':
				return {
					kind: 'image',
					asset_id: Number(block.assetId),
					alt: block.alt,
					caption: block.caption
				};
		}
	});
}

export interface RawConceptAsset {
	id: number;
	kind: string;
	url: string;
	original_name?: string;
	size_bytes?: number;
	width?: number;
	height?: number;
}

export function mapConceptAsset(json: RawConceptAsset): ConceptAsset {
	return {
		id: String(json.id),
		kind: (json.kind ?? 'image') as ConceptAssetKind,
		url: json.url ?? '',
		originalName: json.original_name ?? '',
		sizeBytes: json.size_bytes ?? 0,
		width: json.width ?? 0,
		height: json.height ?? 0
	};
}

export interface RawConceptRevisionSummary {
	id: number;
	article_id: number;
	number: number;
	status: string;
	title: string;
	change_note?: string;
	created_by_id: number | null;
	created_by_display_name?: string;
	created_at: string;
	published_at: string | null;
}

export function mapConceptRevisionSummary(json: RawConceptRevisionSummary): ConceptRevisionSummary {
	return {
		id: String(json.id),
		articleId: String(json.article_id),
		number: json.number,
		status: json.status as ConceptRevisionStatus,
		title: json.title ?? '',
		changeNote: json.change_note ?? '',
		createdByUserId: idOrUndefined(json.created_by_id) ?? null,
		createdByDisplayName: json.created_by_display_name ?? '',
		createdAt: json.created_at,
		publishedAt: json.published_at ?? null
	};
}

export interface RawConceptRevision extends RawConceptRevisionSummary {
	concept_id: number;
	slug: string;
	audience?: string;
	locale?: string;
	summary?: string;
	blocks?: RawConceptBlock[];
	based_on_id: number | null;
	based_on_is_current?: boolean;
	updated_at: string;
	submitted_at: string | null;
	reviewed_by_id: number | null;
	reviewed_by_display_name?: string;
	reviewed_at: string | null;
	review_note?: string;
	will_publish?: boolean;
	can_submit?: boolean;
	can_decide?: boolean;
	can_withdraw?: boolean;
	can_delete?: boolean;
}

export function mapConceptRevision(json: RawConceptRevision): ConceptRevision {
	const summary = mapConceptRevisionSummary(json);
	return {
		...summary,
		conceptId: String(json.concept_id),
		slug: json.slug ?? '',
		audience: (json.audience ?? 'all') as ConceptRevision['audience'],
		locale: json.locale ?? '',
		summary: json.summary ?? '',
		blocks: (json.blocks ?? []).map(mapConceptBlock),
		basedOnId: idOrUndefined(json.based_on_id) ?? null,
		basedOnIsCurrent: Boolean(json.based_on_is_current),
		updatedAt: json.updated_at,
		submittedAt: json.submitted_at ?? null,
		reviewedByUserId: idOrUndefined(json.reviewed_by_id) ?? null,
		reviewedByDisplayName: json.reviewed_by_display_name ?? '',
		reviewedAt: json.reviewed_at ?? null,
		reviewNote: json.review_note ?? '',
		willPublish: Boolean(json.will_publish),
		canSubmit: Boolean(json.can_submit),
		canDecide: Boolean(json.can_decide),
		canWithdraw: Boolean(json.can_withdraw),
		canDelete: Boolean(json.can_delete)
	};
}

export interface RawConceptArticleSummary {
	id: number;
	audience?: string;
	locale?: string;
	pinned?: boolean;
	title: string;
	summary?: string;
	created_by_id: number | null;
	created_by_display_name?: string;
	head_published_at: string | null;
	revision_count?: number;
	comment_count?: number;
}

export function mapConceptArticleSummary(json: RawConceptArticleSummary): ConceptArticleSummary {
	return {
		id: String(json.id),
		audience: (json.audience ?? 'all') as ConceptArticleSummary['audience'],
		locale: json.locale ?? '',
		pinned: Boolean(json.pinned),
		title: json.title ?? '',
		summary: json.summary ?? '',
		createdByUserId: idOrUndefined(json.created_by_id) ?? null,
		createdByDisplayName: json.created_by_display_name ?? '',
		headPublishedAt: json.head_published_at ?? null,
		revisionCount: json.revision_count ?? 0,
		commentCount: json.comment_count ?? 0
	};
}

export interface RawConceptArticle extends RawConceptArticleSummary {
	concept_id: number;
	slug: string;
	head: RawConceptRevision | null;
	my_open?: RawConceptRevisionSummary | null;
	can_review?: boolean;
	can_pin?: boolean;
	will_publish?: boolean;
}

export function mapConceptArticle(json: RawConceptArticle): ConceptArticle {
	return {
		...mapConceptArticleSummary(json),
		conceptId: String(json.concept_id),
		slug: json.slug ?? '',
		head: json.head ? mapConceptRevision(json.head) : null,
		myOpen: json.my_open ? mapConceptRevisionSummary(json.my_open) : null,
		canReview: Boolean(json.can_review),
		canPin: Boolean(json.can_pin),
		willPublish: Boolean(json.will_publish)
	};
}

export interface RawConceptLink {
	id: number;
	relation?: string;
	origin?: string;
	target_type: string;
	target_id: number | string;
	target_title?: string;
	target_slug?: string;
	target_audience?: string | null;
	added_by_id: number | null;
	created_at: string;
	can_remove?: boolean;
}

export function mapConceptLink(json: RawConceptLink): ConceptLink {
	return {
		id: String(json.id),
		relation: (json.relation ?? 'related') as ConceptRelation,
		origin: (json.origin ?? 'manual') as ConceptLinkOrigin,
		targetType: json.target_type as ConceptLinkTargetType,
		targetId: String(json.target_id),
		targetTitle: json.target_title ?? '',
		targetSlug: json.target_slug ?? '',
		targetAudience: (json.target_audience ?? null) as ConceptLink['targetAudience'],
		addedByUserId: idOrUndefined(json.added_by_id) ?? null,
		createdAt: json.created_at,
		canRemove: Boolean(json.can_remove)
	};
}

export interface RawConceptBacklink {
	link_id: number;
	concept_id: number;
	slug: string;
	title?: string;
	summary?: string;
	relation?: string;
	origin?: string;
}

export function mapConceptBacklink(json: RawConceptBacklink): ConceptBacklink {
	return {
		linkId: String(json.link_id),
		conceptId: String(json.concept_id),
		slug: json.slug,
		title: json.title ?? '',
		summary: json.summary ?? '',
		relation: (json.relation ?? 'related') as ConceptRelation,
		origin: (json.origin ?? 'manual') as ConceptLinkOrigin
	};
}

export interface RawConceptPageRef {
	audience?: string;
	locale?: string;
	article_count?: number;
	lead_title?: string;
}

export function mapConceptPageRef(json: RawConceptPageRef): ConceptPageRef {
	return {
		audience: (json.audience ?? 'all') as ConceptPageRef['audience'],
		locale: json.locale ?? '',
		articleCount: json.article_count ?? 0,
		leadTitle: json.lead_title ?? ''
	};
}

export interface RawConceptPage extends RawConceptPageRef {
	audience_exact?: boolean;
	locale_exact?: boolean;
	articles?: RawConceptArticleSummary[];
	article: RawConceptArticle | null;
}

export function mapConceptPage(json: RawConceptPage): ConceptPage {
	return {
		audience: (json.audience ?? 'all') as ConceptPage['audience'],
		locale: json.locale ?? '',
		// Both default TRUE: a server that does not say is saying it did not have to fall back,
		// and a fallback notice shown over a page that is exactly the reader's own would be a lie
		// in the one direction that matters.
		audienceExact: json.audience_exact ?? true,
		localeExact: json.locale_exact ?? true,
		articles: (json.articles ?? []).map(mapConceptArticleSummary),
		article: json.article ? mapConceptArticle(json.article) : null
	};
}

export interface RawConceptOpenRevision {
	revision_id: number;
	article_id: number;
	audience?: string;
	locale?: string;
	status: string;
	updated_at: string;
}

export function mapConceptOpenRevision(json: RawConceptOpenRevision): ConceptOpenRevision {
	return {
		revisionId: String(json.revision_id),
		articleId: String(json.article_id),
		audience: (json.audience ?? 'all') as ConceptOpenRevision['audience'],
		locale: json.locale ?? '',
		status: json.status as ConceptRevisionStatus,
		updatedAt: json.updated_at
	};
}

export interface RawConcept {
	id: number;
	slug: string;
	branch_ids?: string[];
	branch_names?: string[];
	tags?: string[];
	created_by_id: number | null;
	created_by_display_name?: string;
	created_at: string;
	updated_at: string;
	page: RawConceptPage | null;
	pages?: RawConceptPageRef[];
	links?: RawConceptLink[];
	backlinks?: RawConceptBacklink[];
	my_open?: RawConceptOpenRevision[];
	can_edit_metadata?: boolean;
	can_pin?: boolean;
	link_block_reason?: string | null;
	will_publish?: boolean;
}

export function mapConcept(json: RawConcept): Concept {
	return {
		id: String(json.id),
		slug: json.slug,
		branchIds: json.branch_ids ?? [],
		branchNames: json.branch_names ?? [],
		tags: json.tags ?? [],
		createdByUserId: idOrUndefined(json.created_by_id) ?? null,
		createdByDisplayName: json.created_by_display_name ?? '',
		createdAt: json.created_at,
		updatedAt: json.updated_at,
		page: json.page ? mapConceptPage(json.page) : null,
		pages: (json.pages ?? []).map(mapConceptPageRef),
		links: (json.links ?? []).map(mapConceptLink),
		backlinks: (json.backlinks ?? []).map(mapConceptBacklink),
		myOpen: (json.my_open ?? []).map(mapConceptOpenRevision),
		canEditMetadata: Boolean(json.can_edit_metadata),
		canPin: Boolean(json.can_pin),
		linkBlockReason: (json.link_block_reason ?? null) as ConceptLinkBlockReason | null,
		willPublish: Boolean(json.will_publish)
	};
}

export interface RawConceptListRow {
	id: number;
	slug: string;
	title?: string;
	summary?: string;
	audience?: string;
	locale?: string;
	article_count?: number;
	audiences?: string[];
	locales?: string[];
	branch_ids?: string[];
	branch_names?: string[];
	tags?: string[];
	updated_at: string;
	is_fallback?: boolean;
}

export function mapConceptListRow(json: RawConceptListRow): ConceptListRow {
	return {
		id: String(json.id),
		slug: json.slug,
		title: json.title ?? '',
		summary: json.summary ?? '',
		audience: (json.audience ?? 'all') as ConceptListRow['audience'],
		locale: json.locale ?? '',
		articleCount: json.article_count ?? 0,
		audiences: (json.audiences ?? []) as ConceptListRow['audiences'],
		locales: json.locales ?? [],
		branchIds: json.branch_ids ?? [],
		branchNames: json.branch_names ?? [],
		tags: json.tags ?? [],
		updatedAt: json.updated_at,
		isFallback: Boolean(json.is_fallback)
	};
}

export interface RawConceptQueueRow {
	id: number;
	article_id: number;
	concept_id: number;
	slug: string;
	audience?: string;
	locale?: string;
	number: number;
	title: string;
	summary?: string;
	blocks?: RawConceptBlock[];
	change_note?: string;
	is_new_concept?: boolean;
	is_new_article?: boolean;
	based_on_is_current?: boolean;
	current?: { revision_id: number; title?: string; blocks?: RawConceptBlock[] } | null;
	created_by_id: number | null;
	created_by_display_name?: string;
	created_at: string;
	submitted_at: string | null;
	branch_ids?: string[];
	branch_names?: string[];
}

/** The moderation queue's `concepts` section. Decided through the app's own
 *  `/api/concept-revisions/{id}/decide/` endpoint rather than a new moderation kind — the
 *  `material_versions` / `solution_entries` precedent (CONCEPTS-BRIEF.md §0). */
export function mapConceptQueueRow(json: RawConceptQueueRow): ConceptQueueRow {
	return {
		id: String(json.id),
		articleId: String(json.article_id),
		conceptId: String(json.concept_id),
		slug: json.slug,
		audience: (json.audience ?? 'all') as ConceptQueueRow['audience'],
		locale: json.locale ?? '',
		number: json.number,
		title: json.title ?? '',
		summary: json.summary ?? '',
		blocks: (json.blocks ?? []).map(mapConceptBlock),
		changeNote: json.change_note ?? '',
		isNewConcept: Boolean(json.is_new_concept),
		isNewArticle: Boolean(json.is_new_article),
		basedOnIsCurrent: Boolean(json.based_on_is_current),
		current: json.current
			? {
					revisionId: String(json.current.revision_id),
					title: json.current.title ?? '',
					blocks: (json.current.blocks ?? []).map(mapConceptBlock)
				}
			: null,
		createdByUserId: idOrUndefined(json.created_by_id) ?? null,
		createdByDisplayName: json.created_by_display_name ?? '',
		createdAt: json.created_at,
		submittedAt: json.submitted_at ?? null,
		branchIds: json.branch_ids ?? [],
		branchNames: json.branch_names ?? []
	};
}
