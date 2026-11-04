import type {
	CoverageVoteValue,
	Difficulty,
	ExerciseEdit,
	ExerciseRequirement,
	ResolvedExercise,
	SolutionEntry,
	SolutionEntryAttachment,
	SolutionEntryKind,
	SourceType
} from '$lib/types';
import type { ContentBlock } from '$lib/types/blocks';
import { toRawBlocks } from '$lib/api/mappers';
import { apiClient, ApiError } from '$lib/api/client';
import type { Licence } from '$lib/types/licence';
import {
	mapExerciseRequirement,
	mapResolvedExerciseDetail,
	mapResolvedExerciseList,
	mapSolutionEntry,
	mapSolutionEntryAttachment,
	type RawExerciseCommon,
	type RawExerciseDetail,
	type RawExerciseRequirement,
	type RawSolutionEntry,
	type RawSolutionEntryAttachment
} from '$lib/api/mappers';
import { getTopicsForBranch } from './taxonomy';

export type ExerciseSort =
	'number' | 'title' | 'difficulty' | 'rating' | 'reviews' | 'solutions' | 'views' | 'recent';

export interface ExerciseFilters {
	topicId?: string;
	difficulty?: Difficulty;
	sourceType?: SourceType;
	query?: string;
	sort?: ExerciseSort | '';
	dir?: 'asc' | 'desc' | '';
}

function toQueryString(params: Record<string, string | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) search.set(key, value);
	}
	const s = search.toString();
	return s ? `?${s}` : '';
}

/** Topic filtering is always branch-scoped in this app (every real call site passes both a branch
 * and, optionally, a topic within it) — the backend's own Topic model is branch-scoped too
 * (CLAUDE.md Section 9), so `topicId` here is the topic's own numeric-PK-as-string id, never the
 * bare slug (which isn't guaranteed globally unique across branches) — see lib/api/mappers.ts's own
 * id-format note. The backend's `?topic=` filter reads a slug, not a pk, so this resolves the id
 * back to its slug first via a lightweight lookup rather than changing the backend's own filter
 * shape (which is also used, unprefixed, by the Random Exercise picker's branch-scoped topic
 * select, RandomExerciseButton.svelte — a slug-based filter is the one shape both callers share). */
async function topicIdToSlug(branchId: string, topicId: string): Promise<string | undefined> {
	const topics = await getTopicsForBranch(branchId);
	return topics.find((t) => t.id === topicId)?.slug;
}

export async function getExercisesForBranch(
	branchId: string,
	locale: string,
	filters: ExerciseFilters = {}
): Promise<ResolvedExercise[]> {
	const topicSlug = filters.topicId ? await topicIdToSlug(branchId, filters.topicId) : undefined;
	const qs = toQueryString({
		difficulty: filters.difficulty,
		source_type: filters.sourceType,
		q: filters.query,
		topic: topicSlug,
		sort: filters.sort || undefined,
		dir: filters.dir || undefined,
		lang: locale
	});
	const raw = await apiClient.get<RawExerciseCommon[]>(
		`/branches/${encodeURIComponent(branchId)}/exercises/${qs}`
	);
	return raw.map(mapResolvedExerciseList);
}

