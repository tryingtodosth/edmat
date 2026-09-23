import type { Audience } from './audience';
// The activity feed (backend activity/, root CLAUDE.md §17AI): a stored, public-by-construction
// event log, and the anchored micro-posts that feed into it.

export type FeedKind =
	| 'exercise'
	| 'material'
	| 'solution_entry'
	| 'translation'
	| 'course'
	| 'event'
	| 'service'
	| 'post'
	| 'review'
	| 'claim'
	| 'comment'
	// Concepts (concepts/). Two kinds, the `material_version` split: 'concept' is a concept's page
	// coming into being — the FIRST publication anywhere under it, so a concept with six articles
	// announces itself once — while 'concept_revision' is an article that already existed getting
	// a new published revision. "This idea now has a page" and "a page you may have read has
	// changed" are different things to a reader. Both link through the concept.
	| 'concept'
	| 'concept_revision';

/** One anchored micro-post: your words + exactly one discipline/branch/tag anchor + optionally one
 * referenced exercise/material/course + optionally one (re-encoded) image. A removed/auto-hidden
 * post arrives TOMBSTONED — body/image/author blanked, the row kept (its thread survives). */
export interface Post {
	id: string;
	authorId?: string;
	authorDisplayName: string;
	body: string; // Markdown + LaTeX, same pipeline as everything else
	audience: Audience;
	imageUrl?: string;
	/** The anchor — exactly one of these four is set. Discipline/branch by slug, topic by pk
	 * (topic slugs repeat across branches), tag by slug. */
	disciplineId?: string;
	branchId?: string;
	topicId?: string;
	tagSlug?: string;
	/** The anchor's human name, resolved server-side per locale ("Analiza Matematyczna II", "#indukcja"). */
	anchorLabel: string;
	refExerciseId?: string;
	refExerciseTitle?: string;
	refMaterialId?: string;
	refMaterialTitle?: string;
	refCourseId?: string;
	refCourseTitle?: string;
	isRemoved: boolean;
	isAutoHidden: boolean;
	commentCount: number;
	createdAt: string;
}

/** One feed row. `post` is embedded for kind='post' so the feed renders the post's own words and
 * image without a per-row round trip. */
export interface FeedItem {
	id: string;
	kind: FeedKind;
	entryKind?: 'hint' | 'solution';
	actorId?: string;
	actorDisplayName: string;
	targetLabel: string;
	exerciseId?: string;
	materialId?: string;
	courseId?: string;
	eventId?: string;
	serviceId?: string;
	postId?: string;
	post?: Post;
	/** The concept a 'concept'/'concept_revision' row is about, as its SLUG — `/concepts/[slug]`
	 * is keyed by the slug, and an article or a revision has no page of its own. */
	conceptSlug?: string;
	branchId?: string;
	disciplineId?: string;
	tags: string[];
	createdAt: string;
}

/** A single anchor the /activity page is currently filtered to — what the composer posts into
 * when a claim chip or anchor chip landed the reader there. Also the ONLY way to anchor a post
 * to a topic: the manual pickers deliberately don't offer topics (the claim chips are the topic
 * picker). */
export interface FixedAnchor {
	kind: 'discipline' | 'branch' | 'topic' | 'tag';
	id: string;
	label: string;
}
