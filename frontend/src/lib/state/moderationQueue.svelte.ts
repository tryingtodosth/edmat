// How many moderation decisions are waiting, for the badge in the drawer.
//
// Its own tiny store, matching `notifications.svelte.ts` and `messages.svelte.ts`: a count somebody
// sees in navigation has to be there before they open the page it points at, so it cannot be state
// owned by that page.
//
// It reads a dedicated count endpoint rather than the queue itself. The queue serializes every
// pending submission, edit, translation and report group — titles, per-locale translations, a
// viewer-pool percentage each — and a badge would throw all of it away.
//
// Deliberately does not import `authStore`: that module would have to import this one back to clear
// it on sign-out, which is a real cycle. The same reasoning `notifications.svelte.ts` records, and
// the same arrangement — callers guard, and `clear()` is called from the one place that signs out.

import { getModerationPendingCount } from '$lib/services/moderation';

let total = $state(0);
let loadedFor = $state<string | null>(null);
let loading = $state(false);

export const moderationQueueStore = {
	get total(): number {
		return total;
	},

	/** Called where a moderator's own navigation is drawn. Silently gives up on failure: somebody
	 * who is not a moderator gets a 403 here, which is the feature working, and a badge is not worth
	 * an error message. */
	async ensureLoaded(userId: string | null): Promise<void> {
		if (!userId) {
			total = 0;
			loadedFor = null;
			return;
		}
		if (loadedFor === userId || loading) return;
		loading = true;
		try {
			total = await getModerationPendingCount();
			loadedFor = userId;
		} catch {
			total = 0;
		} finally {
			loading = false;
		}
	},

	/** After acting on something, so the badge stops counting a decision already made. */
	async refresh(): Promise<void> {
		if (loadedFor === null) return;
		try {
			total = await getModerationPendingCount();
		} catch {
			/* leave the last known count rather than blanking it on a transient failure */
		}
	},

	clear(): void {
		total = 0;
		loadedFor = null;
	}
};
