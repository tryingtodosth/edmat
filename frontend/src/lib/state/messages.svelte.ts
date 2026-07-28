// A Svelte 5 rune module — same "global reactive state that isn't page-scoped" convention
// notifications.svelte.ts already established, deliberately lighter: just the unread-count badge
// (Header's own nav link, mirroring the pre-existing "My Set" guest-count badge shape), refreshed
// on demand rather than via a live SSE connection — this app's own messaging feature has no
// real-time push requirement the way notifications.svelte.ts's own SSE stream does, so a plain
// refetch-on-the-obvious-moments (mount, login/register, after sending/opening a message) is
// honest and sufficient rather than a second live connection duplicating that infrastructure.

import { getUnreadMessageCount } from '$lib/services/messaging';

let unreadCount = $state(0);

export const messagesStore = {
	get unreadCount(): number {
		return unreadCount;
	},

	/** Re-fetches the current user's own unread count. Safe to call repeatedly (every call site
	 * already guards on `authStore.isAuthenticated`, the same convention notifications.svelte.ts's
	 * own `refresh()` documents for the identical reason). */
	async refresh(): Promise<void> {
		unreadCount = await getUnreadMessageCount();
	},

	/** Called from logout() so a signed-out visitor never sees a stale, previous account's own
	 * unread badge for a moment before the next refresh. */
	clear(): void {
		unreadCount = 0;
	}
};
