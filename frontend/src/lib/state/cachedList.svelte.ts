// Lists that survive a reload, grow rather than blink, and show their own age.
//
// Built on `offlineCache.svelte.ts`, which handles one opaque saved response. A list needs three
// more things, and each is a decision worth naming:
//
// **Merge, don't replace.** Handing a page the fresh array wholesale makes the whole list flash and
// throws away the reader's place — and on a slow connection it happens after they have already
// started reading. So the fresh answer is merged into what is displayed: rows that still exist keep
// their identity, rows that are genuinely new go to the TOP, and rows the server no longer returns
// drop out. Prepending rather than re-sorting is deliberate: "what appeared since I last looked" is
// the question somebody opening a list actually has, and burying three new materials in position 40
// of a name-sorted list answers it badly.
//
// **Keep the last few pages, not just the first.** Somebody who paged to the end of the materials
// list and came back should find it where they left it. Only a bounded number is kept
// (`MAX_PAGES_PER_LIST`), oldest evicted, because localStorage is a handful of megabytes shared
// with everything else.
//
// **Record when each row was last confirmed.** Not when the list was fetched — per row, so the UI
// can grey a row by its own age rather than presenting everything as equally current.
//
// What that amounts to in practice, corrected after actually wiring three lists to it rather than
// left as the original comment's own optimistic reading: a SUCCESSFUL refresh re-stamps every row
// the server still returns, so online and up to date, the whole list sits at full opacity and the
// gradient is invisible. That is the correct outcome — every row genuinely was just confirmed — but
// it means the fade earns its keep in exactly two places: the first paint, before the network has
// answered, and a list shown from the device when the request fails outright. In both, the greyness
// is saying "this is your copy, nobody has confirmed it just now," which is the honest message.
// Per-row ages only diverge WITHIN one list once a list is genuinely paged (page 2 kept from a week
// ago beside a freshly refreshed page 1); none of this app's lists paginate yet.

import { readCache, writeCache } from './offlineCache.svelte';

/** How many pages of one list are kept. Three, because that is what the ask asked for and because
 * a fourth costs real quota for a page somebody is unlikely to return to. */
const MAX_PAGES_PER_LIST = 3;

/** Anything with a stable identity. Everything this app lists has a string `id`. */
export interface Identified {
	id: string;
}

export interface TrackedRow<T> {
	item: T;
	/** When the server last returned this row. Milliseconds since epoch. */
	confirmedAt: number;
	/** True until the reader has had a chance to see it — set on rows that arrived in a merge. */
	isNew: boolean;
}

interface StoredPage<T> {
	rows: { item: T; confirmedAt: number }[];
	fetchedAt: number;
}

function pageKey(name: string, page: number): string {
	return `${name}#p${page}`;
}

function indexKey(name: string): string {
	return `${name}#pages`;
}

/** Which pages of `name` are currently held, most recently used last. */
function readIndex(name: string): number[] {
	return readCache<number[]>(indexKey(name))?.data ?? [];
}

function touchIndex(name: string, page: number): void {
	const pages = readIndex(name).filter((p) => p !== page);
	pages.push(page);
	while (pages.length > MAX_PAGES_PER_LIST) {
		const evicted = pages.shift();
		if (evicted !== undefined) writeCache(pageKey(name, evicted), null);
	}
	writeCache(indexKey(name), pages);
}

/**
 * Merge a fresh page into what is already held.
 *
 * Returns rows in display order: anything genuinely new first, in the order the server gave it,
 * then everything that was already there, in ITS existing order. A row the server no longer returns
 * is dropped — a list that only ever grows would keep showing deleted material.
 */
export function mergeRows<T extends Identified>(
	existing: TrackedRow<T>[],
	fresh: T[],
	now = Date.now()
): TrackedRow<T>[] {
	// A local lookup built and discarded inside this call, not reactive state — SvelteMap here
	// would add reactivity machinery to something nothing ever observes.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const known = new Map(existing.map((row) => [row.item.id, row]));
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- same, a local Set.
	const freshIds = new Set(fresh.map((item) => item.id));

	// A first visit has nothing for a row to be new *against*, so every row would be announced as
	// new — which is precisely the noise "what appeared since I last looked" exists to cut through,
	// and it would be loudest on the one visit where it means least. Rows are still stamped with
	// their confirmation time; they are just not counted as arrivals.
	const hadPrevious = existing.length > 0;

	const added: TrackedRow<T>[] = [];
	const kept: TrackedRow<T>[] = [];

	for (const item of fresh) {
		const previous = known.get(item.id);
		if (previous) {
			// Same row, newer contents: take the server's version but keep the reader's sense of
			// where it was, and stamp it as confirmed now.
			kept.push({ item, confirmedAt: now, isNew: previous.isNew });
		} else {
			added.push({ item, confirmedAt: now, isNew: hadPrevious });
		}
	}

	// Existing rows the server still returns are already in `kept`, but in the SERVER's order.
	// Re-order them to the order the reader last saw, so nothing moves under them.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup, see above.
	const keptById = new Map(kept.map((row) => [row.item.id, row]));
	const inReaderOrder = existing
		.filter((row) => freshIds.has(row.item.id))
		.map((row) => keptById.get(row.item.id)!)
		.filter(Boolean);

	return [...added, ...inReaderOrder];
}

