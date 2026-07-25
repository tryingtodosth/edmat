import type { CoverageVoteValue, Material, MaterialCoverage } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	mapMaterial,
	mapMaterialCoverage,
	type RawMaterial,
	type RawMaterialCoverage
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
