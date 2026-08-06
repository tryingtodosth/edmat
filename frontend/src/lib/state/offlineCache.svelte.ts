// Last-known API responses, kept on the device so a page opens with content instead of an empty
// state.
//
// **The problem this solves.** Every list in this app renders nothing until its fetch resolves, and
// on a phone on a train that is most of the visit — so the honest-but-useless "Nothing here yet"
// is what people actually see, and it is indistinguishable from "this course really is empty". A
// saved copy turns that into the page you had last time, marked as saved, refreshed when the
// network answers.
//
// **Opt-in per call site, deliberately — not a wrapper around `apiClient`.** Caching every GET
// would be one line and a real privacy bug: `/courses/{id}/notes/` is somebody's private notes and
// `/messages/` is their correspondence, and both would then sit in localStorage on a shared phone
// after they signed out. Nothing is cached unless a caller asks, so adding a cached endpoint is a
// decision somebody makes rather than one they inherit.
//
// It is still cleared on sign-out (see `auth.svelte.ts`), because "public to you while signed in"
// is not the same as "public to the next person holding the phone".

const PREFIX = 'edmat-cache:';
/** Bumped when a cached shape changes. An old entry is dropped rather than fed to a new mapper. */
const VERSION = 1;
/** Roughly what localStorage will take before it throws, leaving room for everything else. */
const MAX_ENTRY_BYTES = 256 * 1024;
/** Past this, a saved copy is old enough that showing it unlabelled would be misleading. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

interface Entry<T> {
	v: number;
	at: number;
	data: T;
}

function keyFor(name: string): string {
	return `${PREFIX}${name}`;
}

/** The saved copy for `name`, or null. Never throws — a corrupt entry is simply not a cache hit. */
export function readCache<T>(name: string): { data: T; savedAt: number; stale: boolean } | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(keyFor(name));
		if (!raw) return null;
		const entry = JSON.parse(raw) as Entry<T>;
		if (entry.v !== VERSION) {
			localStorage.removeItem(keyFor(name));
			return null;
		}
		return {
			data: entry.data,
			savedAt: entry.at,
			stale: Date.now() - entry.at > STALE_AFTER_MS
		};
	} catch {
		return null;
	}
}

export function writeCache<T>(name: string, data: T): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const payload = JSON.stringify({ v: VERSION, at: Date.now(), data } satisfies Entry<T>);
		// A single huge response would evict everything else the moment the quota is hit, so it is
		// simply not cached. Better to have no saved copy of one page than no saved copy of any.
		if (payload.length > MAX_ENTRY_BYTES) return;
		localStorage.setItem(keyFor(name), payload);
	} catch {
		// Quota exceeded, or storage disabled. Drop the whole cache rather than leaving a partial
		// one whose entries are now arbitrarily old, then give up on this write.
		clearCache();
	}
}

/** Wipe every cached response. Called on sign-out. */
export function clearCache(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith(PREFIX)) localStorage.removeItem(key);
		}
	} catch {
		// Nothing sensible to do; the entries are unreadable anyway.
	}
}

export interface CachedResult<T> {
	data: T | null;
	/** True while the network request is still in flight AND all we have is a saved copy. */
	fromCache: boolean;
	savedAt: number | null;
	stale: boolean;
	/** Set when the network failed and a saved copy is all there is. */
	offline: boolean;
}

/**
 * Read-through: hand back the saved copy at once, then the fresh one when it arrives.
 *
 * `onUpdate` is called up to twice — immediately with the cached value if there is one, and again
 * with the network's answer. That is what lets a page paint content on the first frame and correct
 * itself a moment later, instead of showing an empty state for the length of a round trip.
 *
 * A network failure with a saved copy in hand is NOT an error: it resolves with `offline: true` so
 * the page can say "saved copy" rather than "something went wrong". A failure with nothing cached
 * rethrows, because then there is genuinely nothing to show.
 */
export async function cached<T>(
	name: string,
	fetcher: () => Promise<T>,
	onUpdate?: (result: CachedResult<T>) => void
): Promise<CachedResult<T>> {
	const hit = readCache<T>(name);
	if (hit && onUpdate) {
		onUpdate({
			data: hit.data,
			fromCache: true,
			savedAt: hit.savedAt,
			stale: hit.stale,
			offline: false
		});
	}
	try {
		const fresh = await fetcher();
		writeCache(name, fresh);
		const result: CachedResult<T> = {
			data: fresh,
			fromCache: false,
			savedAt: Date.now(),
			stale: false,
			offline: false
		};
		onUpdate?.(result);
		return result;
	} catch (error) {
		if (!hit) throw error;
		const result: CachedResult<T> = {
			data: hit.data,
			fromCache: true,
			savedAt: hit.savedAt,
			stale: hit.stale,
			offline: true
		};
		onUpdate?.(result);
		return result;
	}
}
