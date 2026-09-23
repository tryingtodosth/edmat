// A user flagging an already-published Exercise, Comment, Review, (tutoring) Service listing, Tag,
// Material, or MaterialRequirement ("skill tag") — see the backend's own moderation/services.py
// module doc comment for the full feature ("reported comment, content, review etc gets a priority
// in the moderation queue; if +20% of users who viewed that content report it, it gets hidden right
// away, before any moderator decision"). None of the last four (service/tag/material/requirement)
// have a viewer-pool concept the way an Exercise does, so none of them ever auto-hide on their own —
// they still queue normally for a moderator's own decision, exactly like the first three kinds.
export type ReportKind =
	| 'exercise'
	| 'comment'
	| 'review'
	| 'service'
	| 'tag'
	| 'material'
	| 'requirement'
	| 'service_review'
	// A hint/solution from the pool (exercises.SolutionEntry) — auto-hide measures against its
	// exercise's own viewer pool, same as a comment borrows its parent's.
	| 'solution_entry'
	// An anchored micro-post (activity.Post) — auto-hide borrows the referenced exercise's pool
	// when one is referenced, else honestly no-ops (the Service posture).
	| 'post'
	// An event and a proposal to one (events/) — no viewer pool; a moderator's remove hides the
	// event or withdraws the proposal.
	| 'event'
	// One article of a concept (concepts/) — community-written and public the moment it has a
	// published revision, so it needs the same flag route every other public text has. No viewer
	// pool of its own, so it never auto-hides; a moderator's remove takes the article out of
	// `visible_articles` and, when it was the concept's last visible one, the concept and its
	// backlinks go with it. The report is about the ARTICLE, never the concept: the concept is a
	// language-neutral node with nobody's words in it.
	| 'concept_article'
	| 'contribution';

// One GROUP per reported target (moderation/services.py's build_report_queue) — not one row per
// individual Report, since a moderator reviews and resolves every pending report against a target
// together, in one action. `isAutoHidden` is the "already hidden, waiting on you" signal that puts
// this at the top of the queue; `percentReported`/`viewCount` are undefined only when the target's
// own view count can't be resolved (see resolve_view_scope_exercise's own note on why that can
// legitimately happen), not when it's simply zero.
export interface ReportGroup {
	kind: ReportKind;
	objectId: string;
	reportCount: number;
	viewCount?: number;
	percentReported?: number;
	isAutoHidden: boolean;
	reasons: string[];
	preview: string;
	exerciseId?: string;
	exerciseTitle?: string;
	lastReportedAt: string;
}
