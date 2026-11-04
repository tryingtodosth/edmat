/**
 * Polls service — API calls for the decisions step
 * The single seam between routes/components and the backend
 */

import { getLocale } from '$lib/paraglide/runtime';
import { apiClient } from '$lib/api/client';
import type { NodeKind } from '$lib/types/node';
import type { Poll, PollOption, PollResults } from '$lib/types/poll';

/** `?lang=<interface locale>` on every read — the `services/taxonomy.ts` pattern. Without it the
 *  backend's `request_locale` falls back to 'pl' and an English reader silently gets the Polish
 *  (translations/, 2026-10-08). */
function langQuery(): string {
	return `?lang=${encodeURIComponent(getLocale())}`;
}

// Get polls for a node
export async function getNodePolls(nodeKind: NodeKind, nodeId: number): Promise<Poll[]> {
	return await apiClient.get<Poll[]>(`/nodes/${nodeKind}/${nodeId}/polls/${langQuery()}`);
}

// Create a new poll (draft)
export async function createPoll(
	nodeKind: NodeKind,
	nodeId: number,
	data: {
		question: string;
		description?: string;
		mode: 'single' | 'multiple';
		anonymous?: boolean;
		eligibility: 'staff' | 'members';
		opens_at?: string | null;
		closes_at?: string | null;
	}
): Promise<Poll> {
	return await apiClient.post<Poll>(`/nodes/${nodeKind}/${nodeId}/polls/`, data);
}

// Get a single poll
export async function getPoll(pollId: number): Promise<Poll> {
	return await apiClient.get<Poll>(`/polls/${pollId}/${langQuery()}`);
}

// Update a draft poll
export async function updatePoll(pollId: number, data: Partial<Poll>): Promise<Poll> {
	return await apiClient.patch<Poll>(`/polls/${pollId}/`, data);
}

// Delete a draft poll
export async function deletePoll(pollId: number): Promise<void> {
	await apiClient.delete(`/polls/${pollId}/`);
}

// Add an option to a draft poll
export async function addPollOption(
	pollId: number,
	data: { text: string; order?: number }
): Promise<PollOption> {
	return await apiClient.post<PollOption>(`/polls/${pollId}/options/`, data);
}

// Delete an option from a draft poll
export async function deletePollOption(optionId: number): Promise<void> {
	await apiClient.delete(`/poll-options/${optionId}/`);
}

// Open a poll for voting
export async function openPoll(pollId: number): Promise<Poll> {
	return await apiClient.post<Poll>(`/polls/${pollId}/open/`, {});
}

// Close a poll
export async function closePoll(pollId: number, decisionNote: string): Promise<Poll> {
	return await apiClient.post<Poll>(`/polls/${pollId}/close/`, { decision_note: decisionNote });
}

// Cast a vote
export async function vote(pollId: number, optionIds: number[]): Promise<{ detail: string }> {
	return await apiClient.post<{ detail: string }>(`/polls/${pollId}/vote/`, { options: optionIds });
}

// Get poll results
export async function getPollResults(pollId: number): Promise<PollResults> {
	// `?lang=` too (2026-11-02): an option's text is bilingual like the question, and the results
	// list named every option in Polish to an English reader while the ballot above it was English.
	return await apiClient.get<PollResults>(`/polls/${pollId}/results/${langQuery()}`);
}
