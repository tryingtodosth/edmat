// Concepts: one function per endpoint in CONCEPTS-BRIEF.md §5, and nothing else on this surface
// calls `fetch` (frontend/CLAUDE.md's layer boundary).
//
// Three things this module does that a thinner wrapper would not, each mirroring
// `services/materialProjects.ts` — the two specs describe the same machine (immutable numbered
// revisions, head vs published, 409 on a stale save, one decide endpoint) and the shapes are
// deliberately identical:
//
// 1. **Refusals arrive as typed errors carrying their reason.** `minor`, `self`, `relation`,
//    `note_required` — each is a completely different sentence to the person in front of it
//    (house rule 6). A component catches `ConceptRefusedError` and looks the reason up; it never
//    has to know the reason travelled inside an HTTP body.
// 2. **A stale submit is its own error, carrying the head.** Writing here is turn-based: a
//    revision based on what is no longer the head comes back 409 with the current head attached,
//    and `StaleRevisionError` carries it mapped, so the editor can say what landed underneath.
// 3. **An existing draft is its own error, carrying that draft.** One open draft per (article,
//    author) is a rule, not a failure: the answer is to open the draft you already have, which
//    needs its id, so `DraftExistsError` carries it.

import { apiClient, ApiError } from '$lib/api/client';
import {
	mapConcept,
	mapConceptArticle,
	mapConceptArticleSummary,
	mapConceptAsset,
	mapConceptBacklink,
	mapConceptLink,
	mapConceptListRow,
	mapConceptRevision,
	mapConceptRevisionSummary,
	toRawConceptBlocks,
	type RawConcept,
	type RawConceptArticle,
	type RawConceptArticleSummary,
	type RawConceptAsset,
	type RawConceptBacklink,
	type RawConceptLink,
	type RawConceptListRow,
	type RawConceptRevision,
	type RawConceptRevisionSummary
} from '$lib/api/mappers';
import type {
	Concept,
	ConceptArticle,
	ConceptArticleDraft,
	ConceptArticleSummary,
	ConceptAsset,
	ConceptBacklink,
	ConceptDraft,
	ConceptLink,
	ConceptLinkTargetType,
	ConceptListRow,
	ConceptRelation,
	ConceptRevision,
	ConceptRevisionDraft,
	ConceptRevisionSummary
} from '$lib/types/concept';

/**
 * Somebody else's revision was published first. `head` is what this one should have been written
 * against — null only if the server could not name one (a first revision racing another first
 * revision), which the editor still has a line for.
 */
export class StaleRevisionError extends Error {
	head: ConceptRevisionSummary | null;

	constructor(message: string, head: ConceptRevisionSummary | null) {
		super(message);
		this.name = 'StaleRevisionError';
		this.head = head;
	}
}

/** You already have an unfinished revision of this article. `draft` is it, so the editor can
 *  offer to open it rather than telling somebody they cannot write. */
export class DraftExistsError extends Error {
	draft: ConceptRevisionSummary | null;

	constructor(message: string, draft: ConceptRevisionSummary | null) {
		super(message);
		this.name = 'DraftExistsError';
		this.draft = draft;
	}
}

/**
 * The world moved (409): `already_decided`, `not_draft`, `already_linked`. Distinct from a refusal
 * below, which is about who you are rather than about what has already happened — root CLAUDE.md
 * is explicit that 409 and 400 must not be conflated.
 */
export class ConceptConflictError extends Error {
	reason: string;

	constructor(message: string, reason: string) {
		super(message);
		this.name = 'ConceptConflictError';
		this.reason = reason;
	}
}

/** A rule said no (400 `{detail: '<reason>'}`): `minor`, `self`, `relation`, `body_origin`,
 *  `note_required`, `quota`. The reason IS the message — each has its own sentence in both
 *  catalogues (`components/concept/labels.ts`). */
export class ConceptRefusedError extends Error {
	reason: string;

	constructor(message: string, reason: string) {
		super(message);
		this.name = 'ConceptRefusedError';
		this.reason = reason;
	}
}

/** The `{detail: '…'}` a DRF refusal carries, when it carries one. */
function detailOf(error: unknown): string | null {
	if (!(error instanceof ApiError)) return null;
	const body = error.body as { detail?: unknown } | null | undefined;
	return typeof body?.detail === 'string' ? body.detail : null;
}

/**
 * The one translation from HTTP to this module's errors. Every write below funnels through it, so
 * a new refusal reason needs a message key and nothing else — not a fourth place that inspects an
 * `ApiError` body by hand.
 */
