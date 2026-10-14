// The browser error report's one network call (backend `analytics/ingest.py`). The reporter that
// decides WHAT may be sent is `lib/errors/reporter.ts`; this only hands the finished, allowlisted
// report to the client's beacon. The staff read of what arrived is `getClientErrors` in
// `services/analytics.ts`, beside the rest of the dashboard.

import { apiClient } from '$lib/api/client';

/** Exactly the fields `LINKING-AND-ERRORS.md` §3.3 allows. The server re-applies the same list. */
export interface ClientErrorReport {
	kind: 'error' | 'rejection' | 'sveltekit';
	message: string;
	stack: string;
	route: string;
	build: string;
	locale: string;
}

export function sendClientError(report: ClientErrorReport): boolean {
	return apiClient.beacon('/client-errors/', report);
}
