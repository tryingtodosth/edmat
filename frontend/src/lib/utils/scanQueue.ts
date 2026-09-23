// The scanner's offline queue (CONFERENCE-BRIEF.md §3.D), in IndexedDB.
//
// Why IndexedDB and not localStorage: a door queue must survive the tab being backgrounded and
// killed by the phone's OS, which is exactly when the Wi-Fi is also down, and it is written from a
// camera loop that must not block on a synchronous string serialization of the whole queue on
// every scan. localStorage is both synchronous and small; this is neither.
//
// Two collections in one store, keyed by event: the queue (scans not yet acknowledged) and the
// cached check-in list (so the door still knows a name with no network). Both are per-event,
// because a volunteer with two events on their phone must never drain one into the other.
//
// Everything here degrades to "no cache, no queue" rather than throwing: private windows, blocked
// site data and the prerender pass all have no IndexedDB, and a scanner that refuses to open
// because it cannot remember things is worse than one that simply forgets.

import type { CheckinListRow, QueuedScan } from '$lib/types/ticket';

const DB_NAME = 'edmat-scan';
const DB_VERSION = 1;
const QUEUE_STORE = 'queue';
const LIST_STORE = 'lists';

function openDb(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === 'undefined') return Promise.resolve(null);
	return new Promise((resolve) => {
		let request: IDBOpenDBRequest;
		try {
			request = indexedDB.open(DB_NAME, DB_VERSION);
		} catch {
			resolve(null);
			return;
		}
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(QUEUE_STORE)) {
				// Keyed by the client nonce: the same scan written twice (a double tap, a replayed
				// decode of the same frame) is one row, which is the client half of the server's own
				// idempotency rule.
				const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'clientNonce' });
				store.createIndex('eventId', 'eventId', { unique: false });
			}
			if (!db.objectStoreNames.contains(LIST_STORE)) {
				db.createObjectStore(LIST_STORE, { keyPath: 'eventId' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		request.onblocked = () => resolve(null);
	});
}

function run<T>(
	store: string,
	mode: IDBTransactionMode,
	body: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
	return openDb().then(
		(db) =>
			new Promise<T | null>((resolve) => {
				if (!db) return resolve(null);
				let request: IDBRequest<T>;
				try {
					request = body(db.transaction(store, mode).objectStore(store));
				} catch {
					db.close();
					return resolve(null);
				}
				request.onsuccess = () => {
					resolve(request.result);
					db.close();
				};
				request.onerror = () => {
					resolve(null);
					db.close();
				};
			})
	);
}

type StoredScan = QueuedScan & { eventId: string };

export async function enqueueScan(eventId: string, scan: QueuedScan): Promise<void> {
	await run(QUEUE_STORE, 'readwrite', (s) => s.put({ ...scan, eventId } as StoredScan));
}

export async function readQueue(eventId: string): Promise<QueuedScan[]> {
	const all = (await run<StoredScan[]>(QUEUE_STORE, 'readonly', (s) => s.getAll())) ?? [];
	return all
		.filter((row) => row.eventId === eventId)
		.sort((a, b) => a.clientAt.localeCompare(b.clientAt))
		.map(({ eventId: _ignored, ...scan }) => scan);
}

/** Drop exactly the nonces the server acknowledged. Never "clear the queue": scans can arrive
 *  while a sync is in flight, and clearing would silently lose the ones that did. */
export async function dropScans(nonces: string[]): Promise<void> {
	for (const nonce of nonces) {
		await run(QUEUE_STORE, 'readwrite', (s) => s.delete(nonce) as unknown as IDBRequest<undefined>);
	}
}

export async function cacheCheckinList(eventId: string, rows: CheckinListRow[]): Promise<void> {
	await run(LIST_STORE, 'readwrite', (s) => s.put({ eventId, rows, cachedAt: Date.now() }));
}

export async function readCachedList(
	eventId: string
): Promise<{ rows: CheckinListRow[]; cachedAt: number } | null> {
	const row = await run<{ rows: CheckinListRow[]; cachedAt: number } | undefined>(
		LIST_STORE,
		'readonly',
		(s) => s.get(eventId)
	);
	return row ? { rows: row.rows ?? [], cachedAt: row.cachedAt ?? 0 } : null;
}

/** A nonce per scan. `crypto.randomUUID` where it exists (every browser with a camera does), and a
 *  random fallback so the module never throws in an older or insecure context — the nonce only has
 *  to be unique, not unguessable. */
export function newNonce(): string {
	const c = typeof crypto !== 'undefined' ? crypto : undefined;
	if (c && typeof c.randomUUID === 'function') return c.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
