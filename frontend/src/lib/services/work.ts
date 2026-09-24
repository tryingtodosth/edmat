/**
 * Service for the personal work dashboard.
 * Root `CLAUDE.md`: "No component or route contains fetch logic, ever" — this is the only seam.
 */

import { apiClient } from '$lib/api/client';
import type { WorkDashboard } from '$lib/types/work';

/**
 * GET /api/work/ — all work items waiting on me.
 */
export async function getWorkDashboard(): Promise<WorkDashboard> {
	return apiClient.get<WorkDashboard>('/api/work/');
}
