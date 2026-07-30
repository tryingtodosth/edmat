import type {
	CoverageVoteValue,
	Material,
	MaterialBrowseFilters,
	MaterialCoverage,
	MaterialRequirement,
	MaterialReview,
	MaterialSubmission,
	MaterialSubmissionDraft,
	RecommendedMaterialsResult
} from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	FRONTEND_TO_BACKEND_MATERIAL_TYPE,
	mapMaterial,
	mapMaterialCoverage,
	mapMaterialRequirement,
	mapMaterialReview,
	mapMaterialSubmission,
	type RawMaterial,
	type RawMaterialCoverage,
	type RawMaterialRequirement,
	type RawMaterialReview,
	type RawMaterialSubmission
} from '$lib/api/mappers';

// Builds the exact query string the backend's own `_filter_materials`/`_sort_materials`
// (materials/views.py) read — `type`/`sort` travel through their own front-to-back value maps
// (MaterialType is camelCase on this side, snake_case on the wire; MaterialSort is already
// identical on both, per that view's own `_SORT_KEYS`), everything else passes straight through.
// A local helper, not a shared one — same "small query-string builder living next to its own one
// real caller" convention lib/services/exercises.ts's own `toQueryString` already established,
// deliberately not extracted into a shared util for two independently-shaped filter objects.
function materialQueryString(filters: MaterialBrowseFilters): string {
	const search = new URLSearchParams();
	if (filters.fieldId) search.set('field', filters.fieldId);
	if (filters.courseId) search.set('course', filters.courseId);
	if (filters.type)
		search.set('type', FRONTEND_TO_BACKEND_MATERIAL_TYPE[filters.type] ?? filters.type);
	if (filters.tag) search.set('tag', filters.tag);
	if (filters.topicId) search.set('topic_id', filters.topicId);
	if (filters.minLevel) search.set('min_level', String(filters.minLevel));
	if (filters.query) search.set('q', filters.query);
	if (filters.sort) search.set('sort', filters.sort);
	const s = search.toString();
	return s ? `?${s}` : '';
}

/** Course-scoped materials listing (routes/courses/[course]'s own Materials tab) — now
 * filter/sort-capable too, via the exact same query params the cross-course `browseMaterials`
 * below sends (taxonomy.CourseViewSet.materials, materials/views.py, reuse the identical
 * `_filter_materials`/`_sort_materials` helpers `MaterialViewSet` itself uses). `filters.courseId`
 * is deliberately ignored here — the course is already the one this function was called for. */
export async function getMaterialsForCourse(
	courseId: string,
	filters: MaterialBrowseFilters = {}
): Promise<Material[]> {
	const qs = materialQueryString({ ...filters, courseId: undefined });
	const raw = await apiClient.get<RawMaterial[]>(
		`/courses/${encodeURIComponent(courseId)}/materials/${qs}`
	);
	return raw.map(mapMaterial);
}

/** The cross-course browse hub (routes/materials/+page.svelte) — every real structured dimension
 * this overhaul added: type, topic/subtopic coverage depth, tag, free text, and sort, optionally
 * further scoped to one field/course. Backed by GET /api/materials/ (MaterialViewSet.list). */
export async function browseMaterials(filters: MaterialBrowseFilters = {}): Promise<Material[]> {
	const raw = await apiClient.get<RawMaterial[]>(`/materials/${materialQueryString(filters)}`);
	return raw.map(mapMaterial);
}

/** GET /api/materials/recommended/ — the overhaul's own genuine personalization dimension. See
 * materials/services.py's `get_recommended_materials` (backend) and RecommendedMaterialsResult's
 * own doc comment (material.ts) for why `personalized` is real, load-bearing information, not
 * decorative — this function's job is just to expose it, never to fabricate it if the backend
 * ever omitted it. */
export async function getRecommendedMaterials(limit = 12): Promise<RecommendedMaterialsResult> {
	const raw = await apiClient.get<{ personalized: boolean; results: RawMaterial[] }>(
		`/materials/recommended/?limit=${encodeURIComponent(String(limit))}`
	);
	return { personalized: raw.personalized, materials: raw.results.map(mapMaterial) };
}

