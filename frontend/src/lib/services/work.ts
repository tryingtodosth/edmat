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
	// `apiClient` already prepends `PUBLIC_API_BASE_URL`, which itself ends in `/api` — a leading
	// `/api/` here doubled up into `/api/api/work/` (a real 404, found by `e2e/work.mjs`, not just
	// read off the code — house rule 2). See `lib/services/nodes.ts` for the same convention.
	return apiClient.get<WorkDashboard>('/work/');
}