function rethrow(error: unknown): never {
	if (error instanceof ApiError) {
		const detail = detailOf(error);
		if (error.status === 409) {
			if (detail === 'stale') {
				const head = (error.body as { head?: RawConceptRevisionSummary | null } | null)?.head;
				throw new StaleRevisionError(error.message, head ? mapConceptRevisionSummary(head) : null);
			}
			if (detail === 'draft_exists') {
				const draft = (error.body as { draft?: RawConceptRevisionSummary | null } | null)?.draft;
				throw new DraftExistsError(error.message, draft ? mapConceptRevisionSummary(draft) : null);
			}
			throw new ConceptConflictError(error.message, detail ?? 'conflict');
		}
		if (error.status === 400 && detail) throw new ConceptRefusedError(error.message, detail);
	}
	throw error;
}

/** The revision fields every one of the three write paths sends, snake-cased. `blocks` goes
 *  through `toRawConceptBlocks`, which is what drops the read-only expansions. */
function revisionBody(draft: ConceptRevisionDraft): Record<string, unknown> {
	const body: Record<string, unknown> = {
		title: draft.title.trim(),
		summary: draft.summary?.trim() ?? '',
		blocks: toRawConceptBlocks(draft.blocks)
	};
	if (draft.changeNote?.trim()) body.change_note = draft.changeNote.trim();
	if (draft.basedOnId) body.based_on = Number(draft.basedOnId);
	if (draft.submit) body.submit = true;
	return body;
}

/* --- concepts --------------------------------------------------------------------------------- */

/** Every filter the hub's URL can hold. `audience` and `content_locales` are NOT here: `client.ts`
 *  appends both to this list path itself, so no caller can forget them (root CLAUDE.md, i18n). */
export interface ConceptListFilters {
	query?: string;
	branchId?: string;
	tag?: string;
	/** A single letter a–z, for the alphabet strip. */
	letter?: string;
	sort?: 'title' | 'updated';
	limit?: number;
}

function listPath(filters: ConceptListFilters): string {
	const params = new URLSearchParams();
	if (filters.query?.trim()) params.set('q', filters.query.trim());
	if (filters.branchId) params.set('branch', filters.branchId);
	if (filters.tag) params.set('tag', filters.tag);
	if (filters.letter) params.set('letter', filters.letter);
	if (filters.sort) params.set('sort', filters.sort);
	if (filters.limit !== undefined) params.set('limit', String(filters.limit));
	const query = params.toString();
	return query ? `/concepts/?${query}` : '/concepts/';
}

export async function getConcepts(filters: ConceptListFilters = {}): Promise<ConceptListRow[]> {
	const rows = await apiClient.get<RawConceptListRow[]>(listPath(filters));
	return rows.map(mapConceptListRow);
}

/** The link picker's and the tag modal's lookup — the same list endpoint with a term and a short
 *  limit, so there is one place that knows how a concept is searched for. Content-language
 *  narrowing still rides along (`client.ts` adds it); the audience narrowing is deliberately
 *  switched off — see below. */
export async function searchConcepts(query: string, limit = 8): Promise<ConceptListRow[]> {
	if (!query.trim()) return [];
	// `audience=all` explicitly, so the reader's own band preference never hides a concept from a
	// picker. `client.ts` only appends `?audience=` when it is absent, and the backend's
	// `parse_audience_param` reads `all` as "no narrowing" — asking for everyone is not a filter.
	// A picker is not a browse list: you are looking for one named concept to link or tag, and not
	// finding one that exists because of a viewing preference set months ago is a bug.
	const path = listPath({ query, limit });
	const rows = await apiClient.get<RawConceptListRow[]>(
		`${path}${path.includes('?') ? '&' : '?'}audience=all`
	);
	return rows.map(mapConceptListRow);
}

/** Which page of a concept to resolve. An explicit pick beats the reader's stored preference —
 *  that is what makes `?audience=` in a shared link mean something. */
export interface ConceptPageQuery {
	audience?: string;
	locale?: string;
	/** Pick one article out of the page's pool instead of the lead. */
	articleId?: string;
}

/** One concept, resolved for this reader. Null for a 404 — a concept whose every article is still
 *  waiting does not exist as far as a stranger is concerned (house rule 4). */
export async function getConcept(
	slug: string,
	query: ConceptPageQuery = {}
): Promise<Concept | null> {
	const params = new URLSearchParams();
	if (query.audience) params.set('audience', query.audience);
	if (query.locale) params.set('lang', query.locale);
	if (query.articleId) params.set('article', query.articleId);
	const suffix = params.toString() ? `?${params}` : '';
	try {
		return mapConcept(
			await apiClient.get<RawConcept>(`/concepts/${encodeURIComponent(slug)}/${suffix}`)
		);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		throw e;
	}
}

