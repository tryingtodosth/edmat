// Phase 3 — widened from the Phase 1 guess ('script' | 'formulaSheet' | 'other') to match what the
// real backend model actually settled on once grounded against the real corpus (CLAUDE.md's own
// Phase 2 note: none of the real material.yaml `type:` values ever produce a formula sheet).
export type MaterialType =
	'script' | 'examCollection' | 'midtermCollection' | 'exerciseCollection' | 'other';

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
	topicIds: string[];
	fileName: string;
	fileUrl: string; // Phase 3: a real, working URL served by the Django dev server's MEDIA_ROOT
	author: string;
	published: boolean;
	featured: boolean;
	order: number;
}
