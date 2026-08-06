import type { Comment, CommentTargetType } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapComment, type RawComment } from '$lib/api/mappers';

function targetPath(targetType: CommentTargetType, targetId: string): string {
	if (targetType === 'exercise') return `/exercises/${encodeURIComponent(targetId)}/comments/`;
	if (targetType === 'material') return `/materials/${encodeURIComponent(targetId)}/comments/`;
	if (targetType === 'materialCoverage') {
		return `/material-coverage/${encodeURIComponent(targetId)}/comments/`;
	}
	if (targetType === 'service') return `/services/${encodeURIComponent(targetId)}/comments/`;
	if (targetType === 'taughtCourse') {
		return `/courses/${encodeURIComponent(targetId)}/comments/`;
	}
	throw new Error(`Comments on a '${targetType}' target have no backend endpoint yet.`);
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
