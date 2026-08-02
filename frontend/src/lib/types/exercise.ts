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
	courseId: string;
	number: number;
	topicIds: string[];
	difficulty: Difficulty;
	source: ExerciseSource;
	tags: string[];
	published: boolean;
	verified: boolean; // a full, correct solution/answer exists — unchanged meaning from the source corpus
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

export interface ExerciseTranslation {
	id: string;
	exerciseId: string;
	locale: string; // free string, not constrained to the interface's own Paraglide locale list
	title: string;
	statement: string; // Markdown + LaTeX source — see lib/utils/renderContent.ts
	hint: string;
	answer: string;
	solution: string;
	status: TranslationStatus;
	translatedByUserId?: string; // absent for the migrated original
	reviewedByUserId?: string;
	reviewNote?: string;
	createdAt: string;
}

/** What a component actually renders: an Exercise resolved against one chosen content locale. */
export interface ResolvedExercise extends Exercise {
	locale: string;
	isOriginal: boolean;
	title: string;
	statement: string;
	hint: string;
	answer: string;
	solution: string;
	translatedByUserId?: string;
	availableLocales: string[]; // every locale with at least one PUBLISHED translation, original first
	requirements: ExerciseRequirement[];
}
