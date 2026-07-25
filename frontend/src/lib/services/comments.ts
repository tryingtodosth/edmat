import type { Comment, CommentTargetType } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapComment, type RawComment } from '$lib/api/mappers';

// Only 'exercise' has a real backend endpoint today (GET/POST /api/exercises/:id/comments/) — no
// call site in this app ever submits a Material comment (confirmed: only
// routes/exercises/[id]/+page.svelte calls either of these two functions, always with 'exercise'),
// so a Material target throws a clear, honest error instead of silently hitting a route that
// doesn't exist.
function targetPath(targetType: CommentTargetType, targetId: string): string {
	if (targetType !== 'exercise') {
		throw new Error(`Comments on a '${targetType}' target have no backend endpoint yet.`);
	}
	return `/exercises/${encodeURIComponent(targetId)}/comments/`;
}

export async function getCommentsForTarget(
	targetType: CommentTargetType,
	targetId: string
): Promise<Comment[]> {
	const raw = await apiClient.get<RawComment[]>(targetPath(targetType, targetId));
	return raw.map((c) => mapComment(c, targetType, targetId));
}

// `authorId` stays a parameter for call-site compatibility — the backend attributes the comment to
// whoever the auth token belongs to (Comment.author = request.user), same as submitReview.
export async function submitComment(
	targetType: CommentTargetType,
	targetId: string,
	_authorId: string,
	body: string,
	parentId?: string
): Promise<Comment> {
	const raw = await apiClient.post<RawComment>(targetPath(targetType, targetId), {
		body,
		parent: parentId ? Number(parentId) : undefined
	});
	return mapComment(raw, targetType, targetId);
}
