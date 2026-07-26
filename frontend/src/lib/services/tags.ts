import type { TagFollowState, TaggableKind } from '$lib/types';
import { apiClient } from '$lib/api/client';
import { mapTagFollow, type RawTagFollow } from '$lib/api/mappers';

/** Every tag the current user follows, plus whether they've muted notifications for each one —
 * the tag-hover menu's (TagChip.svelte) source of truth for rendering Follow vs. Following without
 * a per-tag round trip. Auth required — callers only ever call this once logged in. */
export async function getMyTagFollows(): Promise<TagFollowState[]> {
	const raw = await apiClient.get<RawTagFollow[]>('/tags/my-follows/');
	return raw.map(mapTagFollow);
}

export async function followTag(slug: string): Promise<TagFollowState> {
	const raw = await apiClient.post<RawTagFollow>(`/tags/${encodeURIComponent(slug)}/follow/`);
	return mapTagFollow(raw);
}

export async function unfollowTag(slug: string): Promise<void> {
	await apiClient.delete(`/tags/${encodeURIComponent(slug)}/follow/`);
}

/** Mutes/unmutes notifications on an EXISTING follow, without unfollowing — 404s if the caller
 * isn't actually following this tag (TagChip.svelte only ever shows this control once already
 * following, so that would be a real bug, not something to paper over here). */
export async function setTagNotify(slug: string, notify: boolean): Promise<TagFollowState> {
	const raw = await apiClient.post<RawTagFollow>(`/tags/${encodeURIComponent(slug)}/notify/`, {
		notify
	});
	return mapTagFollow(raw);
}

/** "Add to different content" — attaches this tag to another Exercise/Material. Notifies the tag's
 * own followers (server-side) the instant it's genuinely new for that target. */
export async function applyTagToContent(
	slug: string,
	kind: TaggableKind,
	objectId: string
): Promise<void> {
	await apiClient.post(`/tags/${encodeURIComponent(slug)}/apply/`, {
		kind,
		object_id: Number(objectId)
	});
}

export async function removeTagFromContent(
	slug: string,
	kind: TaggableKind,
	objectId: string
): Promise<void> {
	await apiClient.delete(`/tags/${encodeURIComponent(slug)}/apply/`, {
		kind,
		object_id: Number(objectId)
	});
}
