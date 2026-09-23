// Tickets, the door and the badge sheet (CONFERENCE-BRIEF.md §3.D) — mirrors
// backend/events/ticket_views.py one-to-one. Hand-written mapping like every other service module
// here: the backend speaks snake_case, this app speaks camelCase, and this is the one place a
// field rename can break.
//
// Nothing below fetches. `lib/api/client.ts` is the only `fetch()` in the app, including for the
// scanner — the offline queue lives in IndexedDB (`lib/utils/scanQueue.ts`) and is drained THROUGH
// this module, so "works with no network" did not become a second, quieter HTTP client.

import { apiClient } from '$lib/api/client';
import type {
	BadgeSheet,
	CheckinListRow,
	MyTicket,
	QueuedScan,
	ScanBatchReply,
	ScanCounts,
	ScanLog,
	ScanOutcome
} from '$lib/types/ticket';

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapTicket(raw: any): MyTicket {
	return {
		token: raw.token ?? '',
		shortCode: raw.short_code ?? '',
		status: raw.status ?? '',
		badgeName: raw.badge_name ?? '',
		isMinor: raw.is_minor ?? false,
		checkedInAt: raw.checked_in_at ?? null,
		checkedOutAt: raw.checked_out_at ?? null,
		inside: raw.inside ?? false,
		event: {
			id: String(raw.event?.id ?? ''),
			title: raw.event?.title ?? '',
			startsAt: raw.event?.starts_at ?? null,
			endsAt: raw.event?.ends_at ?? null,
			runsUntil: raw.event?.runs_until ?? null,
			locationKind: raw.event?.location_kind ?? 'onsite',
			locationText: raw.event?.location_text ?? '',
			onlineUrl: raw.event?.online_url ?? ''
		}
	};
}

function mapRow(raw: any): CheckinListRow {
	return {
		token: raw.token ?? '',
		shortCode: raw.short_code ?? '',
		name: raw.name ?? '',
		status: raw.status ?? '',
		checkedInAt: raw.checked_in_at ?? null,
		checkedOutAt: raw.checked_out_at ?? null,
		inside: raw.inside ?? false
	};
}

function mapOutcome(raw: any): ScanOutcome {
	return {
		clientNonce: raw.client_nonce ?? '',
		result: raw.result,
		direction: raw.direction ?? 'entry',
		token: raw.token ?? '',
		name: raw.name ?? '',
		clientAt: raw.client_at ?? null,
		receivedAt: raw.received_at,
		isOfflineSync: raw.is_offline_sync ?? false,
		deviceLabel: raw.device_label ?? '',
		scannedBy: raw.scanned_by
	};
}

function mapCounts(raw: any): ScanCounts {
	return {
		entries: raw?.entries ?? 0,
		exits: raw?.exits ?? 0,
		inside: raw?.inside ?? 0,
		refused: raw?.refused ?? 0,
		collisions: raw?.collisions ?? 0
	};
}

export async function getMyTicket(eventId: string, attendeeId?: string): Promise<MyTicket> {
	const query = attendeeId ? `?attendee=${encodeURIComponent(attendeeId)}` : '';
	return mapTicket(await apiClient.get<any>(`/events/${eventId}/my-ticket/${query}`));
}

export async function rotateMyTicket(eventId: string, attendeeId?: string): Promise<MyTicket> {
	return mapTicket(
		await apiClient.post<any>(
			`/events/${eventId}/my-ticket/rotate/`,
			attendeeId ? { attendee: attendeeId } : undefined
		)
	);
}

export async function getCheckinList(eventId: string): Promise<CheckinListRow[]> {
	return (await apiClient.get<any[]>(`/events/${eventId}/checkin-list/`)).map(mapRow);
}

/** One sync. The server answers per nonce, so the caller matches its own queue up by nonce rather
 *  than by position — a queue that grew while the request was in flight must still drain correctly. */
export async function postScans(eventId: string, scans: QueuedScan[]): Promise<ScanBatchReply> {
	const body = {
		scans: scans.map((s) => ({
			token: s.token,
			direction: s.direction,
			client_nonce: s.clientNonce,
			client_at: s.clientAt,
			device_label: s.deviceLabel,
			is_offline_sync: s.isOfflineSync
		}))
	};
	const raw = await apiClient.post<any>(`/events/${eventId}/scans/`, body);
	return { results: (raw.results ?? []).map(mapOutcome), counts: mapCounts(raw.counts) };
}

export async function getScanLog(eventId: string): Promise<ScanLog> {
	const raw = await apiClient.get<any>(`/events/${eventId}/scans/`);
	return { counts: mapCounts(raw.counts), scans: (raw.scans ?? []).map(mapOutcome) };
}

export async function getBadgeSheet(eventId: string): Promise<BadgeSheet> {
	const raw = await apiClient.get<any>(`/events/${eventId}/badge-sheet/`);
	return {
		eventTitle: raw.event_title ?? '',
		badges: (raw.badges ?? []).map((b: any) => ({
			name: b.name ?? '',
			isMinor: b.is_minor ?? false,
			shortCode: b.short_code ?? ''
		}))
	};
}
