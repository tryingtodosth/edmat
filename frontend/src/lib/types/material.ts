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

// A loose, free-text prerequisite/skill label — "English B2+", "basic algebra" — not a fixed
// vocabulary, matching this app's own established style for similarly loose per-item labels (the
// backend's own MaterialRequirement model doc comment has the full reasoning). `order` is a plain,
// governor-controlled display order, not derived from anything else.
export interface MaterialRequirement {
	id: string;
	label: string;
	order: number;
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
	requirements: MaterialRequirement[];
	fileName: string;
	fileUrl: string; // Phase 3: a real, working URL served by the Django dev server's MEDIA_ROOT
	author: string;
	tags: string[]; // the same free-form Tag vocabulary Exercise.tags already uses — see TagChip.svelte
	published: boolean;
	featured: boolean;
	order: number;
	// Added for the search/filter/sort overhaul — backs `sort: 'recent'` and the recommended feed's
	// own "most recent upload" fallback tiebreak (materials/services.py's `get_recommended_materials`).
	createdAt: string;
	// Both genuinely optional — most materials stay free/no-estimate, exactly like before this
	// feature existed. `priceAmount`/`priceCurrency` render together ("29.99 PLN") only when
	// `priceAmount` is set — `priceCurrency` alone means nothing. `estimatedMinutes` was chosen over
	// a page-count "length" field since it's the more directly useful signal across every material
	// type this app has (a script, an exam collection, a slide deck), and doesn't require a page
	// count nobody has ever recorded for this corpus.
	priceAmount?: number;
	priceCurrency: string;
	estimatedMinutes?: number;
}

// The materials search/filter/sort overhaul's own structured query surface — mirrors the backend's
// own `_filter_materials`/`_sort_materials` (materials/views.py) param-for-param, so a caller never
// has to guess what's actually filterable. `courseId`/`fieldId` are only meaningful for the
// cross-course browse hub (routes/materials/+page.svelte) — a course-scoped caller (the course
// page's own Materials tab) never sets either, since the course is already implied by the URL it
// calls. `topicId`/`minLevel` are the "difficulty of coverage" dimension: `topicId` alone asks "does
// this material cover this specific topic at all," `minLevel` alone asks "any topic, but deeply,"
// and both together ask "THIS topic, at least THIS deep" — the same three-way distinction the
// backend's own `_filter_materials` doc comment already draws.
export interface MaterialBrowseFilters {
	fieldId?: string;
	courseId?: string;
	type?: MaterialType;
	tag?: string;
	topicId?: string;
	minLevel?: number; // 1-100, a coverage-depth floor
	query?: string;
	sort?: MaterialSort;
}

// One of `_SORT_KEYS` (materials/views.py) — omitted/unrecognized on the backend keeps its own
// existing `(course, order)` default, which this app surfaces as `undefined`/no explicit choice
// rather than a fifth named option, since "the platform's own curated order" isn't really a *sort*
// so much as the absence of picking one.
export type MaterialSort = 'recent' | 'level' | 'votes' | 'alphabetical';

// GET /api/materials/recommended/ — deliberately NOT a bare Material[] the way every other list
// endpoint in this app returns (Phase 3's own established convention); see that endpoint's own doc
// comment (materials/views.py) for why `personalized` is real, load-bearing information a plain
// array can't carry on its own: whether this is genuinely tailored to the visitor, or the
// platform's own honest, non-personalized default (featured-first) for someone this app has no real
// engagement signal for yet.
export interface RecommendedMaterialsResult {
	personalized: boolean;
	materials: Material[];
}
