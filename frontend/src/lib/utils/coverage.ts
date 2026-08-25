import type { ClaimKind, MaterialCoverage } from '$lib/types';
import { m } from '$lib/paraglide/messages.js';

// A claim's `level` is one 1-100 number answering ONE question, chosen by its `kind`: a `covers`
// claim says how thoroughly the material treats the topic, a `requires` claim says how much of it
// you should already know first. The bucket thresholds are shared; the words are not — "deep
// coverage" and "advanced knowledge needed" are different sentences about different things.
export type CoverageDepth = 'light' | 'moderate' | 'deep';

export function coverageDepth(level: number): CoverageDepth {
	if (level < 34) return 'light';
	if (level < 67) return 'moderate';
	return 'deep';
}

export function depthLabel(kind: ClaimKind, depth: CoverageDepth): string {
	if (kind === 'requires') {
		if (depth === 'light') return m.coverage_require_light(); // "Basics needed"
		if (depth === 'moderate') return m.coverage_require_moderate(); // "Solid grounding needed"
		return m.coverage_require_deep(); // "Advanced knowledge needed"
	}
	if (depth === 'light') return m.coverage_depth_light(); // "Light coverage"
	if (depth === 'moderate') return m.coverage_depth_moderate(); // "Moderate coverage"
	return m.coverage_depth_deep(); // "Deep coverage"
}

// The one display order for claims, everywhere they are listed: the community's importance vote
// first (that vote exists purely to decide this), the accuracy vote as the tie-break, and id last
// so two untouched claims never swap places between renders.
export function sortClaims<T extends MaterialCoverage>(claims: T[]): T[] {
	return [...claims].sort(
		(a, b) =>
			b.importanceSummary.netWeight - a.importanceSummary.netWeight ||
			b.voteSummary.netWeight - a.voteSummary.netWeight ||
			Number(a.id) - Number(b.id)
	);
}

export function claimsOfKind<T extends MaterialCoverage>(claims: T[], kind: ClaimKind): T[] {
	return sortClaims(claims.filter((c) => c.kind === kind));
}