/** Everything held for `name`, page by page, oldest page first. */
export function readList<T>(name: string, page = 1): TrackedRow<T>[] {
	const stored = readCache<StoredPage<T>>(pageKey(name, page))?.data;
	if (!stored) return [];
	return stored.rows.map((row) => ({ ...row, isNew: false }));
}

export function writeList<T>(name: string, page: number, rows: TrackedRow<T>[]): void {
	writeCache<StoredPage<T>>(pageKey(name, page), {
		rows: rows.map(({ item, confirmedAt }) => ({ item, confirmedAt })),
		fetchedAt: Date.now()
	});
	touchIndex(name, page);
}

export interface ListResult<T> {
	rows: TrackedRow<T>[];
	/** True while all we have is what was on the device. */
	fromCache: boolean;
	offline: boolean;
	/** How many rows arrived that were not there before. */
	newCount: number;
}

/**
 * Read-through for a page of a list: saved rows immediately, then merged with the server's answer.
 *
 * `onUpdate` fires up to twice, exactly as `cached()` does — once with what was on the device, once
 * with the merge. The second call is what appends new rows at the top without the list blinking.
 */
export async function cachedList<T extends Identified>(
	name: string,
	fetcher: () => Promise<T[]>,
	onUpdate?: (result: ListResult<T>) => void,
	page = 1
): Promise<ListResult<T>> {
	const held = readList<T>(name, page);
	if (held.length && onUpdate) {
		onUpdate({ rows: held, fromCache: true, offline: false, newCount: 0 });
	}
	try {
		const fresh = await fetcher();
		const merged = mergeRows(held, fresh);
		writeList(name, page, merged);
		const result: ListResult<T> = {
			rows: merged,
			fromCache: false,
			offline: false,
			newCount: merged.filter((row) => row.isNew).length
		};
		onUpdate?.(result);
		return result;
	} catch (error) {
		if (!held.length) throw error;
		const result: ListResult<T> = {
			rows: held,
			fromCache: true,
			offline: true,
			newCount: 0
		};
		onUpdate?.(result);
		return result;
	}
}

// --- freshness ----------------------------------------------------------------------------------

/** Ages, in ms, at which a row stops looking current. */
const FRESH_MS = 5 * 60 * 1000; // just confirmed
const AGING_MS = 24 * 60 * 60 * 1000; // seen today
const OLD_MS = 7 * 24 * 60 * 60 * 1000; // seen this week

/**
 * How faded a row should look, 0 (just confirmed) to 1 (not seen in over a week).
 *
 * Greyness rather than a badge per row: a list of forty rows each carrying "updated 3h ago" is
 * unreadable, where a gradient is taken in at a glance and disappears entirely when everything is
 * current — which is the normal case, and should cost nothing to look at.
 *
 * Stepped, not continuous: a smooth ramp makes every row subtly different and reads as a rendering
 * fault rather than as information.
 */
export function fadeFor(confirmedAt: number, now = Date.now()): number {
	const age = now - confirmedAt;
	if (age < FRESH_MS) return 0;
	if (age < AGING_MS) return 0.25;
	if (age < OLD_MS) return 0.5;
	return 0.7;
}

/** The dimmest a row is ever drawn. Below roughly this, ordinary body text stops clearing WCAG AA. */
const MIN_OPACITY = 0.6;

/**
 * `fadeFor` as an actual CSS opacity, and deliberately NOT `1 - fadeFor(...)`.
 *
 * Rendering the raw fade would put the oldest rows at opacity 0.3, which drops normal body text
 * from roughly 15:1 to roughly 2:1 against the page — well under the 4.5:1 this project measured
 * and fixed its own colour tokens to clear (the accessibility audit that darkened
 * `$light-status-success` for exactly this reason). A row nobody can read is not a row marked as
 * stale, it is a row taken away, and staleness is the least important thing about it.
 *
 * So the same four steps are mapped onto `[MIN_OPACITY, 1]` instead: the gradient still reads at a
 * glance and still disappears entirely when everything is current, and the floor stays legible.
 */
export function opacityFor(confirmedAt: number, now = Date.now()): number {
	return 1 - fadeFor(confirmedAt, now) * (1 - MIN_OPACITY);
}
