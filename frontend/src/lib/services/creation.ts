// The creation gate's read side (learning step F, prompts/07-creation-gate.md): one function for
// one endpoint, and nothing on this surface calls `fetch` (frontend/CLAUDE.md's layer boundary).
//
// There is no write side. The gate is never SET from here — it is a `FeatureFlag`
// (`creation_requires_verification`) a moderator flips on the Flags tab, plus
// `Profile.is_verified_contributor`, which is staff-set and deliberately absent from the profile
// serializer a client can PATCH (`accounts/CLAUDE.md`). So this file reads an answer and that is
// all it can do.

import { apiClient } from '$lib/api/client';
import { CREATION_KINDS, type CreationBlockReason, type CreationStatus } from '$lib/types/creation';

/** The three words `backend/config/creation.py` answers with. Anything else the server ever adds
 *  is kept verbatim rather than dropped — `gateReasonLabel` falls back to a generic sentence, which
 *  is better than a missing explanation (and better than this layer silently deciding the account
 *  may go ahead). */
function reasonOf(raw: unknown): CreationBlockReason | null {
	return typeof raw === 'string' && raw.length > 0 ? (raw as CreationBlockReason) : null;
}

/** `GET /api/creation/` → `{course, event, service, organization}`, each `null` (go ahead) or a
 *  refusal word. Every kind is present in the result even if the server omitted one, so a caller
 *  never has to handle `undefined`; a missing key reads as "no reason given", which is what an
 *  older backend that does not know a kind yet honestly means. */
export async function getCreationStatus(): Promise<CreationStatus> {
	const raw = await apiClient.get<Record<string, unknown>>('/creation/');
	const status = {} as CreationStatus;
	for (const kind of CREATION_KINDS) status[kind] = reasonOf(raw?.[kind]);
	return status;
}
