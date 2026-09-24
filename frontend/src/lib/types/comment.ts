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
	// A session on an event's programme — its Q&A (AUDIENCE-BRIEF.md §3.2).
	| 'eventSession'
	// A site issue report (issues/) — its discussion is the reason a published one has a page.
	| 'issue'
	// The review thread on one version of a material (coauthoring/) — where a proposal is argued
	// about before somebody accepts or rejects it. Named `materialVersion` rather than `version`
	// for the same reason `taughtCourse` is not `course`: this union is one flat namespace across
	// the whole platform, and a bare "version" would be the first name in it that does not say what
	// it is a version OF. The backend says the same thing from its side, in
	// `community/targets.py`'s TARGET_TYPE_BY_MODEL.
	//
	// It is also in that file's PRIVATE_TARGET_TYPES, so a version's thread cannot be linked into a
	// course: most versions are not public at all (a draft is the team's, a proposal is its author's
	// and its deciders'), and a per-TYPE table has to answer per type.
	//
	// `SavedCommentsList.svelte` deliberately has no case for it either, and that is a gap rather
	// than a decision: a saved row carries only (targetType, targetId=the version's id), while the
	// version page is addressed by (project id, version number). Linking one would need the server
	// to resolve that pair, so the row renders without a link rather than with a broken one.
	| 'materialVersion'
	// The cooperation thread of one material's project (materials_coop/) — the team's room,
	// hung off the PROJECT so it survives every version. Reachable through
	// `/materials/{id}/coop/comments/`; private in the backend's per-type table for the same
	// reason a version's thread is: under a `request` or `closed` policy it is not a public room.
	| 'materialProject'
	// The talk about ONE article of a concept (concepts/). Named for the article and not the
	// concept, because that is what the thread hangs off: a concept has as many articles as people
	// have written, for as many audiences, and a question about the primary-school wording has no
	// business under the university one. `community/targets.py` says the same thing from its side.
	//
	// Unlike `materialVersion` it is NOT private: an article a reader can see is a page anybody can
	// open, so a course may link its thread like an exercise's.
	| 'conceptArticle'
	// An anchored micro-post on the activity feed (activity.Post) — its own thread.
	| 'post'
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
	/** Pictures and small PDFs on the comment (AUDIENCE-BRIEF.md §6); empty on a tombstone. */
	attachments: CommentAttachment[];
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

export interface CommentAttachment {
	id: string;
	kind: 'image' | 'pdf';
	url: string;
	originalName: string;
	sizeBytes: number;
}

/** One past version of a comment's body, from `/api/comments/{id}/revisions/` — the anti-troll
 * edit trail. `body` is `null` whenever the backend has masked it (hidden by a moderator, or
 * sealed by a superuser — see backend `CommentRevision`'s own docstring for what each tier
 * means); `isHiddenByModerator`/`isSealed` are what a reader uses to pick the right placeholder,
 * since the backend deliberately never sends English placeholder text of its own (that stays a
 * message key here, like every other user-facing string in this app). */
export interface CommentRevision {
	id: string;
	createdAt: string;
	editedByDisplayName: string;
	body: string | null;
	isHiddenByModerator: boolean;
	isSealed: boolean;
}
