import type {
	CoverageVoteValue,
	Material,
	MaterialCoverage,
	MaterialSubmission,
	MaterialSubmissionDraft
} from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	FRONTEND_TO_BACKEND_MATERIAL_TYPE,
	mapMaterial,
	mapMaterialCoverage,
	mapMaterialSubmission,
	type RawMaterial,
	type RawMaterialCoverage,
	type RawMaterialSubmission
} from '$lib/api/mappers';

export async function getMaterialsForCourse(courseId: string): Promise<Material[]> {
	const raw = await apiClient.get<RawMaterial[]>(
		`/courses/${encodeURIComponent(courseId)}/materials/`
	);
	return raw.map(mapMaterial);
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
