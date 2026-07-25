import type { Comment } from '$lib/types';

export interface CommentNode {
	comment: Comment;
	replies: CommentNode[];
}

/** Flat Comment[] (keyed by parentId) -> a nested reply tree, one pass, sorted oldest-first at every level. */
export function buildCommentTree(comments: Comment[]): CommentNode[] {
	const byId = new Map<string, CommentNode>();
	const roots: CommentNode[] = [];

	for (const c of comments) byId.set(c.id, { comment: c, replies: [] });
	for (const c of comments) {
		const node = byId.get(c.id)!;
		const parent = c.parentId ? byId.get(c.parentId) : undefined;
		if (parent) parent.replies.push(node);
		else roots.push(node);
	}

	const byCreatedAt = (a: CommentNode, b: CommentNode) =>
		a.comment.createdAt.localeCompare(b.comment.createdAt);
	const sortRecursive = (nodes: CommentNode[]) => {
		nodes.sort(byCreatedAt);
		for (const n of nodes) sortRecursive(n.replies);
	};
	sortRecursive(roots);
	return roots;
}
