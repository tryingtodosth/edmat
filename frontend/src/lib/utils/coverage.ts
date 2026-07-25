// MaterialCoverage.level is one 1-100 number, not several separate fields (see the backend's own
// MaterialCoverage model doc comment) — but it's deliberately read under TWO distinct framings, not
// collapsed into one blended label: as a REQUIREMENT ("you should know this to roughly this depth
// before the material is useful to you") and as WHAT IT COVERS ("this is how thoroughly the
// material itself teaches/discusses it"). Both readings share the same underlying number and the
// same bucket below — CoveragePopover.svelte shows both labeled lines explicitly rather than
// picking one, since a reader shouldn't have to guess which question a single figure was answering.
export type CoverageDepth = 'light' | 'moderate' | 'deep';

export function coverageDepth(level: number): CoverageDepth {
	if (level < 34) return 'light';
	if (level < 67) return 'moderate';
	return 'deep';
}
