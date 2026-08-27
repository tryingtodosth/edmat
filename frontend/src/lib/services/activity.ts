// The activity feed and its anchored micro-posts (backend activity/, root CLAUDE.md §17AI).
// Replaced the §17AH placeholder wholesale: the feed is a stored, public-by-construction event log
// now, with filters, a Followed view, and an id cursor for "load more".
import type { FeedItem, FeedKind, Post } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';

interface RawPost {
	id: number;
	author: number | null;
	author_display_name: string;
	body: string;
	image: string | null;
	discipline: string | null;
	branch: string | null;
	tag: string | null;
	anchor_label: string;
	ref_exercise: number | null;
	ref_exercise_title: string;
	ref_material: number | null;
	ref_material_title: string;
	ref_course: number | null;
	ref_course_title: string;
	is_removed: boolean;
	auto_hidden_at: string | null;
	comment_count: number;
	created_at: string;
}

interface RawActivityItem {
	id: number;
	kind: FeedKind;
	entry_kind: string;
	actor: number | null;
	actor_display_name: string;
	target_label: string;
	exercise: number | null;
	material: number | null;
	course: number | null;
	happening: number | null;
	service: number | null;
	post: number | null;
	post_detail: RawPost | null;
	branch: string | null;
	discipline: string | null;
	tags: string[];
	created_at: string;
}

const idOr = (value: number | null | undefined) =>
	value === null || value === undefined ? undefined : String(value);

export function mapPost(json: RawPost): Post {
	return {
		id: String(json.id),
		authorId: idOr(json.author),
		authorDisplayName: json.author_display_name,
		body: json.body,
		imageUrl: json.image ?? undefined,
		disciplineId: json.discipline ?? undefined,
		branchId: json.branch ?? undefined,
		tagSlug: json.tag ?? undefined,
		anchorLabel: json.anchor_label,
		refExerciseId: idOr(json.ref_exercise),
		refExerciseTitle: json.ref_exercise_title || undefined,
		refMaterialId: idOr(json.ref_material),
		refMaterialTitle: json.ref_material_title || undefined,
		refCourseId: idOr(json.ref_course),
		refCourseTitle: json.ref_course_title || undefined,
		isRemoved: json.is_removed,
		isAutoHidden: json.auto_hidden_at !== null,
		commentCount: json.comment_count,
		createdAt: json.created_at
	};
}

function mapItem(json: RawActivityItem): FeedItem {
	return {
		id: String(json.id),
		kind: json.kind,
		entryKind:
			json.entry_kind === 'hint' || json.entry_kind === 'solution' ? json.entry_kind : undefined,
		actorId: idOr(json.actor),
		actorDisplayName: json.actor_display_name,
		targetLabel: json.target_label,
		exerciseId: idOr(json.exercise),
		materialId: idOr(json.material),
		courseId: idOr(json.course),
		eventId: idOr(json.happening),
		serviceId: idOr(json.service),
		postId: idOr(json.post),
		post: json.post_detail ? mapPost(json.post_detail) : undefined,
		branchId: json.branch ?? undefined,
		disciplineId: json.discipline ?? undefined,
		tags: json.tags ?? [],
		createdAt: json.created_at
	};
}

export interface FeedFilters {
	kind?: FeedKind;
	disciplineId?: string;
	branchId?: string;
	tagSlug?: string;
	/** Signed-in only: narrow to followed tags + courses the reader is in. */
	followed?: boolean;
	/** The id cursor — rows strictly older than this feed row. */
	beforeId?: string;
	limit?: number;
}

export async function getActivityFeed(filters: FeedFilters = {}): Promise<FeedItem[]> {
	const search = new URLSearchParams();
	if (filters.kind) search.set('kind', filters.kind);
	if (filters.disciplineId) search.set('discipline', filters.disciplineId);
	if (filters.branchId) search.set('branch', filters.branchId);
	if (filters.tagSlug) search.set('tag', filters.tagSlug);
	if (filters.followed) search.set('followed', '1');
	if (filters.beforeId) search.set('before', filters.beforeId);
	if (filters.limit) search.set('limit', String(filters.limit));
	const qs = search.toString();
	const raw = await apiClient.get<RawActivityItem[]>(`/activity/${qs ? `?${qs}` : ''}`);
	return raw.map(mapItem);
}

// ---- posts -------------------------------------------------------------------------------------

export interface PostDraft {
	body: string;
	/** Exactly one of the three anchors. */
	disciplineId?: string;
	branchId?: string;
	tagSlug?: string;
	/** At most one reference. */
	refExerciseId?: string;
	refMaterialId?: string;
	refCourseId?: string;
	image?: File | null;
}

function draftToForm(draft: PostDraft): FormData {
	const form = new FormData();
	form.set('body', draft.body);
	if (draft.disciplineId) form.set('discipline', draft.disciplineId);
	if (draft.branchId) form.set('branch', draft.branchId);
	if (draft.tagSlug) form.set('tag', draft.tagSlug);
	if (draft.refExerciseId) form.set('ref_exercise', draft.refExerciseId);
	if (draft.refMaterialId) form.set('ref_material', draft.refMaterialId);
	if (draft.refCourseId) form.set('ref_course', draft.refCourseId);
	if (draft.image) form.set('image', draft.image);
	return form;
}

export async function createPost(draft: PostDraft): Promise<Post> {
	// Always multipart — the anchor/reference fields ride along fine either way, and one code path
	// beats branching on whether an image happens to be attached.
	const raw = await apiClient.postForm<RawPost>('/posts/', draftToForm(draft));
	return mapPost(raw);
}

export async function getPostById(id: string): Promise<Post | undefined> {
	try {
		const raw = await apiClient.get<RawPost>(`/posts/${encodeURIComponent(id)}/`);
		return mapPost(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

export async function updatePost(id: string, changes: Partial<PostDraft>): Promise<Post> {
	// Only the provided keys go on the wire — a PATCH carrying body='' would be an edit to blank,
	// not an omission.
	const form = new FormData();
	if (changes.body !== undefined) form.set('body', changes.body);
	if (changes.disciplineId !== undefined) form.set('discipline', changes.disciplineId ?? '');
	if (changes.branchId !== undefined) form.set('branch', changes.branchId ?? '');
	if (changes.tagSlug !== undefined) form.set('tag', changes.tagSlug ?? '');
	if (changes.image !== undefined && changes.image !== null) form.set('image', changes.image);
	const raw = await apiClient.patchForm<RawPost>(`/posts/${encodeURIComponent(id)}/`, form);
	return mapPost(raw);
}

/** A tombstone, not a disappearance — the row survives blanked, its thread intact. */
export async function deletePost(id: string): Promise<void> {
	await apiClient.delete(`/posts/${encodeURIComponent(id)}/`);
}
