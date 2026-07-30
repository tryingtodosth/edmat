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

/** Resolves a tag's own numeric id from its slug — every other tag reference throughout this app
 * is slug-keyed (TagChip.svelte's own `tag: string` prop, `?tag=` filters, follow/apply), but
 * `Report` (moderation/models.py) is a plain GenericForeignKey needing a real integer `object_id`,
 * the one place this app's own tag-by-slug convention needs a real numeric id at all. Called lazily,
 * only when a tag's own report flow is actually opened, not eagerly for every rendered chip. */
export async function getTagBySlug(slug: string): Promise<{ id: string; slug: string }> {
	const raw = await apiClient.get<{ id: number; slug: string }>(
		`/tags/${encodeURIComponent(slug)}/`
	);
	return { id: String(raw.id), slug: raw.slug };
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
