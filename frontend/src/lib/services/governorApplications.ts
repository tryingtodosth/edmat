// Applying to look after a discipline, a branch or one material (backend/moderation/applications.py).

import { apiClient } from '$lib/api/client';
import { mapGovernorApplication, type RawGovernorApplication } from '$lib/api/mappers';
import type {
	GovernorApplication,
	GovernorApplicationStatus,
	GovernorNodeKind
} from '$lib/types/governorApplication';

export async function applyToGovern(
	kind: GovernorNodeKind,
	nodeRef: string,
	statement: string
): Promise<GovernorApplication> {
	return mapGovernorApplication(
		await apiClient.post<RawGovernorApplication>('/governor-applications/', {
			kind,
			node_ref: nodeRef,
			statement
		})
	);
}

/** The caller's own applications. */
export async function getMyApplications(): Promise<GovernorApplication[]> {
	const rows = await apiClient.get<RawGovernorApplication[]>('/governor-applications/');
	return rows.map(mapGovernorApplication);
}

/** The whole queue, oldest first. Staff only — for anybody else the server quietly answers with
 *  their own applications instead, which is why this is a separate function rather than a flag. */
export async function getApplicationQueue(
	status?: GovernorApplicationStatus
): Promise<GovernorApplication[]> {
	const query = status ? `&status=${encodeURIComponent(status)}` : '';
	const rows = await apiClient.get<RawGovernorApplication[]>(
		`/governor-applications/?queue=1${query}`
	);
	return rows.map(mapGovernorApplication);
}

export async function decideApplication(
	id: string,
	decision: 'approve' | 'decline',
	note = ''
): Promise<GovernorApplication> {
	return mapGovernorApplication(
		await apiClient.post<RawGovernorApplication>(
			`/governor-applications/${encodeURIComponent(id)}/decide/`,
			{ decision, note }
		)
	);
}

export async function withdrawApplication(id: string): Promise<GovernorApplication> {
	return mapGovernorApplication(
		await apiClient.post<RawGovernorApplication>(
			`/governor-applications/${encodeURIComponent(id)}/withdraw/`,
			{}
		)
	);
}
