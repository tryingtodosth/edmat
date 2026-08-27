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
	| 'comment';

/** One anchored micro-post: your words + exactly one discipline/branch/tag anchor + optionally one
 * referenced exercise/material/course + optionally one (re-encoded) image. A removed/auto-hidden
 * post arrives TOMBSTONED — body/image/author blanked, the row kept (its thread survives). */
export interface Post {
	id: string;
	authorId?: string;
	authorDisplayName: string;
	body: string; // Markdown + LaTeX, same pipeline as everything else
	imageUrl?: string;
	/** The anchor — exactly one of these three is set. Slug-identified, like all taxonomy ids. */
	disciplineId?: string;
	branchId?: string;
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
	branchId?: string;
	disciplineId?: string;
	tags: string[];
	createdAt: string;
}
