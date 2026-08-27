import type { Comment, CommentTargetType } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapComment, type RawComment } from '$lib/api/mappers';

function targetPath(targetType: CommentTargetType, targetId: string): string {
	if (targetType === 'exercise') return `/exercises/${encodeURIComponent(targetId)}/comments/`;
	if (targetType === 'issue') return `/issues/${encodeURIComponent(targetId)}/comments/`;
	if (targetType === 'material') return `/materials/${encodeURIComponent(targetId)}/comments/`;
	if (targetType === 'materialCoverage') {
		return `/material-coverage/${encodeURIComponent(targetId)}/comments/`;
	}
	if (targetType === 'service') return `/services/${encodeURIComponent(targetId)}/comments/`;
	if (targetType === 'exerciseClaim') {
		return `/exercise-claims/${encodeURIComponent(targetId)}/comments/`;
	}
	if (targetType === 'solutionEntry') {
		return `/solution-entries/${encodeURIComponent(targetId)}/comments/`;
	}
	if (targetType === 'courseClaim') {
		return `/course-claims/${encodeURIComponent(targetId)}/comments/`;
	}
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

/** Up (+1) or down (-1) on a comment; the server answers with the comment's fresh tallies. */
export async function voteOnComment(
	commentId: string,
	value: 1 | -1,
	targetType: CommentTargetType,
	targetId: string
): Promise<Comment> {
	const raw = await apiClient.post<RawComment>(`/comments/${encodeURIComponent(commentId)}/vote/`, {
		value
	});
	return mapComment(raw, targetType, targetId);
}

export async function retractCommentVote(
	commentId: string,
	targetType: CommentTargetType,
	targetId: string
): Promise<Comment> {
	const raw = await apiClient.delete<RawComment>(
		`/comments/${encodeURIComponent(commentId)}/vote/`
	);
	return mapComment(raw, targetType, targetId);
}

/* --- kept for yourself ---------------------------------------------------------------------- */

/** A comment somebody kept. Carries enough of its own context to be readable on the settings page,
 * a long way from the thread it was written in — including WHERE it lives, which the server has to
 * resolve because a comment has no page of its own. */
export interface SavedComment {
	id: string;
	comment: Comment;
	/** Empty for a thread hanging off something the backend's own target map has not been taught
	 * about yet — the row still renders, it just cannot be linked to. */
	targetType: CommentTargetType | '';
	targetId: string;
	note: string;
	createdAt: string;
}

function mapSavedComment(raw: RawSavedComment): SavedComment {
	const targetType = (raw.target_type || '') as CommentTargetType | '';
	const targetId = String(raw.target_id ?? '');
	return {
		id: String(raw.id),
		// Mapped through the same `mapComment` as every other comment: the target is exactly what it
		// needs and exactly what this row carries. The fallback only feeds that mapper's own bookkeeping
		// — `targetType` above keeps the honest empty string, so nothing renders a link to a guess.
		comment: mapComment(raw.comment, targetType || 'exercise', targetId),
		targetType,
		targetId,
		note: raw.note ?? '',
		createdAt: raw.created_at
	};
}

interface RawSavedComment {
	id: number | string;
	comment: RawComment;
	target_type?: string;
	target_id?: string | number;
	note?: string;
	created_at: string;
}

export async function getSavedComments(): Promise<SavedComment[]> {
	const raw = await apiClient.get<RawSavedComment[]>('/comments/saved/');
	return raw.map(mapSavedComment);
}

/** Keep this comment. Saving one already saved is not an error — it is the same statement made
 * twice, and the server answers with the row that already says it. */
export async function saveComment(commentId: string, note = ''): Promise<SavedComment> {
	return mapSavedComment(
		await apiClient.post<RawSavedComment>(
			`/comments/${encodeURIComponent(commentId)}/save-for-me/`,
			{ note }
		)
	);
}

export async function unsaveComment(commentId: string): Promise<void> {
	await apiClient.delete(`/comments/${encodeURIComponent(commentId)}/save-for-me/`);
}
