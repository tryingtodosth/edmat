// Discussions under the standing pages. The only seam between those pages and the API
// (`frontend/CLAUDE.md`: no component or route contains fetch logic), and the backend half is
// `backend/community/discussions.py`.
//
// Two reads on purpose, and the split is the performance decision this feature turns on:
//
//   policiesForPage()  ONE request per page, for every section it draws. A manual chapter has up
//                      to a dozen sections; a page that asked per section would fire a dozen
//                      requests before a reader had clicked anything.
//   threadAt()         ONE request per section, and only when a reader opens it. That is what the
//                      owner asked for ("drawn on click") and it is also the cheap shape: a
//                      chapter with twelve collapsed threads loads none of them.
import { apiClient } from '$lib/api/client';
import { mapComment, type RawComment } from '$lib/api/mappers';
import type { Comment } from '$lib/types';
import type {
	DiscussionAudience,
	DiscussionBlockReason,
	DiscussionLocationRow,
	DiscussionPolicy
} from '$lib/types/discussion';

interface RawPolicy {
	key: string;
	page: string;
	section: string;
	is_enabled: boolean;
	audience: DiscussionAudience;
	moderated: boolean;
	can_post: boolean;
	post_block_reason: DiscussionBlockReason | null;
	held_for_you: boolean;
	comment_count?: number;
}

function mapPolicy(raw: RawPolicy): DiscussionPolicy {
	return {
		key: raw.key,
		page: raw.page,
		section: raw.section,
		isEnabled: raw.is_enabled,
		audience: raw.audience,
		moderated: raw.moderated,
		canPost: raw.can_post,
		postBlockReason: raw.post_block_reason,
		heldForYou: raw.held_for_you,
		commentCount: raw.comment_count ?? 0
	};
}

/** Every section's policy for one page, plus the page's own row under the key `''`.
 *
 * `sections` is what the PAGE declares it draws — the server validates their shape but keeps no
 * list of legal section names, because the manual's sections live in `lib/content/guide/*.ts` and
 * Python cannot read them (the backend module argues this at length). So a section the page stops
 * drawing simply stops being asked about.
 */
export async function policiesForPage(
	page: string,
	sections: string[]
): Promise<Record<string, DiscussionPolicy>> {
	const query = new URLSearchParams({ page });
	if (sections.length > 0) query.set('sections', sections.join(','));
	const raw = await apiClient.get<{ page: string; locations: RawPolicy[] }>(
		`/discussions/?${query.toString()}`
	);
	const bySection: Record<string, DiscussionPolicy> = {};
	for (const entry of raw.locations) bySection[entry.section] = mapPolicy(entry);
	return bySection;
}

export interface DiscussionThread extends DiscussionPolicy {
	comments: Comment[];
}

/** The thread at one location, read when a reader opens it. */
export async function threadAt(page: string, section: string): Promise<DiscussionThread> {
	const query = new URLSearchParams({ page, section });
	const raw = await apiClient.get<RawPolicy & { comments: RawComment[] }>(
		`/discussions/thread/?${query.toString()}`
	);
	return {
		...mapPolicy(raw),
		// `discussionLocation` is the target name `community/targets.py` gives this, and the id the
		// mapper wants is the location's key — a comment here has no numeric target the client
		// ever sees, which is the one place this target differs from the other eighteen.
		comments: raw.comments.map((c) => mapComment(c, 'discussionLocation', raw.key))
	};
}

export interface PostedComment extends Comment {
	/** Said back by the server rather than inferred from a blanked body: somebody who just wrote
	 *  something and sees it empty deserves the sentence that explains why. */
	isHeld: boolean;
}

export async function postAt(
	page: string,
	section: string,
	body: string,
	options: { parentId?: string; anonName?: string } = {}
): Promise<PostedComment> {
	const payload: Record<string, unknown> = { page, section, body };
	if (options.parentId) payload.parent = Number(options.parentId);
	// Sent only when there is something to send. A signed-in comment is bylined by its account and
	// the server ignores this field for one — see the draft serializer's own note.
	if (options.anonName) payload.anon_name = options.anonName;
	const raw = await apiClient.post<RawComment & { is_held: boolean; key?: string }>(
		'/discussions/thread/',
		payload
	);
	const key = raw.key ?? (section ? `${page}#${section}` : page);
	return { ...mapComment(raw, 'discussionLocation', key), isHeld: raw.is_held };
}

// --- the moderation side ------------------------------------------------------------------------

interface RawLocationRow {
	id: number;
	key: string;
	page: string;
	section: string;
	is_enabled: boolean;
	audience: DiscussionAudience;
	moderated: boolean;
	comment_count: number;
	held_count: number;
	updated_at: string;
	updated_by_display_name: string;
}

function mapLocationRow(raw: RawLocationRow): DiscussionLocationRow {
	return {
		id: String(raw.id),
		key: raw.key,
		page: raw.page,
		section: raw.section,
		isEnabled: raw.is_enabled,
		audience: raw.audience,
		moderated: raw.moderated,
		commentCount: raw.comment_count,
		heldCount: raw.held_count,
		updatedAt: raw.updated_at,
		updatedByDisplayName: raw.updated_by_display_name
	};
}

export async function listDiscussionLocations(): Promise<DiscussionLocationRow[]> {
	const raw = await apiClient.get<RawLocationRow[]>('/discussion-locations/');
	return raw.map(mapLocationRow);
}

/** A location row appears here once somebody has written at it OR a moderator has configured it.
 *  Creating one ahead of time is how a moderator closes a location nobody has used yet. */
export async function createDiscussionLocation(draft: {
	page: string;
	section?: string;
	isEnabled?: boolean;
	audience?: DiscussionAudience;
	moderated?: boolean;
}): Promise<DiscussionLocationRow> {
	const raw = await apiClient.post<RawLocationRow>('/discussion-locations/', {
		page: draft.page,
		section: draft.section ?? '',
		...(draft.isEnabled === undefined ? {} : { is_enabled: draft.isEnabled }),
		...(draft.audience === undefined ? {} : { audience: draft.audience }),
		...(draft.moderated === undefined ? {} : { moderated: draft.moderated })
	});
	return mapLocationRow(raw);
}

export async function updateDiscussionLocation(
	id: string,
	changes: { isEnabled?: boolean; audience?: DiscussionAudience; moderated?: boolean }
): Promise<DiscussionLocationRow> {
	const payload: Record<string, unknown> = {};
	if (changes.isEnabled !== undefined) payload.is_enabled = changes.isEnabled;
	if (changes.audience !== undefined) payload.audience = changes.audience;
	if (changes.moderated !== undefined) payload.moderated = changes.moderated;
	const raw = await apiClient.patch<RawLocationRow>(
		`/discussion-locations/${encodeURIComponent(id)}/`,
		payload
	);
	return mapLocationRow(raw);
}
