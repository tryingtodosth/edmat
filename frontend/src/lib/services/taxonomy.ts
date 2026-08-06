import type { Branch, Discipline, Topic } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import {
	mapBranch,
	mapDiscipline,
	type RawBranch,
	type RawDiscipline
} from '$lib/api/mappers';
import { getLocale } from '$lib/paraglide/runtime';

// Every taxonomy request carries `?lang=`, resolved HERE from the interface locale rather than
// taken as a parameter the way `services/exercises.ts` takes one — a deliberate difference, not an
// inconsistency. CLAUDE.md Section 10 keeps interface language and content language independent
// because a reader may genuinely want the original Polish *statement* under an English UI, and the
// exercise detail page gives them a picker for exactly that. A discipline/branch/topic NAME is not
// that kind of content: it's a navigation label (breadcrumbs, filter dropdowns, the disciplines
// index), and nobody wants an English interface whose breadcrumb still reads "Matematyka". So the
// locale isn't a caller's decision here, and making it one is what caused the bug this replaces:
// these calls sent no `lang` at all, the backend's `request_locale` defaulted to 'en', and the
// moment a real `en` translation row was added in the admin, EVERY reader saw the English name —
// including Polish-interface ones. Resolving it inside these six functions makes that class of
// omission unrepresentable at the call sites, of which there are ~36.
function langQuery(): string {
	return `?lang=${encodeURIComponent(getLocale())}`;
}

export async function getDisciplines(): Promise<Discipline[]> {
	const raw = await apiClient.get<RawDiscipline[]>(`/disciplines/${langQuery()}`);
	return raw.map(mapDiscipline);
}

export async function getDisciplineById(id: string): Promise<Discipline | undefined> {
	try {
		const raw = await apiClient.get<RawDiscipline>(
			`/disciplines/${encodeURIComponent(id)}/${langQuery()}`
		);
		return mapDiscipline(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

export async function getBranchesForDiscipline(disciplineId: string): Promise<Branch[]> {
	const raw = await apiClient.get<RawBranch[]>(
		`/disciplines/${encodeURIComponent(disciplineId)}/branches/${langQuery()}`
	);
	return raw.map(mapBranch);
}

export async function getBranchById(id: string): Promise<Branch | undefined> {
	try {
		const raw = await apiClient.get<RawBranch>(
			`/branches/${encodeURIComponent(id)}/${langQuery()}`
		);
		return mapBranch(raw);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return undefined;
		throw e;
	}
}

// Used by the "Submit exercise" branch picker — no single "list every branch" endpoint distinct
// from /api/branches/ exists, and none is needed: that endpoint already returns every published
// branch regardless of discipline.
export async function getAllBranches(): Promise<Branch[]> {
	const raw = await apiClient.get<RawBranch[]>(`/branches/${langQuery()}`);
	return raw.map(mapBranch);
}

// Topics come nested in the branch detail response — no separate topics endpoint exists, matching
// how the source YAML itself stores them (CLAUDE.md Section 9). Known, accepted cost: a call site
// that already has a Branch object in hand (e.g. exercises/[id]/+page.svelte, which fetches the
// branch once and then calls this too) re-fetches the same branch detail a second time rather than
// reading `.topics` off the object it already has — a real, minor redundancy, left as-is rather
// than touching that route's own call pattern (CLAUDE.md Section 13's service-layer boundary is
// about swapping internals, not chasing every call site's own efficiency during the swap).
export async function getTopicsForBranch(branchId: string): Promise<Topic[]> {
	const branch = await getBranchById(branchId);
	return branch?.topics ?? [];
}

/** Suggest a new discipline, branch or topic.
 *
 * A moderator's own suggestion comes back `approved`; everybody else's comes back `pending` and is
 * usable straight away — the browse UI groups pending nodes under "others" rather than hiding them,
 * because a word nobody can use until it is reviewed helps nobody. */
export async function proposeTaxonomyNode(payload: {
	kind: 'discipline' | 'branch' | 'topic';
	name: string;
	slug?: string;
	/** The containing node's slug — a discipline for a branch, a branch for a topic. */
	parent?: string;
}): Promise<{ kind: string; slug: string; status: 'pending' | 'approved' }> {
	return apiClient.post('/taxonomy/propose/', {
		kind: payload.kind,
		name: payload.name,
		slug: payload.slug,
		parent: payload.parent,
		locale: getLocale()
	});
}