/** Start a concept: the node, its first article and that article's revision 1, in one request.
 *  What comes back says which of two things happened — read `page.article.head` rather than
 *  assuming the button did what it says. */
export async function createConcept(draft: ConceptDraft): Promise<Concept> {
	const body = {
		...revisionBody(draft),
		audience: draft.audience,
		locale: draft.locale,
		branches: draft.branches ?? [],
		tags: draft.tags ?? []
	};
	try {
		return mapConcept(await apiClient.post<RawConcept>('/concepts/', body));
	} catch (e) {
		return rethrow(e);
	}
}

/** The branches a concept is attached to — its governance scope as well as where it is browsable
 *  from. Tags go through `/api/tags/{slug}/apply/` instead, like every other tag in this app. */
export async function updateConceptBranches(slug: string, branches: string[]): Promise<Concept> {
	try {
		return mapConcept(
			await apiClient.patch<RawConcept>(`/concepts/${encodeURIComponent(slug)}/`, { branches })
		);
	} catch (e) {
		return rethrow(e);
	}
}

/* --- articles --------------------------------------------------------------------------------- */

/** Every visible article of a concept, across all its pages. */
export async function getArticles(slug: string): Promise<ConceptArticleSummary[]> {
	const rows = await apiClient.get<RawConceptArticleSummary[]>(
		`/concepts/${encodeURIComponent(slug)}/articles/`
	);
	return rows.map(mapConceptArticleSummary);
}

/** Write your own article for a (audience, locale) — a peer of whatever is already on that page,
 *  never a fight over somebody else's text. */
