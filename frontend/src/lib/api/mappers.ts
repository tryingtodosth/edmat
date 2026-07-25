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
	EditSuggestion,
	Exercise,
	ExerciseSet,
	ExerciseSource,
	ExerciseSubmission,
	ExerciseTranslation,
	Field,
	Material,
	MaterialType,
	ModerationStatus,
	ResolvedExercise,
	Review,
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
		availableLocales: []
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
		availableLocales: json.available_locales
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
	other: 'other'
};

export interface RawMaterial {
	id: number;
	course: number;
	course_slug: string;
	slug: string;
	type: string;
	topics: number[];
	file: string | null;
	author: string;
	published: boolean;
	featured: boolean;
	order: number;
	title: string;
	description: string;
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
		topicIds: json.topics.map(String),
		fileName: fileUrl ? (fileUrl.split('/').pop() ?? fileUrl) : '',
		fileUrl,
		author: json.author,
		published: json.published,
		featured: json.featured,
		order: json.order
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
		isRemoved: json.is_removed
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

// ---- study: exercise sets -----------------------------------------------------------------------

export interface RawExerciseSet {
	id: number;
	owner: number;
	name: string;
	items: { id: number; exercise: number; order: number }[];
	created_at: string;
}

export function mapExerciseSet(json: RawExerciseSet): ExerciseSet {
	return {
		id: String(json.id),
		ownerId: String(json.owner),
		name: json.name,
		exerciseIds: [...json.items].sort((a, b) => a.order - b.order).map((i) => String(i.exercise)),
		createdAt: json.created_at
	};
}

// ---- accounts -----------------------------------------------------------------------------------

export interface RawProfile {
	id: number; // the USER's own pk (see accounts/serializers.py's own note on why)
	username: string;
	email: string;
	display_name: string;
	avatar: string | null;
	preferred_locale: string;
	is_verified_contributor: boolean;
	is_moderator: boolean;
	joined_at: string;
}

export function mapUser(json: RawProfile): User {
	return {
		id: String(json.id),
		displayName: json.display_name || json.username,
		email: json.email,
		avatarUrl: json.avatar ?? undefined,
		joinedAt: json.joined_at,
		isVerifiedContributor: json.is_verified_contributor,
		isModerator: json.is_moderator,
		preferredLocale: json.preferred_locale
	};
}
