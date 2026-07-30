// 'material' — a WHOLE material's own top-level discussion (materials/views.py's
// MaterialViewSet.comments, GET /api/materials/{id}/comments/) — genuinely became a real backend
// target ("add discussions... to materials"); this comment used to say otherwise (no call site had
// ever used it) and is corrected here rather than left stale. Distinct from 'materialCoverage'
// below, a discussion scoped to one specific topic-subtopic-level claim, not the whole material.
// 'service' is the other real one — a tutoring listing's own discussion (services/views.py's
// ServiceViewSet.comments), the same generic Comment mechanism reused again.
export type CommentTargetType = 'exercise' | 'material' | 'materialCoverage' | 'service';

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
}