export async function createArticle(
	slug: string,
	draft: ConceptArticleDraft
): Promise<ConceptArticle> {
	const body = { ...revisionBody(draft), audience: draft.audience, locale: draft.locale };
	try {
		return mapConceptArticle(
			await apiClient.post<RawConceptArticle>(
				`/concepts/${encodeURIComponent(slug)}/articles/`,
				body
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

export async function getArticle(id: string): Promise<ConceptArticle | null> {
	try {
		return mapConceptArticle(
			await apiClient.get<RawConceptArticle>(`/concept-articles/${encodeURIComponent(id)}/`)
		);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		throw e;
	}
}

/** Staff and branch governors only: put this article first in its page's pool. */
export async function setArticlePinned(id: string, pinned: boolean): Promise<ConceptArticle> {
	try {
		return mapConceptArticle(
			await apiClient.patch<RawConceptArticle>(`/concept-articles/${encodeURIComponent(id)}/`, {
				pinned
			})
		);
	} catch (e) {
		return rethrow(e);
	}
}

/* --- revisions -------------------------------------------------------------------------------- */

/** The history, newest first. Published and superseded rows for anybody who may read the article,
 *  plus the caller's own, plus everything for a reviewer — the server decides, not this function. */
export async function getRevisions(articleId: string): Promise<ConceptRevision[]> {
	const rows = await apiClient.get<RawConceptRevision[]>(
		`/concept-articles/${encodeURIComponent(articleId)}/revisions/`
	);
	return rows.map(mapConceptRevision);
}

/**
 * Write a revision of somebody's article — yours or anybody else's, the SAME call, because
 * "improve this" and "edit this" are the same act with different permissions. Throws
 * `StaleRevisionError` when `basedOnId` is no longer the head, and `DraftExistsError` when this
 * author already has one open here.
 */
export async function createRevision(
	articleId: string,
	draft: ConceptRevisionDraft
): Promise<ConceptRevision> {
	try {
		return mapConceptRevision(
			await apiClient.post<RawConceptRevision>(
				`/concept-articles/${encodeURIComponent(articleId)}/revisions/`,
				revisionBody(draft)
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

export async function getRevision(id: string): Promise<ConceptRevision | null> {
	try {
		return mapConceptRevision(
			await apiClient.get<RawConceptRevision>(`/concept-revisions/${encodeURIComponent(id)}/`)
		);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		throw e;
	}
}

/** Drafts are the one mutable thing here. Everything after a submit is immutable and kept. */
export async function saveDraft(id: string, draft: ConceptRevisionDraft): Promise<ConceptRevision> {
	try {
		return mapConceptRevision(
			await apiClient.patch<RawConceptRevision>(
				`/concept-revisions/${encodeURIComponent(id)}/`,
				revisionBody(draft)
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** The one hard delete in this app's content model, and only for a draft (house rule 12). */
export async function deleteDraft(id: string): Promise<void> {
	try {
		await apiClient.delete(`/concept-revisions/${encodeURIComponent(id)}/`);
	} catch (e) {
		return rethrow(e);
	}
}

/** Comes back `published` for staff, a verified contributor or a governor of one of the concept's
 *  branches — and `pending` for everybody else, and for every minor. Read `status`. */
export async function submitRevision(id: string): Promise<ConceptRevision> {
	try {
		return mapConceptRevision(
			await apiClient.post<RawConceptRevision>(
				`/concept-revisions/${encodeURIComponent(id)}/submit/`,
				{}
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** Accept or reject. A rejection must carry a note — the server refuses one without
 *  (`note_required`), and `RevisionDecision` disables the button until there is one. */
export async function decideRevision(
	id: string,
	decision: 'accept' | 'reject',
	note = ''
): Promise<ConceptRevision> {
	try {
		return mapConceptRevision(
			await apiClient.post<RawConceptRevision>(
				`/concept-revisions/${encodeURIComponent(id)}/decide/`,
				{ decision, note }
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** The author taking back their own pending revision. */
export async function withdrawRevision(id: string): Promise<ConceptRevision> {
	try {
		return mapConceptRevision(
			await apiClient.post<RawConceptRevision>(
				`/concept-revisions/${encodeURIComponent(id)}/withdraw/`,
				{}
			)
		);
	} catch (e) {
		return rethrow(e);
	}
}

/* --- links ------------------------------------------------------------------------------------ */

export interface ConceptLinkSets {
	links: ConceptLink[];
	backlinks: ConceptBacklink[];
}

export async function getLinks(slug: string): Promise<ConceptLinkSets> {
	const raw = await apiClient.get<{ links?: RawConceptLink[]; backlinks?: RawConceptBacklink[] }>(
		`/concepts/${encodeURIComponent(slug)}/links/`
	);
	return {
		links: (raw.links ?? []).map(mapConceptLink),
		backlinks: (raw.backlinks ?? []).map(mapConceptBacklink)
	};
}

/** Link a concept to an exercise, a material or another concept. `prerequisite` is legal only for
 *  a concept target; the server answers 400 `relation` otherwise. */
export async function addLink(
	slug: string,
	targetType: ConceptLinkTargetType,
	targetId: string,
	relation: ConceptRelation = 'related'
): Promise<ConceptLink> {
	try {
		return mapConceptLink(
			await apiClient.post<RawConceptLink>(`/concepts/${encodeURIComponent(slug)}/links/`, {
				target_type: targetType,
				target_id: Number(targetId),
				relation
			})
		);
	} catch (e) {
		return rethrow(e);
	}
}

/** Only a `manual` row can go: a `body` row is what the text itself says, and is re-derived from
 *  it on every publish (400 `body_origin`). */
export async function removeLink(id: string): Promise<void> {
	try {
		await apiClient.delete(`/concept-links/${encodeURIComponent(id)}/`);
	} catch (e) {
		return rethrow(e);
	}
}

/**
 * The chip row on an exercise or a material: which concepts point at this thing.
 *
 * An empty list is a real answer here, not a failure — with the kill switch off the endpoint
 * answers `[]` on purpose so neighbouring pages keep working (house rule 3), and a 403/404 from an
 * older backend is not worth throwing at a page that is otherwise fine.
 */
export async function getConceptsForTarget(
	targetType: 'exercise' | 'material',
	targetId: string
): Promise<ConceptBacklink[]> {
	try {
		const rows = await apiClient.get<RawConceptBacklink[]>(
			`/concept-links/?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}`
		);
		return rows.map(mapConceptBacklink);
	} catch (e) {
		if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return [];
		throw e;
	}
}

/* --- assets ----------------------------------------------------------------------------------- */

/**
 * Upload a picture or a PDF to place as a block. The bytes that come back are never the bytes that
 * went up (house rule 7): a picture is re-encoded to WebP with its EXIF discarded, a PDF is
 * sniffed, size-capped and scanned where a daemon exists.
 *
 * Multipart, through `postForm` — which must not set a Content-Type, so the browser can generate
 * its own boundary (`client.ts` says why).
 */
export async function uploadConceptAsset(file: File): Promise<ConceptAsset> {
	const form = new FormData();
	form.set('file', file);
	try {
		return mapConceptAsset(await apiClient.postForm<RawConceptAsset>('/concept-assets/', form));
	} catch (e) {
		return rethrow(e);
	}
}
