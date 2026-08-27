import type { CoverageVoteSummary } from './material';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type SourceType = 'exercises' | 'midterm' | 'exam' | 'other';

export interface ExerciseSource {
	type: SourceType;
	name?: string;
	collection?: string;
	originalProblemNumber?: number;
	pages?: string;
	chapter?: number;
}

/**
 * Structural metadata only — NO human-language text lives here. See ExerciseTranslation below and
 * CLAUDE.md Section 10 for why: interface language and content translation are two deliberately
 * separate axes, and every language version of an exercise (including the original) is a row in
 * ExerciseTranslation, never a field split across two different models.
 */
export interface Exercise {
	id: string;
	branchId: string;
	number: number;
	topicIds: string[];
	difficulty: Difficulty;
	source: ExerciseSource;
	tags: string[];
	published: boolean;
	// DERIVED (2026-08, the solution-pool feature): at least one published solution entry that
	// passed review — pinned (a corpus original / staff pin), reviewed, or by a verified
	// contributor. Recomputed server-side (exercises/signals.py); never hand-toggled anymore.
	verified: boolean;
	originalLocale: string; // which ExerciseTranslation row is canonical, e.g. 'pl'
	submittedByUserId?: string; // absent for migrated legacy content
	createdAt: string;
	// DERIVED live from Review rows on the backend (Avg/Count over the reverse `reviews` relation,
	// exercises/serializers.py) — never stored/hand-set.
	averageRating?: number;
	reviewCount?: number;
}

// A loose, free-text prerequisite/skill label for actually attempting this exercise — the exact
// same shape `MaterialRequirement` already establishes for a Material (material.ts), reused here
// unchanged since the concept (and its vote_summary weighting) is identical for either content type.
export interface ExerciseRequirement {
	id: string;
	label: string;
	order: number;
	voteSummary: CoverageVoteSummary;
}

export type TranslationStatus = 'published' | 'pending' | 'rejected';

export type SolutionEntryKind = 'hint' | 'solution';

/**
 * One hint or one solution in an exercise's pool (backend exercises.SolutionEntry) — a PEER in a
 * ranked list, not a translation field: written in ONE language (`locale`), voted on (▲/▼,
 * verified-contributor weight 2x, the same shared math claim votes use), individually
 * review-gated (`status` — a non-verified author's entry waits for one accept), discussable
 * (its own comment thread) and reportable. `pinned` floats the corpus originals (and anything a
 * moderator/governor pins) above the vote ordering.
 */
export interface SolutionEntry {
	id: string;
	exerciseId: string;
	kind: SolutionEntryKind;
	locale: string;
	body: string; // Markdown + LaTeX source, same pipeline as every other content field
	authorId?: string; // absent for the migrated corpus originals
	authorDisplayName: string;
	status: TranslationStatus;
	pinned: boolean;
	isRemoved: boolean;
	autoHiddenAt?: string;
	reviewedByUserId?: string;
	reviewNote: string;
	voteSummary: CoverageVoteSummary;
	commentCount: number;
	createdAt: string;
}

export interface ExerciseTranslation {
	id: string;
	exerciseId: string;
	locale: string; // free string, not constrained to the interface's own Paraglide locale list
	title: string;
	statement: string; // Markdown + LaTeX source — see lib/utils/renderContent.ts
	answer: string;
	// hint/solution left this shape with the solution-pool feature — see SolutionEntry above.
	status: TranslationStatus;
	translatedByUserId?: string; // absent for the migrated original
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
}

/** Somebody with a real account who worked on an exercise.
 *
 * Roles rather than one flat list of people, because "translated this into Ukrainian" and
 * "submitted it" are different claims and crediting them identically would be wrong. `locale` is
 * set for the translation-shaped roles and absent for `submitted`, which is about the whole row.
 *
 * Absent entirely for the imported corpus, which nobody here submitted — an honest empty rather
 * than a fabricated credit.
 */
export interface ExerciseContributor {
	id: string;
	displayName: string;
	role: 'submitted' | 'translated' | 'reviewed';
	locale?: string;
}

/** What a component actually renders: an Exercise resolved against one chosen content locale. */
export interface ResolvedExercise extends Exercise {
	locale: string;
	isOriginal: boolean;
	title: string;
	statement: string;
	answer: string;
	/** The whole visible solution/hint pool, every locale, pinned-first then by net vote score —
	 * the page groups by its current content locale itself. Empty on list-shaped results. */
	entries: SolutionEntry[];
	translatedByUserId?: string;
	availableLocales: string[]; // every locale with at least one PUBLISHED translation, original first
	requirements: ExerciseRequirement[];
	contributors: ExerciseContributor[];
}
