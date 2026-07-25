import type { Difficulty, ResolvedExercise, SourceType } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	mapResolvedExerciseDetail,
	mapResolvedExerciseList,
	type RawExerciseCommon,
	type RawExerciseDetail
} from '$lib/api/mappers';
import { getTopicsForCourse } from './taxonomy';

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

/** Topic filtering is always course-scoped in this app (every real call site passes both a course
 * and, optionally, a topic within it) — the backend's own Topic model is course-scoped too
 * (CLAUDE.md Section 9), so `topicId` here is the topic's own numeric-PK-as-string id, never the
 * bare slug (which isn't guaranteed globally unique across courses) — see lib/api/mappers.ts's own
 * id-format note. The backend's `?topic=` filter reads a slug, not a pk, so this resolves the id
 * back to its slug first via a lightweight lookup rather than changing the backend's own filter
 * shape (which is also used, unprefixed, by the Random Exercise picker's course-scoped topic
 * select, RandomExerciseButton.svelte — a slug-based filter is the one shape both callers share). */
async function topicIdToSlug(courseId: string, topicId: string): Promise<string | undefined> {
	const topics = await getTopicsForCourse(courseId);
	return topics.find((t) => t.id === topicId)?.slug;
}

export async function getExercisesForCourse(
	courseId: string,
	locale: string,
	filters: ExerciseFilters = {}
): Promise<ResolvedExercise[]> {
	const topicSlug = filters.topicId ? await topicIdToSlug(courseId, filters.topicId) : undefined;
	const qs = toQueryString({
		difficulty: filters.difficulty,
		source_type: filters.sourceType,
		q: filters.query,
		topic: topicSlug,
		lang: locale
	});
	const raw = await apiClient.get<RawExerciseCommon[]>(
		`/courses/${encodeURIComponent(courseId)}/exercises/${qs}`
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

// Used by the "My Set" page. No bulk /api/exercises/?ids= lookup exists on the backend — a set is
// typically a handful of exercises, so N parallel single-exercise fetches (already exactly how
// getUserById-style resolution works elsewhere in this app, e.g. exercises/[id]/+page.svelte's own
// resolveUsers) is simple and fast enough rather than adding a bespoke bulk endpoint for one caller.
export async function getExercisesByIds(
	ids: string[],
	locale: string
): Promise<ResolvedExercise[]> {
	const found = await Promise.all(ids.map((id) => getExerciseById(id, locale)));
	return found.filter((e): e is ResolvedExercise => e !== undefined);
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
	fieldId?: string;
	courseId?: string;
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
		field: filters.fieldId,
		course: filters.courseId,
		topic: filters.topicId
			? await topicIdToSlug(filters.courseId ?? '', filters.topicId)
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
