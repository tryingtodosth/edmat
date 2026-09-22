// Exercise ↔ material links — one function per endpoint, all HTTP through `apiClient`
// (lib/api/client.ts is the only fetch in this app; CLAUDE.md's load-bearing boundary).
//
// The same row is read from both ends and the endpoints say so: the material page asks a MATERIAL
// for its exercises, the exercise page asks an EXERCISE for its materials, and writing goes through
// the material's end only — one create path, so there is one thing to keep correct.

import type { ExerciseLinkRole, ExerciseMaterialLink } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	mapExerciseMaterialLink,
	mapMaterialExerciseLink,
	type RawExerciseMaterialLinkForExercise,
	type RawMaterialExerciseLink
} from '$lib/api/mappers';

/** Every exercise attached to this material, `source` rows first. Bounded by construction (a
 * material has tens of exercises), so no paging — the API's own convention. */
export async function getExercisesForMaterial(
	materialId: string,
	locale: string
): Promise<ExerciseMaterialLink[]> {
	const raw = await apiClient.get<RawMaterialExerciseLink[]>(
		`/materials/${encodeURIComponent(materialId)}/exercises/?lang=${encodeURIComponent(locale)}`
	);
	return raw.map(mapMaterialExerciseLink);
}

/** "From material …" — every published material this exercise is linked to. */
export async function getMaterialsForExercise(
	exerciseId: string,
	locale: string
): Promise<ExerciseMaterialLink[]> {
	const raw = await apiClient.get<RawExerciseMaterialLinkForExercise[]>(
		`/exercises/${encodeURIComponent(exerciseId)}/materials/?lang=${encodeURIComponent(locale)}`
	);
	return raw.map(mapExerciseMaterialLink);
}

/** Thrown for the 409 "this pair is already linked" case, mirroring `DuplicateCoverageError`
 * (services/materials.ts) for the identical purpose: the picker can say "it is already here"
 * instead of showing a generic failure for something that is not really a failure. */
export class AlreadyLinkedError extends Error {}

export interface LinkExerciseInput {
	exerciseId: string;
	role?: ExerciseLinkRole;
	locator?: string;
}

export async function linkExerciseToMaterial(
	materialId: string,
	input: LinkExerciseInput
): Promise<ExerciseMaterialLink> {
	try {
		const raw = await apiClient.post<RawMaterialExerciseLink>(
			`/materials/${encodeURIComponent(materialId)}/exercises/`,
			{
				exercise_id: Number(input.exerciseId),
				role: input.role,
				locator: input.locator
			}
		);
		return mapMaterialExerciseLink(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 409) throw new AlreadyLinkedError(e.message);
		throw e;
	}
}

/** Correct what a link claims, or where in the material it points. The backend answers 404 — never
 * 403 — to somebody who may not, which is the honest answer as well as the safe one. */
export async function updateExerciseMaterialLink(
	linkId: string,
	changes: { role?: ExerciseLinkRole; locator?: string }
): Promise<ExerciseMaterialLink | undefined> {
	const raw = await apiClient.patch<RawMaterialExerciseLink | undefined>(
		`/exercise-material-links/${encodeURIComponent(linkId)}/`,
		changes
	);
	// 204 when the row survives but its card cannot be drawn for this caller (an unpublished
	// exercise seen by a non-staff manager of the material) — `apiClient` gives `undefined` there.
	return raw ? mapMaterialExerciseLink(raw) : undefined;
}

/** A real delete: nothing hangs off a link, so there is no thread or reference to tombstone for. */
export async function unlinkExerciseFromMaterial(linkId: string): Promise<void> {
	await apiClient.delete(`/exercise-material-links/${encodeURIComponent(linkId)}/`);
}