export async function getExerciseById(
	id: string,
	locale: string
): Promise<ResolvedExercise | undefined> {
	try {
		const raw = await apiClient.get<RawExerciseDetail>(
			`/exercises/${encodeURIComponent(id)}/${toQueryString({ lang: locale })}`
		);
		return mapResolvedExerciseDetail(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

/** The author's (or staff's) in-place edit — `PATCH /api/exercises/{id}/`. The answer is the
 * exercise as the page would load it, in `locale`. A stranger gets 403 `exercise_not_editor`. */
export async function updateExercise(
	id: string,
	edit: ExerciseEdit,
	locale: string
): Promise<ResolvedExercise> {
	const body: Record<string, unknown> = {};
	if (edit.title !== undefined) body.title = edit.title;
	if (edit.statement !== undefined) body.statement = edit.statement;
	if (edit.answer !== undefined) body.answer = edit.answer;
	if (edit.difficulty !== undefined) body.difficulty = edit.difficulty;
	if (edit.audience !== undefined) body.audience = edit.audience;
	if (edit.topicIds !== undefined) body.topic_ids = edit.topicIds.map(Number);
	if (edit.tags !== undefined) body.tags = edit.tags;
	if (edit.source !== undefined)
		body.source = {
			type: edit.source.type,
			name: edit.source.name ?? '',
			collection: edit.source.collection ?? '',
			original_problem_number: edit.source.originalProblemNumber ?? null,
			pages: edit.source.pages ?? '',
			chapter: edit.source.chapter ?? null
		};
	// The parts of a set-shaped exercise, the whole list in order: a missing id creates, a known id
	// updates, a known part left out is deleted with its entries (`SUBEXERCISES-BRIEF.md` §4).
	if (edit.parts !== undefined)
		body.parts = edit.parts.map((p) => ({
			...(p.id === undefined ? {} : { id: Number(p.id) }),
			label: p.label,
			statement: p.statement,
			answer: p.answer
		}));
	const raw = await apiClient.patch<RawExerciseDetail>(
		`/exercises/${encodeURIComponent(id)}/${toQueryString({ lang: locale })}`,
		body
	);
	return mapResolvedExerciseDetail(raw);
}

// ✅ Phase 4 — real, load-tested bulk resolve, one GET /api/exercises/bulk/?ids=... request instead
// of the N parallel single-exercise fetches this used to do. That N-fetch approach was fine for "My
// Set"'s own real-world scale (a handful of exercises, this function's very first real caller) — the
// assumption this doc comment used to state — but the moderation-queue load test proved it wrong at
// a genuinely large scale: the /moderation page's own edit-suggestion/translation resolution (a
// SEPARATE caller from My Set, not routed through this function until now) fired up to 115
// individual requests under a real seeded backlog, ~10s of the page's own load time on its own — see
// CLAUDE.md's own writeup. Both callers now share the same real bulk endpoint.
export async function getExercisesByIds(
	ids: string[],
	locale: string
): Promise<ResolvedExercise[]> {
	if (ids.length === 0) return [];
	const raw = await apiClient.get<RawExerciseDetail[]>(
		`/exercises/bulk/${toQueryString({ ids: ids.join(','), lang: locale })}`
	);
	return raw.map(mapResolvedExerciseDetail);
}

/** A user's own published exercise submissions — the public profile page's own "what they were
 * doing/contributing" section. Already scoped to `published=True` server-side
 * (`_annotated_exercises()`), so a stranger's profile never leaks a still-pending submission. */
export async function getExercisesBySubmitter(
	userId: string,
	locale: string
): Promise<ResolvedExercise[]> {
	const raw = await apiClient.get<RawExerciseCommon[]>(
		`/exercises/${toQueryString({ submitted_by: userId, lang: locale })}`
	);
	return raw.map(mapResolvedExerciseList);
}

/** The caller's OWN unpublished exercises — what the profile's "+ N unpublished" link opens.
 * The server answers only the owner (or staff) and hands anybody else an empty list, so this never
 * needs a user id: it is always "mine". */
export async function getMyUnpublishedExercises(locale: string): Promise<ResolvedExercise[]> {
	const raw = await apiClient.get<RawExerciseCommon[]>(
		`/exercises/${toQueryString({ unpublished: '1', lang: locale })}`
	);
	return raw.map(mapResolvedExerciseList);
}

export async function getTopRatedExercises(locale: string, limit = 6): Promise<ResolvedExercise[]> {
	const raw = await apiClient.get<RawExerciseCommon[]>(
		`/exercises/${toQueryString({ sort: 'top', limit: String(limit), lang: locale })}`
	);
	return raw.map(mapResolvedExerciseList);
}

export async function getRecentExercises(locale: string, limit = 6): Promise<ResolvedExercise[]> {
	const raw = await apiClient.get<RawExerciseCommon[]>(
		`/exercises/${toQueryString({ sort: 'recent', limit: String(limit), lang: locale })}`
	);
	return raw.map(mapResolvedExerciseList);
}

/** Every exercise id carrying a given tag, across every branch — the tag-hover menu's own "Save
 * for later" action (TagChip.svelte) needs a branch-agnostic id list to bulk-add, unlike every
 * other exercise-listing call in this file, which is deliberately branch-scoped. */
export async function getExerciseIdsForTag(tagSlug: string): Promise<string[]> {
	const raw = await apiClient.get<{ id: number }[]>(
		`/exercises/${toQueryString({ tag: tagSlug })}`
	);
	return raw.map((e) => String(e.id));
}

/** Branch-agnostic text search — the tag-hover menu's own "add to different content" picker
 * (TagChip.svelte/AddTagToContentModal.svelte) needs to find an exercise by name without knowing
 * which branch it belongs to first, unlike `getExercisesForBranch`'s own always-branch-scoped
 * `filters.query`. */
export async function searchExercises(
	query: string,
	locale: string,
	limit = 8
): Promise<ResolvedExercise[]> {
	if (!query.trim()) return [];
	const raw = await apiClient.get<RawExerciseCommon[]>(
		`/exercises/${toQueryString({ q: query, lang: locale, limit: String(limit) })}`
	);
	return raw.map(mapResolvedExerciseList);
}

export async function getAllTags(): Promise<string[]> {
	const raw = await apiClient.get<{ id: number; slug: string }[]>('/tags/');
	return raw.map((t) => t.slug).sort();
}

/**
 * Every field of Exercise that's actually meaningful to filter a random pick by — deliberately NOT
 * every field on the model (id/number/createdAt/submittedByUserId/originalLocale don't make sense as
 * "give me a random exercise like ___" filters, so they're left out on purpose, not overlooked).
 */
export interface RandomExerciseFilters {
	disciplineId?: string;
	branchId?: string;
	topicId?: string;
	difficulty?: Difficulty;
	sourceType?: SourceType;
	verifiedOnly?: boolean;
	tag?: string;
}

/**
 * Picks one exercise at (weighted) random — the actual selection now happens server-side
 * (GET /api/exercises/random/, exercises/views.py's own `random` action), which mirrors this exact
 * algorithm byte-for-byte:
 *
 * 1. Prefers an exercise the visitor hasn't opened yet (`seenIds`) — but if every filtered
 *    candidate has already been seen, falls back to the full filtered set rather than returning
 *    nothing, since "nothing left to show" would be a worse experience than a repeat.
 * 2. Within whatever pool that leaves, does a WEIGHTED random pick (not uniform) — an exercise
 *    gets `1 + sum of the visitor's own view-count for each of its topics` as its weight, so
 *    topics the visitor has actually been reading are proportionally more likely to come up
 *    again, without ever being a hard filter (a low-affinity exercise can still be picked, just
 *    less often).
 *
 * `seenIds`/`topicAffinity` still come from the visitor's own browser-local browsing history
 * (lib/state/browsingHistory.svelte.ts) — there's no authenticated per-account view history yet
 * (CLAUDE.md's own Random Exercise note already flagged this as the honest state once real
 * accounts existed), so this remains a per-browser signal, just now evaluated against the real
 * corpus server-side instead of an in-memory mock array.
 */
export async function getRandomExercise(
	locale: string,
	filters: RandomExerciseFilters,
	seenIds: string[],
	topicAffinity: Record<string, number>
): Promise<ResolvedExercise | undefined> {
	const qs = toQueryString({
		discipline: filters.disciplineId,
		branch: filters.branchId,
		topic: filters.topicId
			? await topicIdToSlug(filters.branchId ?? '', filters.topicId)
			: undefined,
		difficulty: filters.difficulty,
		source_type: filters.sourceType,
		verified: filters.verifiedOnly ? 'true' : undefined,
		tag: filters.tag,
		lang: locale,
		seen: seenIds.join(','),
		affinity: Object.keys(topicAffinity).length ? JSON.stringify(topicAffinity) : undefined
	});
	const raw = await apiClient.get<RawExerciseDetail | undefined>(`/exercises/random/${qs}`);
	return raw ? mapResolvedExerciseDetail(raw) : undefined;
}

// ---- exercise requirements ("skill tags") — the exact same shape materials.ts's own
// setMaterialRequirements/proposeRequirement/castRequirementVote/retractRequirementVote already
// establish for a Material, applied here to Exercise for the first time. See those functions' own
// doc comments (materials.ts) for the full reasoning — governor-only bulk replace vs. open propose
// vs. open voting is the identical trust split on both content types.

export async function setExerciseRequirements(
	exerciseId: string,
	labels: string[]
): Promise<ResolvedExercise> {
	const raw = await apiClient.put<RawExerciseDetail>(
		`/exercises/${encodeURIComponent(exerciseId)}/requirements/`,
		{ requirements: labels }
	);
	return mapResolvedExerciseDetail(raw);
}

// Thrown specifically for the 409 "this requirement already exists" case, mirroring
// materials.ts's own DuplicateRequirementError for the identical purpose.
export class DuplicateExerciseRequirementError extends Error {}

export async function proposeExerciseRequirement(
	exerciseId: string,
	label: string
): Promise<ExerciseRequirement> {
	try {
		const raw = await apiClient.post<RawExerciseRequirement>(
			`/exercises/${encodeURIComponent(exerciseId)}/requirements/propose_requirement/`,
			{ label }
		);
		return mapExerciseRequirement(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 409)
			throw new DuplicateExerciseRequirementError(e.message);
		throw e;
	}
}

export async function castExerciseRequirementVote(
	requirementId: string,
	value: CoverageVoteValue
): Promise<ExerciseRequirement> {
	const raw = await apiClient.post<RawExerciseRequirement>(
		`/exercise-requirements/${encodeURIComponent(requirementId)}/vote/`,
		{ value }
	);
	return mapExerciseRequirement(raw);
}

export async function retractExerciseRequirementVote(
	requirementId: string
): Promise<ExerciseRequirement> {
	const raw = await apiClient.delete<RawExerciseRequirement>(
		`/exercise-requirements/${encodeURIComponent(requirementId)}/vote/`
	);
	return mapExerciseRequirement(raw);
}

// ---- the solution/hint pool (backend exercises.SolutionEntry) ----------------------------------
// Peer hints/solutions per exercise: anyone signed in can add one (a verified contributor's /
// staff's / branch governor's publishes immediately, anybody else's waits as `pending` for ONE
// reviewer accept), everyone votes (▲/▼, weighted), staff/governors pin, authors edit their own
// (a non-verified author's edit re-queues it). The pool itself arrives embedded on
// `ResolvedExercise.entries`; these functions are the per-entry actions.

export type SolutionEntryDraft = {
	kind: SolutionEntryKind;
	locale: string;
	body: string;
	/** A notebook (`types/blocks.ts`); absent or empty is a plain entry. */
	blocks?: ContentBlock[];
	/** Its own licence (backend licensing/); absent means `edmat-only`. */
	licence?: Licence;
	/** The part of a set-shaped exercise this is for; absent = the whole exercise. */
	partId?: string;
};

export async function submitSolutionEntry(
	exerciseId: string,
	draft: SolutionEntryDraft
): Promise<SolutionEntry> {
	const { partId, blocks, ...rest } = draft;
	const raw = await apiClient.post<RawSolutionEntry>(
		`/exercises/${encodeURIComponent(exerciseId)}/entries/`,
		{
			...rest,
			...(blocks && blocks.length > 0 ? { blocks: toRawBlocks(blocks) } : {}),
			part: partId === undefined ? null : Number(partId)
		}
	);
	return mapSolutionEntry(raw);
}

/** A scan or a PDF onto a hint/solution you have just written — `uploadCommentAttachment`'s twin
 * against the entry endpoint, because the backend route is that one's twin. `postForm` must not
 * set a Content-Type: the browser generates the multipart boundary itself. */
export async function uploadEntryAttachment(
	entryId: string,
	file: File
): Promise<SolutionEntryAttachment> {
	const form = new FormData();
	form.set('file', file);
	const raw = await apiClient.postForm<RawSolutionEntryAttachment>(
		`/solution-entries/${encodeURIComponent(entryId)}/attachments/`,
		form
	);
	return mapSolutionEntryAttachment(raw);
}

export async function deleteEntryAttachment(entryId: string, attachmentId: string): Promise<void> {
	await apiClient.delete(
		`/solution-entries/${encodeURIComponent(entryId)}/attachments/${encodeURIComponent(attachmentId)}/`
	);
}

/** One accept publishes, one deny (note required) rejects — reviewer circle: verified
 * contributors, staff, branch governors. The moderation queue's tab calls this same endpoint. */
export async function reviewSolutionEntry(
	entryId: string,
	decision: 'approve' | 'reject',
	note = ''
): Promise<SolutionEntry> {
	const raw = await apiClient.post<RawSolutionEntry>(
		`/solution-entries/${encodeURIComponent(entryId)}/review/`,
		{ decision, note }
	);
	return mapSolutionEntry(raw);
}

export async function voteSolutionEntry(entryId: string, value: 1 | -1): Promise<SolutionEntry> {
	const raw = await apiClient.post<RawSolutionEntry>(
		`/solution-entries/${encodeURIComponent(entryId)}/vote/`,
		{ value }
	);
	return mapSolutionEntry(raw);
}

export async function retractSolutionEntryVote(entryId: string): Promise<SolutionEntry> {
	const raw = await apiClient.delete<RawSolutionEntry>(
		`/solution-entries/${encodeURIComponent(entryId)}/vote/`
	);
	return mapSolutionEntry(raw);
}

export async function pinSolutionEntry(entryId: string, pinned: boolean): Promise<SolutionEntry> {
	const raw = await apiClient.post<RawSolutionEntry>(
		`/solution-entries/${encodeURIComponent(entryId)}/pin/`,
		{ pinned }
	);
	return mapSolutionEntry(raw);
}

export async function updateSolutionEntry(
	entryId: string,
	changes: Partial<SolutionEntryDraft>
): Promise<SolutionEntry> {
	const { blocks, ...rest } = changes;
	const raw = await apiClient.patch<RawSolutionEntry>(
		`/solution-entries/${encodeURIComponent(entryId)}/`,
		blocks && blocks.length > 0 ? { ...rest, blocks: toRawBlocks(blocks) } : rest
	);
	return mapSolutionEntry(raw);
}

export async function deleteSolutionEntry(entryId: string): Promise<void> {
	await apiClient.delete(`/solution-entries/${encodeURIComponent(entryId)}/`);
}
