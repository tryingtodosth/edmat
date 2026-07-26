import { PUBLIC_API_BASE_URL } from '$env/static/public';
import type { Notification } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapNotification, type RawNotification } from '$lib/api/mappers';

/** GET /api/notifications/ — the current user's own inbox, newest first (already ordered
 * server-side, DRF's own pagination is off globally per CLAUDE.md Section 16, so this is always the
 * full list, not one page of it). This is still the one place the FULL history is ever loaded — the
 * live stream below only ever delivers notifications created AFTER it connects. */
export async function getNotifications(): Promise<Notification[]> {
	const raw = await apiClient.get<RawNotification[]>('/notifications/');
	return raw.map(mapNotification);
}

/** ✅ Phase 4 — real-time delivery, closing CLAUDE.md's own long-documented "Notifications:
 * real-time delivery & email, deliberately not built" gap (Section 18 item 9). Opens a real
 * Server-Sent Events connection to the backend's `NotificationStreamView`
 * (notifications/views.py) — a plain `EventSource`, not a hand-rolled polling loop or a WebSocket:
 * SSE is one-way (server → client, exactly the direction this feature needs), needs no new runtime
 * dependency, and `EventSource` already gives reconnect-on-drop behavior for free, matching the
 * `retry:` interval the server's own first frame sends.
 *
 * The token rides in the URL's own query string (`?token=...`), not the `Authorization` header —
 * `EventSource` cannot set custom request headers at all, a real, permanent browser-API limitation,
 * not a workaround for something this app could otherwise do differently. Every OTHER request this
 * app makes keeps using the real header-based token (`lib/api/client.ts`); this is the one,
 * deliberate exception — the backend's own `QueryParamTokenAuthentication` (notifications/views.py)
 * documents the identical tradeoff from its side and is wired onto ONLY this one endpoint.
 */
export function connectNotificationStream(token: string): EventSource {
	return new EventSource(
		`${PUBLIC_API_BASE_URL}/notifications/stream/?token=${encodeURIComponent(token)}`
	);
}

export async function markNotificationRead(id: string): Promise<Notification> {
	const raw = await apiClient.post<RawNotification>(
		`/notifications/${encodeURIComponent(id)}/read/`
	);
	return mapNotification(raw);
}

export async function markAllNotificationsRead(): Promise<void> {
	await apiClient.post('/notifications/read-all/');
}
