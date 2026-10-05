// Flashcards (backend flashcards/, prompts/02-flashcards.md). The prep commit ships only the shapes
// that OTHER steps build against — a deck as the "make a deck" buttons on a lesson (step C) and a
// session (step E) receive it — so that they compile before step A lands. Step A owns this file
// from then on and widens it; nobody else edits it. The field set below is the §API contract of
// the brief and must not shrink.
export interface Deck {
	id: string;
	name: string;
	cardCount: number;
	dueCount: number;
	isPublic: boolean;
	sourceKind: 'set' | 'lesson' | 'session' | 'concept' | null;
	createdAt: string;
}

export interface DeckPlacementRef {
	kind: 'course' | 'event';
	id: string;
}

export interface DeckFromExercisesDraft {
	name: string;
	exerciseIds: string[];
	source?: { kind: 'set' | 'lesson' | 'session' | 'concept'; id: string };
	placement?: DeckPlacementRef;
}
