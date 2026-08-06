// Splitting the taxonomy into "settled" and "somebody suggested this".
//
// A proposed discipline/branch/topic is REAL from the moment it is proposed — it exists, it can be
// filed against, and it comes back from the API like any other node (see backend
// taxonomy/views.py's ProposeNodeView). That is deliberate: a word you cannot use until a moderator
// wakes up is no use to the person who needed it. The cost of that choice is that the settled
// vocabulary and one person's guess would otherwise sit side by side looking equally authoritative.
//
// So every list separates them, rather than hiding pending ones (useless) or mixing them in
// (misleading). In a card grid that means a second section under an "Others" heading; in a <select>
// it means an <optgroup>, which is the native, screen-reader-legible way to say the same thing.

import type { TaxonomyStatus } from '$lib/types';

/** Anything the taxonomy API returns: a Discipline, a Branch or a Topic. */
interface WithStatus {
	status: TaxonomyStatus;
}

export function isPending(node: WithStatus | undefined | null): boolean {
	return node?.status === 'pending';
}

/**
 * `{ settled, proposed }` — one pass, both halves, order preserved within each.
 *
 * Returned as a pair rather than as two `.filter()` calls at each call site because the two lists
 * have to stay complementary: a node that fell out of both (or into both) would be invisible or
 * duplicated, and that is much easier to get wrong twice in two adjacent `$derived` lines than
 * once here.
 */
export function splitByStatus<T extends WithStatus>(nodes: T[]): { settled: T[]; proposed: T[] } {
	const settled: T[] = [];
	const proposed: T[] = [];
	for (const node of nodes) (isPending(node) ? proposed : settled).push(node);
	return { settled, proposed };
}
