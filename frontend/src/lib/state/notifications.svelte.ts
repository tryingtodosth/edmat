// A Svelte 5 rune module, same "global reactive state that isn't page-scoped" convention
// theme.svelte.ts already established — the Header's bell badge and the /notifications inbox page
// both need to read/refresh the SAME list, not two independently-fetched copies.
//
// ✅ Phase 4 — real-time delivery. `refresh()` still does the one-time full-history fetch (page
// mount, opening the bell, a fresh login/register — unchanged); it now ALSO opens a live SSE
// connection (`connectLiveStream`, below) the first time it's called, so a notification created
// AFTER that point arrives pushed, not on the next explicit fetch. Importing `tokenStore`
// (token.svelte.ts), not `authStore`, for the same reason this module has always avoided importing
// `authStore` directly — `token.svelte.ts` is a deliberately dependency-free leaf module (its own
// doc comment: "has no dependency on either, breaking the cycle"), so importing it here creates no
// circular-import risk the way `authStore` would.
import type { Notification } from '$lib/types';
import type { RawNotification } from '$lib/api/mappers';
import { mapNotification } from '$lib/api/mappers';
import {
	connectNotificationStream,
	getNotifications,
	markAllNotificationsRead,
	markNotificationRead
} from '$lib/services/notifications';
import { tokenStore } from './token.svelte';

let items = $state<Notification[]>([]);
let loaded = $state(false);
// Deliberately NOT $state — nothing in a template ever reads this directly, it's pure internal
// connect/disconnect bookkeeping (the same "plain module-level `let`, not every value needs to be
// reactive" restraint this app already applies elsewhere, e.g. `tokenStore`'s own STORAGE_KEY).
let eventSource: EventSource | null = null;

function connectLiveStream(): void {
	if (eventSource || !tokenStore.value) return; // already connected, or nothing to authenticate with
	eventSource = connectNotificationStream(tokenStore.value);
	eventSource.onmessage = (event) => {
		const raw = JSON.parse(event.data) as RawNotification;
		const notification = mapNotification(raw);
		// A fresh push is always the newest — prepend. Guard against a duplicate in the rare case a
		// manual refresh() and a live push both deliver the same row at nearly the same moment.
		if (!items.some((n) => n.id === notification.id)) {
			items = [notification, ...items];
		}
	};
	// EventSource auto-reconnects natively on a dropped connection (its own built-in retry
	// behavior, using the `retry:` interval the server's first frame sends) — an `onerror` handler
	// only needs to exist here so a transient drop doesn't surface as an unhandled browser console
	// error; there's nothing extra this app needs to DO beyond letting the browser retry.
	eventSource.onerror = () => {};
}

export const notificationStore = {
	get items(): Notification[] {
		return items;
	},
	get unreadCount(): number {
		return items.filter((n) => !n.isRead).length;
	},
	get loaded(): boolean {
		return loaded;
	},

	/** Fetches the current user's own inbox, and — Phase 4 — opens the live SSE connection the
	 * first time it's called (a no-op if one's already open). Deliberately doesn't check
	 * authStore.isAuthenticated itself (importing auth.svelte.ts here would be a circular import —
	 * that module would need to import THIS one right back to clear it on logout) — every call site
	 * already only calls this from behind its own `{#if authStore.isAuthenticated}` guard
	 * (Header.svelte's bell, the root layout's mount, login/register's own post-success handlers,
	 * /notifications itself), so an unauthenticated call is simply never made in practice, and by
	 * the time it IS called `tokenStore.value` is always already set. Safe to call repeatedly; each
	 * call replaces the whole list with the freshest server state rather than trying to merge/
	 * dedupe client-side — connecting the stream, by contrast, only ever happens once, since a
	 * second `refresh()` on an already-live connection has nothing new to wire up. */
	async refresh(): Promise<void> {
		items = await getNotifications();
		loaded = true;
		connectLiveStream();
	},

	/** Clears the local cache AND closes the live stream — called from logout() so a signed-out
	 * visitor never sees a stale, previous account's own notifications for a moment before the next
	 * refresh, and so a stream authenticated as the OLD account can't keep delivering pushes (or
	 * silently fail to reconnect as a new one) after the session that opened it has ended. */
	clear(): void {
		items = [];
		loaded = false;
		eventSource?.close();
		eventSource = null;
	},

	async markRead(id: string): Promise<void> {
		const target = items.find((n) => n.id === id);
		if (!target || target.isRead) return;
		// Optimistic — same "patch the local display, don't wait on the round-trip" discipline this
		// app's own guestSetStore/CoveragePopover already follow for their own local mutations.
		items = items.map((n) => (n.id === id ? { ...n, isRead: true } : n));
		try {
			await markNotificationRead(id);
		} catch {
			// Revert on failure rather than leaving the UI lying about server state.
			items = items.map((n) => (n.id === id ? { ...n, isRead: false } : n));
		}
	},

	async markAllRead(): Promise<void> {
		if (items.every((n) => n.isRead)) return;
		const previous = items;
		items = items.map((n) => ({ ...n, isRead: true }));
		try {
			await markAllNotificationsRead();
		} catch {
			items = previous;
		}
	}
};
