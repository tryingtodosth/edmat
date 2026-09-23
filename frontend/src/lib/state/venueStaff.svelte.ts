// Whether this account runs any building — the one fact the "Venues you run" entry in the Add…
// menu hangs off (CONFERENCE-BRIEF.md §3.A: the entry is for staff of a venue only, and the browse
// link lives in the footer instead).
//
// A rune module rather than a `$derived` inside `Header.svelte`, for the reason
// `notifications.svelte.ts` and `messages.svelte.ts` already establish: the header is mounted once
// for the whole app and the answer is fetched once, not per route.
//
// Deliberately **fails CLOSED**: `runsSomething` is false until a fetch has actually said otherwise.
// That is the opposite of `featureFlags.svelte.ts`, and on purpose — a flag failing open shows a
// link that works for everybody, while this failing open would show every visitor a menu entry to a
// desk they cannot open. A link that appears half a second late is better than one that lies.

import { getMyVenues } from '$lib/services/venues';
import type { VenueSummary } from '$lib/types/venue';

let venues = $state<VenueSummary[]>([]);
let loadedForUser = $state<string | null>(null);

export const venueStaffStore = {
	get venues(): VenueSummary[] {
		return venues;
	},
	get runsSomething(): boolean {
		return venues.length > 0;
	},

	/** Idempotent per account, so an `$effect` in the header may call it on every run. `null` (signed
	 *  out, or the `venues` flag off) clears — the same shape `moderationQueueStore.ensureLoaded`
	 *  uses, and the reason the header does not need its own guard. */
	async ensureLoaded(userId: string | null): Promise<void> {
		if (userId === null) {
			venues = [];
			loadedForUser = null;
			return;
		}
		if (loadedForUser === userId) return;
		loadedForUser = userId;
		try {
			venues = await getMyVenues();
		} catch {
			venues = [];
		}
	},

	clear(): void {
		venues = [];
		loadedForUser = null;
	}
};
