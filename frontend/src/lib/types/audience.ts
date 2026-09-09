/**
 * The audience band — one axis on every content-bearing thing (AUDIENCE-BRIEF.md §1). A single
 * value, never a range: content for "primary and secondary" is two pieces of content in practice,
 * and `all` is the escape hatch a submitter has to pick on purpose. Mirrors backend
 * config/audience.py by hand — the same "small enum, flag the drift risk" convention as
 * DIFFICULTIES/SOURCE_TYPES in utils/labels.ts.
 */
export type Audience =
	'early_years' | 'primary' | 'secondary' | 'university' | 'adult' | 'senior' | 'all';
