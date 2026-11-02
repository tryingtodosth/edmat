// The audience lens over the taxonomy (owner, 2026-11-02: "we want the audience to be the primary
// way of serving materials"). A node carries counts for EVERY band (backend `taxonomy/counts.py`);
// this file is where the reader's bands are applied to them, with the same rule the server's
// `config/audience.py: apply_audience_filter` applies to a list: the chosen bands plus `all`, and
// no bands at all means no narrowing. Keep the two in step — a card that says 12 over a list that
// shows 9 for a reason other than language is exactly the disagreement this exists to prevent.

import type { Audience, CountedKind, NodeCounts } from '$lib/types';

export const COUNTED_KINDS: CountedKind[] = ['exercises', 'materials', 'courses'];

/** Whether a row marked `band` passes the lens `bands` — mirrors `apply_audience_filter`. */
export function inLens(band: Audience, bands: Audience[]): boolean {
	return bands.length === 0 || band === 'all' || bands.includes(band);
}

/** How many of `kind` under a node pass the lens (every kind when `kind` is omitted). */
export function lensCount(
	counts: NodeCounts | undefined,
	bands: Audience[],
	kind?: CountedKind
): number {
	if (!counts) return 0;
	let total = 0;
	for (const k of kind ? [kind] : COUNTED_KINDS) {
		for (const [band, n] of Object.entries(counts[k] ?? {}) as [Audience, number][]) {
			if (inLens(band, bands)) total += n;
		}
	}
	return total;
}

/** Everything under a node, lens or not. */
export function allCount(counts: NodeCounts | undefined, kind?: CountedKind): number {
	return lensCount(counts, [], kind);
}

/** Per band, every kind summed, biggest first — what a greyed card says it DOES have. */
export function bandTotals(counts: NodeCounts | undefined): [Audience, number][] {
	const totals = new Map<Audience, number>();
	if (counts) {
		for (const k of COUNTED_KINDS) {
			for (const [band, n] of Object.entries(counts[k] ?? {}) as [Audience, number][]) {
				totals.set(band, (totals.get(band) ?? 0) + n);
			}
		}
	}
	return [...totals.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
}

/** Sums a list of nodes' counts into one, so a page can speak about all of them at once. */
export function sumCounts(nodes: { counts?: NodeCounts }[]): NodeCounts {
	const out: NodeCounts = { exercises: {}, materials: {}, courses: {} };
	for (const node of nodes) {
		for (const k of COUNTED_KINDS) {
			for (const [band, n] of Object.entries(node.counts?.[k] ?? {}) as [Audience, number][]) {
				out[k][band] = (out[k][band] ?? 0) + n;
			}
		}
	}
	return out;
}

/**
 * Splits nodes into those with something for the lens (biggest first, ties keep the server's
 * order) and those without, which the page folds under "For other groups" rather than hiding —
 * owner, 2026-11-02: greyed and folded, never silently gone. Inside the fold, nodes that have
 * something for SOMEBODY come first and nodes with nothing published at all come last.
 *
 * An empty node is folded too, not left leading the page: the first browser run kept them in the
 * main grid (on the reasoning that an empty node is not "for other groups") and the result was
 * three empty disciplines on top while the one discipline with 771 items sat folded underneath.
 * With no lens nothing is folded and the server's order stands.
 */
export function splitByLens<T extends { counts?: NodeCounts }>(
	nodes: T[],
	bands: Audience[]
): { shown: T[]; folded: T[] } {
	if (bands.length === 0) return { shown: nodes, folded: [] };
	const order = new Map(nodes.map((n, i) => [n, i]));
	const byServer = (a: T, b: T) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
	const shown = nodes.filter((n) => lensCount(n.counts, bands) > 0);
	const folded = nodes.filter((n) => lensCount(n.counts, bands) === 0);
	shown.sort((a, b) => lensCount(b.counts, bands) - lensCount(a.counts, bands) || byServer(a, b));
	folded.sort((a, b) => allCount(b.counts) - allCount(a.counts) || byServer(a, b));
	return { shown, folded };
}
