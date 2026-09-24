// The cooperation overview of a material (backend materials_coop/): one read, one write, and the
// team thread. Everything that ACTS on the project — versions, members, invites, join requests —
// stays in `materialProjects.ts`; this seam only answers "what does the team look like" and "how
// open is it".

import { ApiError, apiClient } from '$lib/api/client';
import {
	mapComment,
	mapCoopOverview,
	type RawComment,
	type RawCoopOverview
} from '$lib/api/mappers';
import type { Comment } from '$lib/types';
import type { CoopOverview, CoopSettingsPatch } from '$lib/types/materialsCoop';

/** A write the policy or the team refused, carrying the reason the API gave (house rule 6). */
export class CoopRefusedError extends Error {
	reason: string;
	constructor(reason: string) {
		super(`coop refused: ${reason}`);
		this.name = 'CoopRefusedError';
		this.reason = reason;
	}
}

function reasonOf(e: unknown): string | null {
	if (!(e instanceof ApiError)) return null;
	const body = e.body as { detail?: unknown } | null;
	return typeof body?.detail === 'string' ? body.detail : null;
}

/** Null when the material has no project the caller may see, or the switch is off for them —
 *  both mean "draw nothing", which is what a panel that renders nothing wants. */
export async function getCoopOverview(materialId: string): Promise<CoopOverview | null> {
	try {
		const raw = await apiClient.get<RawCoopOverview>(
			`/materials/${encodeURIComponent(materialId)}/coop/`
		);
		return mapCoopOverview(raw);
	} catch (e) {
		if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return null;
		throw e;
	}
}

export async function updateCoopSettings(
	materialId: string,
	patch: CoopSettingsPatch
): Promise<CoopOverview> {
	const body: Record<string, unknown> = {};
	if (patch.policy !== undefined) body.policy = patch.policy;
	if (patch.welcomeNote !== undefined) body.welcome_note = patch.welcomeNote;
	try {
		const raw = await apiClient.patch<RawCoopOverview>(
			`/materials/${encodeURIComponent(materialId)}/coop/`,
			body
		);
		return mapCoopOverview(raw);
	} catch (e) {
		const reason = reasonOf(e);
		if (reason) throw new CoopRefusedError(reason);
		throw e;
	}
}

export async function listCoopComments(materialId: string): Promise<Comment[]> {
	const raw = await apiClient.get<RawComment[]>(
		`/materials/${encodeURIComponent(materialId)}/coop/comments/`
	);
	return raw.map((c) => mapComment(c, 'materialProject', materialId));
}

export async function postCoopComment(
	materialId: string,
	body: string,
	parentId?: string
): Promise<Comment> {
	try {
		const raw = await apiClient.post<RawComment>(
			`/materials/${encodeURIComponent(materialId)}/coop/comments/`,
			{ body, parent: parentId ? Number(parentId) : undefined }
		);
		return mapComment(raw, 'materialProject', materialId);
	} catch (e) {
		const reason = reasonOf(e);
		if (reason) throw new CoopRefusedError(reason);
		throw e;
	}
}
