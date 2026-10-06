// Flashcards service (prompts/02-flashcards.md). The ONE seam between this app's routes and
// `/api/decks/…` — no component or route anywhere contains fetch logic (frontend/CLAUDE.md's layer
// boundary), and `apiClient` is the only `fetch()`.
//
// The prep commit shipped exactly one function here, `createDeckFromExercises`, the one the "make a
// deck" buttons of steps C (a lesson) and E (a session) call, written against the §API shape fixed
// in the brief. **Its signature is unchanged** and must stay so: those two branches were built and
// verified against it while this file was a stub.
//
// `/decks/` is deliberately NOT in `client.ts`'s `AUDIENCE_LIST_PATHS`, so no `?audience=` or
// `?content_locales=` rides along: a deck list is the caller's OWN decks, not a browse list, and
// narrowing somebody's own things by their current reading preferences would hide decks they made.
import { apiClient } from '$lib/api/client';
import type {
	Card,
	CardDraft,
	Deck,
	DeckFromExercisesDraft,
	DeckPlacement,
	DeckPlacementRef,
	DeckSourceKind,
	DueSummary,
	NodeDeckPlacement,
	NodeKind,
	ReviewGrade,
	ReviewQueue,
	ReviewState
} from '$lib/types/flashcards';
import type { Audience } from '$lib/types/audience';

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapPlacement(raw: any): DeckPlacement {
	return {
		id: String(raw.id),
		node: raw.node
			? {
					kind: raw.node.kind,
					id: String(raw.node.id),
					title: raw.node.title ?? '',
					isStaff: raw.node.is_staff ?? false,
					isMember: raw.node.is_member ?? false,
					canManage: raw.node.can_manage ?? false
				}
			: null,
		order: Number(raw.order ?? 0),
		addedBy: raw.added_by
			? { id: String(raw.added_by.id), displayName: raw.added_by.display_name ?? '' }
			: null,
		addedAt: String(raw.added_at ?? '')
	};
}

export function mapDeck(raw: Record<string, unknown>): Deck {
	const row = raw as any;
	const deck: Deck = {
		id: String(row.id),
		name: String(row.name ?? ''),
		cardCount: Number(row.card_count ?? 0),
		dueCount: Number(row.due_count ?? 0),
		isPublic: Boolean(row.is_public),
		audience: (row.audience ?? 'university') as Audience,
		// The backend sends `''` for "made by hand"; the type says `null`, because an empty string
		// that means "none" is the kind of value every call site then has to remember to check for.
		sourceKind: (row.source_kind || null) as DeckSourceKind | null,
		sourceId: row.source_id === null || row.source_id === undefined ? null : String(row.source_id),
		createdAt: String(row.created_at ?? ''),
		canEdit: Boolean(row.can_edit),
		placements: Array.isArray(row.placements) ? row.placements.map(mapPlacement) : [],
		ownerDisplayName: String(row.owner_display_name ?? '')
	};
	if (row.skipped !== undefined) deck.skipped = Number(row.skipped);
	return deck;
}

function mapCard(raw: any): Card {
	return {
		id: String(raw.id),
		order: Number(raw.order ?? 0),
		kind: raw.kind,
		exercise: raw.exercise
			? {
					id: String(raw.exercise.id),
					title: String(raw.exercise.title ?? ''),
					branchSlug: raw.exercise.branch_slug ?? null,
					number: Number(raw.exercise.number ?? 0),
					difficulty: String(raw.exercise.difficulty ?? ''),
					published: raw.exercise.published ?? true
				}
			: null,
		concept: raw.concept
			? {
					slug: String(raw.concept.slug),
					title: String(raw.concept.title ?? ''),
					summary: String(raw.concept.summary ?? '')
				}
			: null,
		front: String(raw.front ?? ''),
		back: String(raw.back ?? ''),
		includeHint: Boolean(raw.include_hint),
		includeSolution: Boolean(raw.include_solution)
	};
}

