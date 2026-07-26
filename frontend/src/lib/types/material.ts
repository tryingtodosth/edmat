// Phase 3 — widened from the Phase 1 guess ('script' | 'formulaSheet' | 'other') to match what the
// real backend model actually settled on once grounded against the real corpus (CLAUDE.md's own
// Phase 2 note: none of the real material.yaml `type:` values ever produce a formula sheet).
// Widened again, deliberately BEYOND the current corpus, per an explicit "expand material types"
// request — see the backend's own materials/models.py doc comment for the full reasoning
// (`formulaSheet` restored from the original Phase 1/Section-9 sketch, the rest genuinely new).
export type MaterialType =
	| 'script'
	| 'examCollection'
	| 'midtermCollection'
	| 'exerciseCollection'
	| 'formulaSheet'
	| 'lectureSlides'
	| 'solutionGuide'
	| 'syllabus'
	| 'practiceTest'
	| 'recording'
	| 'textbookExcerpt'
	| 'codeDataset'
	| 'other';

// A vote is +1 (agree the claimed level is accurate) or -1 (disagree) — see CoverageVoteSummary's
// own doc comment for why the WEIGHT of a vote isn't a value on the vote itself.
export type CoverageVoteValue = 1 | -1;

// Server-computed, never re-derived client-side — same trust model this app already applies to
// Exercise.averageRating/reviewCount (mappers.ts). A verified contributor's vote counts double; see
// the backend's own MaterialCoverageVote model doc comment for why that weight is computed live at
// read time rather than stored on the vote row.
export interface CoverageVoteSummary {
	agreeCount: number;
	disagreeCount: number;
	agreeWeight: number;
	disagreeWeight: number;
	netWeight: number;
	percentAgree?: number; // undefined when there are zero votes yet — "no signal," not "0% agree"
	currentUserVote?: CoverageVoteValue;
}

// One (topic, subtopic?, level) claim about how deeply a Material treats that pairing — replaces
// Material's old flat, weightless `topicIds: string[]` outright (2.1 in spirit: one richer shape,
// not two competing sources of truth for "what does this material cover"). `level` (1-100) is
// deliberately one number, not four separate difficulty/time/requirement fields — the UI derives a
// "what it covers" badge, a difficulty-ish bucket, and a rough relative-time weight all from this
// one figure. Anyone authenticated can propose a new coverage row; the community verifies/corrects
// a claimed level via `voteSummary` + a discussion thread (targetType: 'materialCoverage', see
// comment.ts) rather than a moderation queue — see the backend's own MaterialCoverage model doc
// comment for the full reasoning.
export interface MaterialCoverage {
	id: string;
	materialId: string;
	topicId: string;
	topicName: string;
	subtopicId?: string;
	subtopicName?: string;
	level: number; // 1-100
	proposedByUserId?: string;
	createdAt: string;
	voteSummary: CoverageVoteSummary;
	commentCount: number;
}

// Materials are a lighter object than exercises and, deliberately, do NOT get the full
// ExerciseTranslation-style per-locale review system in v1 — CLAUDE.md's priority is translating
// exercises specifically ("assignments"). title/description are plain strings for now; nothing
// about this shape blocks adding a MaterialTranslation table later the same way Exercise has one.
export interface Material {
	id: string;
	courseId: string;
	slug: string;
	type: MaterialType;
	title: string;
	description: string;
	coverage: MaterialCoverage[];
	fileName: string;
	fileUrl: string; // Phase 3: a real, working URL served by the Django dev server's MEDIA_ROOT
	author: string;
	tags: string[]; // the same free-form Tag vocabulary Exercise.tags already uses — see TagChip.svelte
	published: boolean;
	featured: boolean;
	order: number;
}
