// The "AI-assisted" mark seam (backend `provenance/`). Components and routes never fetch
// (frontend/CLAUDE.md's layer boundary); `apiClient` is the one `fetch()`.
//
// One BATCHED read, because a page draws a statement, a handful of hints and solutions, a thread
// and a few reviews and wants a chip on each: asking per chip would be a request per row. The
// backend is shaped for it (`AssistanceSummaryView`), and `provideAiAssistance` is the page-level
// holder the chips read from — the same split `providePageDiscussions` already uses.

import { apiClient } from '$lib/api/client';
import type {
	AssistanceReading,
	AssistanceReadings,
	AssistanceTargetKind
} from '$lib/types/provenance';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapReading(raw: any): AssistanceReading {
	return {
		kind: raw.kind,
		id: String(raw.id),
		score: raw.score ?? 0,
		shownScore: raw.shown_score ?? 0,
		basis: raw.basis ?? 'none',
		authorMarked: raw.author_marked ?? false,
		authorAnswered: raw.author_answered ?? false,
		authorNote: raw.author_note ?? '',
		communityMarked: raw.community_marked ?? false,
		votes: raw.votes ?? 0,
		averageConfidence: raw.average_confidence ?? 0,
		locked: raw.locked ?? false,
		lockValue: raw.lock_value ?? null,
		lockReason: raw.lock_reason ?? '',
		myConfidence: raw.my_confidence ?? null,
		canVote: raw.can_vote ?? false,
		canDeclare: raw.can_declare ?? false,
		canLock: raw.can_lock ?? false
	};
}

function mapAll(raw: any): AssistanceReadings {
	const out: AssistanceReadings = {};
	for (const [key, value] of Object.entries(raw ?? {})) out[key] = mapReading(value);
	return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** One request for every chip a page has just drawn. Targets the reader may not see come back
 *  absent rather than as an error, so a caller never has to filter the list it asked about. */
export async function readingsFor(
	targets: { kind: AssistanceTargetKind; id: string }[]
): Promise<AssistanceReadings> {
	if (targets.length === 0) return {};
	const query = targets.map((t) => `${t.kind}:${t.id}`).join(',');
	return mapAll(await apiClient.get(`/ai-assistance/?targets=${encodeURIComponent(query)}`));
}

/** How sure you are, 0–100. A PUT because voting twice is changing your mind, not voting twice. */
export async function vote(
	kind: AssistanceTargetKind,
	id: string,
	confidence: number
): Promise<AssistanceReading> {
	return mapReading(await apiClient.put(`/ai-assistance/${kind}/${id}/vote/`, { confidence }));
}

export async function retractVote(
	kind: AssistanceTargetKind,
	id: string
): Promise<AssistanceReading> {
	return mapReading(await apiClient.delete(`/ai-assistance/${kind}/${id}/vote/`));
}

/** The author's own disclosure. `assisted: false` is a real answer and not the same as withdrawing
 *  it — see `retractAuthorMark`. */
export async function declare(
	kind: AssistanceTargetKind,
	id: string,
	assisted: boolean,
	note = ''
): Promise<AssistanceReading> {
	return mapReading(
		await apiClient.put(`/ai-assistance/${kind}/${id}/author-mark/`, { assisted, note })
	);
}

/** Back to "nobody has said", which is a different state from "the author says no". */
export async function retractAuthorMark(
	kind: AssistanceTargetKind,
	id: string
): Promise<AssistanceReading> {
	return mapReading(await apiClient.delete(`/ai-assistance/${kind}/${id}/author-mark/`));
}

/** A moderator ending the argument at a value, with the reason that made them. */
export async function lockScore(
	kind: AssistanceTargetKind,
	id: string,
	value: number,
	reason: string
): Promise<AssistanceReading> {
	return mapReading(await apiClient.put(`/ai-assistance/${kind}/${id}/lock/`, { value, reason }));
}

export async function unlockScore(
	kind: AssistanceTargetKind,
	id: string
): Promise<AssistanceReading> {
	return mapReading(await apiClient.delete(`/ai-assistance/${kind}/${id}/lock/`));
}
