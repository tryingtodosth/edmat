export type CommentTargetType = 'exercise' | 'material';

export interface Comment {
	id: string;
	targetType: CommentTargetType;
	targetId: string;
	parentId?: string;
	authorId: string;
	body: string;
	createdAt: string;
	isRemoved: boolean; // tombstone, not hard-delete — preserves thread structure, mirrors CLAUDE.md's model
}
