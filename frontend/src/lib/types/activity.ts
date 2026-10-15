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
	| 'concept_revision'
	// Contests (contests/). Two kinds, the `concept`/`concept_revision` split: 'contest' is an
	// announcement — a contest leaving draft into public view, the moment somebody can decide to
	// enter — and 'contest_results' is the ranking being published, which is a different thing to a
	// reader (one says "you can take part", the other says "it is over"). Both link through the
	// contest, and both leave the feed the moment it is cancelled or pulled back to private.
	| 'contest'
	| 'contest_results';

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
	/** Only on the answer to creating a post with a tag NAME (WP16): true when that name made a new
	 * tag, false when it folded to one that already existed. Absent everywhere else. */
	tagCreated?: boolean;
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
	/** The contest a 'contest'/'contest_results' row is about — `/contests/[id]`, by id. */
	contestId?: string;
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
