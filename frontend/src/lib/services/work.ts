/**
 * Service for the personal work dashboard.
 * Root `CLAUDE.md`: "No component or route contains fetch logic, ever" — this is the only seam.
 */

import { apiClient } from '$lib/api/client';
import type { NodeRef } from '$lib/types/node';
import type { WorkDashboard, WorkItem } from '$lib/types/work';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A node as the dashboard's rows carry it. `id` is a NUMBER on the wire (`config/nodes.py:
 *  node_ref` sends `node.pk`) and a string in `NodeRef`, which is this app's id convention
 *  (`lib/api/`: everything but a Discipline or a Branch is `String(pk)`).
 *
 *  **This mapper is a bug fix, and the bug is older than contests.** `getWorkDashboard` used to
 *  hand the raw JSON straight back under the `WorkDashboard` type — a type lie — and `/work` draws
 *  `nodeHref(item.node)`, which calls SvelteKit's `resolve()`, which calls `.startsWith` on every
 *  param. A numeric id therefore threw `param_value.startsWith is not a function` **during render**,
 *  and the page stayed on "Loading your work…" for ever. It has been true for every work item with
 *  a node since `nodeHref` landed (2026-10-08) and was found on 2026-10-09 by the contests step,
 *  whose preset puts seventeen tasks on one person's dashboard — `services/tasks.ts` and
 *  `services/plans.ts` have had the identical `String(raw.id)` all along, which is what this one
 *  was missing rather than anything new.
 */
function mapNode(raw: any): NodeRef | null {
	if (!raw) return null;
	return {
		kind: raw.kind,
		id: String(raw.id),
		title: raw.title ?? '',
		isStaff: raw.is_staff ?? false,
		isMember: raw.is_member ?? false,
		canManage: raw.can_manage ?? false,
		openBoard: raw.open_board ?? false,
		// An organisation's route is its slug (`utils/nodeHref.ts`); the other kinds send none.
		...(raw.slug ? { slug: String(raw.slug) } : {})
	};
}

function mapItem(raw: any): WorkItem {
	return { ...raw, node: mapNode(raw.node) };
}

/**
 * GET /api/work/ — all work items waiting on me.
 */
export async function getWorkDashboard(): Promise<WorkDashboard> {
	// `apiClient` already prepends `PUBLIC_API_BASE_URL`, which itself ends in `/api` — a leading
	// `/api/` here doubled up into `/api/api/work/` (a real 404, found by `e2e/work.mjs`, not just
	// read off the code — house rule 2). See `lib/services/nodes.ts` for the same convention.
	const raw = await apiClient.get<any>('/work/');
	return {
		...raw,
		sections: (raw?.sections ?? []).map((section: any) => ({
			...section,
			items: (section.items ?? []).map(mapItem)
		}))
	};
}
