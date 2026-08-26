import type {
	CoverageVoteValue,
	Difficulty,
	ExerciseRequirement,
	ResolvedExercise,
	SourceType
} from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	mapExerciseRequirement,
	mapResolvedExerciseDetail,
	mapResolvedExerciseList,
	type RawExerciseCommon,
	type RawExerciseDetail,
	type RawExerciseRequirement
} from '$lib/api/mappers';
import { getTopicsForBranch } from './taxonomy';

export interface ExerciseFilters {
	topicId?: string;
	difficulty?: Difficulty;
	sourceType?: SourceType;
	query?: string;
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