function mapState(raw: any): ReviewState {
	return {
		cardId: String(raw.card),
		dueAt: String(raw.due_at ?? ''),
		intervalDays: Number(raw.interval_days ?? 0),
		ease: Number(raw.ease ?? 2.5),
		repetitions: Number(raw.repetitions ?? 0),
		lapses: Number(raw.lapses ?? 0)
	};
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- decks ---------------------------------------------------------------------------------------

/** The one call steps C, D and E make. Signature fixed by the prep commit — do not change it. */
export async function createDeckFromExercises(draft: DeckFromExercisesDraft): Promise<Deck> {
	const body: Record<string, unknown> = { name: draft.name, exercise_ids: draft.exerciseIds };
	if (draft.source) body.source = { kind: draft.source.kind, id: draft.source.id };
	if (draft.placement) body.placement = { kind: draft.placement.kind, id: draft.placement.id };
	const raw = await apiClient.post<Record<string, unknown>>('/decks/', body);
	return mapDeck(raw);
}

/** `GET /api/decks/` — the caller's own decks, and only ever their own (see the viewset's own note
 *  on why a deck placed on a course I am on belongs on that course's page instead). */
export async function getMyDecks(): Promise<Deck[]> {
	const raw = await apiClient.get<Record<string, unknown>[]>('/decks/');
	return raw.map(mapDeck);
}

export async function getDeck(id: string): Promise<Deck> {
	const raw = await apiClient.get<Record<string, unknown>>(`/decks/${encodeURIComponent(id)}/`);
	return mapDeck(raw);
}

/** A deck with no cards — the "new deck" form. `exerciseIds` goes through
 *  `createDeckFromExercises` instead, which is the same endpoint with a body. */
export async function createDeck(name: string, audience?: Audience): Promise<Deck> {
	const raw = await apiClient.post<Record<string, unknown>>('/decks/', {
		name,
		...(audience ? { audience } : {})
	});
	return mapDeck(raw);
}

export async function updateDeck(
	id: string,
	patch: { name?: string; audience?: Audience; isPublic?: boolean }
): Promise<Deck> {
	const body: Record<string, unknown> = {};
	if (patch.name !== undefined) body.name = patch.name;
	if (patch.audience !== undefined) body.audience = patch.audience;
	if (patch.isPublic !== undefined) body.is_public = patch.isPublic;
	const raw = await apiClient.patch<Record<string, unknown>>(
		`/decks/${encodeURIComponent(id)}/`,
		body
	);
	return mapDeck(raw);
}

export async function deleteDeck(id: string): Promise<void> {
	await apiClient.delete(`/decks/${encodeURIComponent(id)}/`);
}

/** A private copy of a deck the caller can study — a membership snapshot, no placements. */
export async function copyDeck(id: string): Promise<Deck> {
	const raw = await apiClient.post<Record<string, unknown>>(
		`/decks/${encodeURIComponent(id)}/copy/`
	);
	return mapDeck(raw);
}

// ---- cards ---------------------------------------------------------------------------------------

export async function getDeckCards(id: string): Promise<Card[]> {
	const raw = await apiClient.get<Record<string, unknown>[]>(
		`/decks/${encodeURIComponent(id)}/cards/`
	);
	return raw.map(mapCard);
}

export async function addCard(deckId: string, draft: CardDraft): Promise<Card> {
	const body: Record<string, unknown> = {};
	if (draft.exerciseId) body.exercise = Number(draft.exerciseId);
	if (draft.conceptSlug) body.concept = draft.conceptSlug;
	if (draft.front !== undefined) body.front = draft.front;
	if (draft.back !== undefined) body.back = draft.back;
	if (draft.includeHint !== undefined) body.include_hint = draft.includeHint;
	if (draft.includeSolution !== undefined) body.include_solution = draft.includeSolution;
	const raw = await apiClient.post<Record<string, unknown>>(
		`/decks/${encodeURIComponent(deckId)}/cards/`,
		body
	);
	return mapCard(raw);
}

export async function updateCard(
	id: string,
	patch: {
		order?: number;
		front?: string;
		back?: string;
		includeHint?: boolean;
		includeSolution?: boolean;
	}
): Promise<Card> {
	const body: Record<string, unknown> = {};
	if (patch.order !== undefined) body.order = patch.order;
	if (patch.front !== undefined) body.front = patch.front;
	if (patch.back !== undefined) body.back = patch.back;
	if (patch.includeHint !== undefined) body.include_hint = patch.includeHint;
	if (patch.includeSolution !== undefined) body.include_solution = patch.includeSolution;
	const raw = await apiClient.patch<Record<string, unknown>>(
		`/cards/${encodeURIComponent(id)}/`,
		body
	);
	return mapCard(raw);
}

export async function deleteCard(id: string): Promise<void> {
	await apiClient.delete(`/cards/${encodeURIComponent(id)}/`);
}

// ---- reviewing -----------------------------------------------------------------------------------

/** This caller's own queue. Recomputed server-side on every request, so finishing a session and
 *  asking again hands over the next one — nothing is held. */
export async function getReviewQueue(deckId: string): Promise<ReviewQueue> {
	const raw = await apiClient.get<{
		cards: Record<string, unknown>[];
		counts: ReviewQueue['counts'];
	}>(`/decks/${encodeURIComponent(deckId)}/review/`);
	return {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		cards: (raw.cards ?? []).map((row) => mapCard(row as any)),
		counts: raw.counts ?? { due: 0, new: 0, learned: 0, total: 0 }
	};
}

export async function gradeCard(cardId: string, grade: ReviewGrade): Promise<ReviewState> {
	const raw = await apiClient.post<Record<string, unknown>>(
		`/cards/${encodeURIComponent(cardId)}/grade/`,
		{ grade }
	);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return mapState(raw as any);
}

export async function getDueSummary(): Promise<DueSummary> {
	const raw = await apiClient.get<DueSummary>('/flashcards/due/');
	return { decks: raw.decks ?? [], total: raw.total ?? 0 };
}

// ---- placements ----------------------------------------------------------------------------------

/** `GET /api/nodes/{kind}/{id}/decks/` — what `DeckPlacementsPanel` draws. A 404 means "not for
 *  you" as much as "nothing there" (house rule 4), and the panel treats both the same way. */
export async function getNodeDecks(kind: NodeKind, id: string): Promise<NodeDeckPlacement[]> {
	const raw = await apiClient.get<Record<string, unknown>[]>(
		`/nodes/${kind}/${encodeURIComponent(id)}/decks/`
	);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return raw.map((row: any) => ({
		id: String(row.id),
		deck: mapDeck(row.deck ?? {}),
		order: Number(row.order ?? 0),
		addedBy: row.added_by
			? { id: String(row.added_by.id), displayName: row.added_by.display_name ?? '' }
			: null,
		addedAt: String(row.added_at ?? '')
	}));
}

/** Throws an `ApiError` whose `body.detail` is one of `place_block_reason`'s words — read it
 *  through `deckRefusalMessage` in `lib/utils/labels.ts` rather than showing the raw word. */
export async function placeDeck(
	deckId: string,
	placement: DeckPlacementRef
): Promise<DeckPlacement> {
	const raw = await apiClient.post<Record<string, unknown>>(
		`/decks/${encodeURIComponent(deckId)}/placements/`,
		{ kind: placement.kind, id: placement.id }
	);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return mapPlacement(raw as any);
}

export async function removePlacement(id: string): Promise<void> {
	await apiClient.delete(`/deck-placements/${encodeURIComponent(id)}/`);
}