export async function getMaterialById(id: string): Promise<Material | undefined> {
	try {
		const raw = await apiClient.get<RawMaterial>(`/materials/${encodeURIComponent(id)}/`);
		return mapMaterial(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

/** The tag-hover menu's own "add to different content" picker (TagChip.svelte/
 * AddTagToContentModal.svelte) — a title/description text search across every course's materials,
 * backed by MaterialViewSet's own new `?q=` filter. */
export async function searchMaterials(query: string): Promise<Material[]> {
	if (!query.trim()) return [];
	const raw = await apiClient.get<RawMaterial[]>(`/materials/?q=${encodeURIComponent(query)}`);
	return raw.map(mapMaterial);
}

/** What proposing a new coverage row needs — either an existing subtopic (`subtopicId`) or a new
 * one to get-or-create under the chosen topic on the fly (`subtopicSlug`/`subtopicName`), never
 * both. Neither set at all means "topic-level coverage, no subtopic breakdown." */
export interface ProposeCoverageInput {
	topicId: string;
	subtopicId?: string;
	subtopicSlug?: string;
	subtopicName?: string;
	locale?: string;
	level: number; // 1-100
}

// Thrown specifically for the 409 "this pairing already exists" case (materials/views.py's own
// `coverage` action) — a distinct, named error so a caller can show "discuss/vote on the existing
// one" rather than a generic failure message.
export class DuplicateCoverageError extends Error {}

export async function proposeCoverage(
	materialId: string,
	input: ProposeCoverageInput
): Promise<MaterialCoverage> {
	try {
		const raw = await apiClient.post<RawMaterialCoverage>(
			`/materials/${encodeURIComponent(materialId)}/coverage/`,
			{
				topic: Number(input.topicId),
				subtopic: input.subtopicId ? Number(input.subtopicId) : undefined,
				subtopic_slug: input.subtopicSlug,
				subtopic_name: input.subtopicName,
				locale: input.locale,
				level: input.level
			}
		);
		return mapMaterialCoverage(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 409) throw new DuplicateCoverageError(e.message);
		throw e;
	}
}

export async function castCoverageVote(
	coverageId: string,
	value: CoverageVoteValue
): Promise<MaterialCoverage> {
	const raw = await apiClient.post<RawMaterialCoverage>(
		`/material-coverage/${encodeURIComponent(coverageId)}/vote/`,
		{ value }
	);
	return mapMaterialCoverage(raw);
}

export async function retractCoverageVote(coverageId: string): Promise<MaterialCoverage> {
	const raw = await apiClient.delete<RawMaterialCoverage>(
		`/material-coverage/${encodeURIComponent(coverageId)}/vote/`
	);
	return mapMaterialCoverage(raw);
}

// ---- material submissions ("exams, tests, etc. — usually a PDF/PNG, but a whole LaTeX/Word
// document should be accepted too, scanned and kept safe") ------------------------------------

/** A real multipart upload, not JSON — `file` travels as an actual `File` object, separate from the
 * rest of the draft's plain metadata fields (mirroring how `MaterialSubmissionDraft` itself keeps
 * the two apart, see that type's own doc comment). The backend runs real content-type sniffing
 * AND an (optional, honestly-flagged-when-unavailable) malware scan before this ever reaches the
 * moderation queue — a 400 here can mean either check failed, surfaced via the thrown `ApiError`'s
 * own message exactly like any other validation error in this app. */
export async function submitMaterial(
	draft: MaterialSubmissionDraft,
	file: File
): Promise<MaterialSubmission> {
	const formData = new FormData();
	formData.append('course', draft.courseId);
	formData.append('type', FRONTEND_TO_BACKEND_MATERIAL_TYPE[draft.type] ?? 'other');
	formData.append('title', draft.title);
	formData.append('description', draft.description);
	formData.append('locale', draft.locale);
	formData.append('file', file);
	// All three genuinely optional — a submission that never sets any of them behaves exactly as
	// before this feature existed. `requirements` travels as a JSON-encoded string, not a native
	// array — this is a multipart body, and the backend's own `validate_requirements` (moderation/
	// serializers.py) specifically parses a string here rather than assuming a real list arrived.
	if (draft.requirements && draft.requirements.length > 0) {
		formData.append('requirements', JSON.stringify(draft.requirements));
	}
	if (draft.priceAmount !== undefined) formData.append('price_amount', String(draft.priceAmount));
	if (draft.priceCurrency) formData.append('price_currency', draft.priceCurrency);
	if (draft.estimatedMinutes !== undefined) {
		formData.append('estimated_minutes', String(draft.estimatedMinutes));
	}

	const raw = await apiClient.postForm<RawMaterialSubmission>('/material-submissions/', formData);
	return mapMaterialSubmission(raw);
}

export async function getMaterialSubmissionsForCourse(
	courseId: string
): Promise<MaterialSubmission[]> {
	const raw = await apiClient.get<RawMaterialSubmission[]>(
		`/material-submissions/?course=${encodeURIComponent(courseId)}`
	);
	return raw.map(mapMaterialSubmission);
}

// ---- material requirements — a governor-only bulk replace of an ALREADY-PUBLISHED material's own
// requirement list (materials/views.py's `requirements` action) — see that view's own doc comment
// for the exact trust boundary (global staff, or a governor of the material's own course; not open
// to any authenticated user the way MaterialCoverage proposals are). A full, ordered replace, not a
// single add/remove — the natural shape for a list editor that always submits its own current state.
export async function setMaterialRequirements(
	materialId: string,
	labels: string[]
): Promise<Material> {
	const raw = await apiClient.put<RawMaterial>(
		`/materials/${encodeURIComponent(materialId)}/requirements/`,
		{ requirements: labels }
	);
	return mapMaterial(raw);
}

// Thrown specifically for the 409 "this requirement already exists" case (materials/views.py's own
// `propose_requirement` action) — mirrors DuplicateCoverageError above for the identical purpose.
export class DuplicateRequirementError extends Error {}

/** POST /api/materials/{id}/requirements/propose_requirement/ — open to any authenticated user,
 * the requirement-side counterpart to `proposeCoverage` above (a real, found gap: this used to be
 * governor-only end to end, with no way for an ordinary user to add one at all). A single new
 * requirement, not a full-list replace — `setMaterialRequirements` above (still governor-only)
 * stays the bulk-reorder/removal power; this only ever appends one. */
export async function proposeRequirement(
	materialId: string,
	label: string
): Promise<MaterialRequirement> {
	try {
		const raw = await apiClient.post<RawMaterialRequirement>(
			`/materials/${encodeURIComponent(materialId)}/requirements/propose_requirement/`,
			{ label }
		);
		return mapMaterialRequirement(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 409) throw new DuplicateRequirementError(e.message);
		throw e;
	}
}

// ---- requirement voting — the new votable half of "split material tags into two groups
// (covers/requires), each votable, so users can sort by that." Open to any authenticated user,
// same shape as castCoverageVote/retractCoverageVote above. --------------------------------------

export async function castRequirementVote(
	requirementId: string,
	value: CoverageVoteValue
): Promise<MaterialRequirement> {
	const raw = await apiClient.post<RawMaterialRequirement>(
		`/material-requirements/${encodeURIComponent(requirementId)}/vote/`,
		{ value }
	);
	return mapMaterialRequirement(raw);
}

export async function retractRequirementVote(requirementId: string): Promise<MaterialRequirement> {
	const raw = await apiClient.delete<RawMaterialRequirement>(
		`/material-requirements/${encodeURIComponent(requirementId)}/vote/`
	);
	return mapMaterialRequirement(raw);
}

// ---- reviews — "add discussions and reviews to materials" ---------------------------------------

export async function getMaterialReviews(materialId: string): Promise<MaterialReview[]> {
	const raw = await apiClient.get<RawMaterialReview[]>(
		`/materials/${encodeURIComponent(materialId)}/reviews/`
	);
	const reviews = raw.map(mapMaterialReview);
	reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return reviews;
}

// `userId` stays a parameter for call-site compatibility with `submitReview`/`submitServiceReview`
// — the backend already scopes this to whoever the auth token belongs to (MaterialReview.author =
// request.user), and already upserts on resubmission rather than duplicating (unique_together =
// [('material', 'author')]).
export async function submitMaterialReview(
	materialId: string,
	_userId: string,
	rating: number,
	body?: string
): Promise<MaterialReview> {
	const raw = await apiClient.post<RawMaterialReview>(
		`/materials/${encodeURIComponent(materialId)}/reviews/`,
		{ rating, body: body?.trim() || '' }
	);
	return mapMaterialReview(raw);
}
