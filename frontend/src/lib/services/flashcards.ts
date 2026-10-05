// Flashcards service (prompts/02-flashcards.md). The prep commit ships ONE function, the one the
// "make a deck" buttons of steps C (a lesson) and E (a session) call, written against the §API
// shape fixed in the brief: `POST /api/decks/` with the exercise ids, where the deck came from and
// where to place it. Step A owns this file afterwards — it keeps this function's signature and
// appends the rest (decks, cards, review, grade, placements, due counts). Nobody else edits it.
import { apiClient } from '$lib/api/client';
import type { Deck, DeckFromExercisesDraft } from '$lib/types/flashcards';

// A raw row as the API sends it; step A replaces this with its real mapper.
export function mapDeck(raw: Record<string, unknown>): Deck {
	return {
		id: String(raw.id),
		name: String(raw.name ?? ''),
		cardCount: Number(raw.card_count ?? 0),
		dueCount: Number(raw.due_count ?? 0),
		isPublic: Boolean(raw.is_public),
		sourceKind: (raw.source_kind as Deck['sourceKind']) ?? null,
		createdAt: String(raw.created_at ?? '')
	};
}

export async function createDeckFromExercises(draft: DeckFromExercisesDraft): Promise<Deck> {
	const body: Record<string, unknown> = { name: draft.name, exercise_ids: draft.exerciseIds };
	if (draft.source) body.source = { kind: draft.source.kind, id: draft.source.id };
	if (draft.placement) body.placement = { kind: draft.placement.kind, id: draft.placement.id };
	const raw = await apiClient.post<Record<string, unknown>>('/decks/', body);
	return mapDeck(raw);
}
