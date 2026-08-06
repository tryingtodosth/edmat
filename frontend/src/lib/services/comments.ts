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
	// The three review threads. Addressed by the review's own id rather than nested under the
	// exercise/material/listing it is about, because a reply belongs to the review, not to the
	// thing being reviewed.
	if (targetType === 'review') return `/reviews/${encodeURIComponent(targetId)}/comments/`;
	if (targetType === 'materialReview') {
		return `/material-reviews/${encodeURIComponent(targetId)}/comments/`;
	}
	if (targetType === 'serviceReview') {
		return `/service-reviews/${encodeURIComponent(targetId)}/comments/`;
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

/** Edit your own comment. The backend refuses anybody else's (403) and a comment that is already
 * removed (409) — both are the author-only rule, enforced there rather than trusted from here. */
export async function updateComment(
	commentId: string,
	body: string,
	targetType: CommentTargetType,
	targetId: string
): Promise<Comment> {
	const raw = await apiClient.patch<RawComment>(`/comments/${encodeURIComponent(commentId)}/`, {
		body
	});
	return mapComment(raw, targetType, targetId);
}

/** Delete your own comment. Returns the tombstoned comment rather than nothing: the row survives
 * (replies hang off it, and any report filed against it still points at it), so the caller wants
 * the updated version to render in place, not to drop it from the list. */
export async function deleteComment(
	commentId: string,
	targetType: CommentTargetType,
	targetId: string
): Promise<Comment> {
	const raw = await apiClient.delete<RawComment>(`/comments/${encodeURIComponent(commentId)}/`);
	return mapComment(raw, targetType, targetId);
}
