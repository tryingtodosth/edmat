// 'material' — a WHOLE material's own top-level discussion (materials/views.py's
// MaterialViewSet.comments, GET /api/materials/{id}/comments/) — genuinely became a real backend
// target ("add discussions... to materials"); this comment used to say otherwise (no call site had
// ever used it) and is corrected here rather than left stale. Distinct from 'materialCoverage'
// below, a discussion scoped to one specific topic-subtopic-level claim, not the whole material.
// 'service' is the other real one — a tutoring listing's own discussion (services/views.py's
// ServiceViewSet.comments), the same generic Comment mechanism reused again.
export type CommentTargetType =
	| 'exercise'
	| 'material'
	| 'materialCoverage'
	| 'service'
	// A branch run by a user (classroom.Course) — the same generic Comment mechanism, so the
	// thread, the tree builder and the report flow all come for free.
	| 'taughtCourse'
	// One session, and one week, inside such a course. Both exist because they are different
	// conversations: "is task 3 a typo" belongs to Tuesday, "how should we approach this week"
	// belongs to the week, and folding them together puts the second in whichever lesson happens
	// to be first.
	| 'courseLesson'
	| 'courseChapter'
	// A covers/requires claim on a user-run course — the course-side twin of 'materialCoverage'.
	| 'courseClaim'
	| 'exerciseClaim'
	// One hint/solution in an exercise's pool — "different solutions may have their own comments".
	| 'solutionEntry'
	// A site issue report (issues/) — its discussion is the reason a published one has a page.
	| 'issue'
	// The three review kinds. Replying to somebody's review is not a new kind of object — it is a
	// Comment whose target happens to be a Review, which is why it inherits the same threading,
	// reporting and moderation everything else here already has. All three exist because
	// ReviewList.svelte renders all three from one component.
	| 'review'
	| 'materialReview'
	| 'serviceReview';

export interface Comment {
	id: string;
	targetType: CommentTargetType;
	targetId: string;
	parentId?: string;
	authorId: string;
	body: string;
	createdAt: string;
	isRemoved: boolean; // tombstone, not hard-delete — preserves thread structure, mirrors CLAUDE.md's model
	// True the instant community reports cross the auto-hide threshold (moderation/services.py),
	// independent of — and possibly without ever becoming — isRemoved. Distinct on purpose: this is
	// reversible ("restore," a moderator decided the reports were unfounded), isRemoved isn't.
	isAutoHidden: boolean;
	// True once the author has edited it. Surfaced because a comment can already have replies
	// answering what it used to say — see the backend field's own note.
	isEdited: boolean;
	// The author took it down themselves, as opposed to a moderator removing it. Both blank the
	// body; only this decides which of the two the reader is told, and telling them the wrong one
	// is a placeholder that lies about what happened to somebody's words.
	removedByAuthor: boolean;
	// Plain up/down counts (a comment vote is unweighted, unlike a claim vote) and their difference.
	// `currentUserVote` is the reader's own, undefined when signed out or not yet voted.
	upvotes: number;
	downvotes: number;
	score: number;
	currentUserVote?: 1 | -1;
}
