// Flashcards (backend `flashcards/`, prompts/02-flashcards.md). The prep commit shipped only the
// shapes that OTHER steps build against — a deck as the "make a deck" buttons on a lesson (step C)
// and a session (step E) receive it — so that they compiled before step A landed. Step A owns this
// file from then on and widens it; nobody else edits it. The field set below is the §API contract
// of the brief and must not shrink.
//
// Ids are strings here and numeric pks on the wire, the convention every non-taxonomy object on
// this site follows (root `CLAUDE.md`, API conventions; the mapping happens in
// `lib/services/flashcards.ts`, which is the only place that knows).
import type { Audience } from '$lib/types/audience';
import type { NodeKind, NodeRef } from '$lib/types/node';

/** Where a deck came from. `null` is "somebody built this by hand", which is a real answer and
 *  deliberately not a sixth word meaning the same thing. Mirrors `flashcards/models.py:
 *  SOURCE_KIND_CHOICES`; the labels are in `lib/utils/labels.ts`. */
export type DeckSourceKind = 'set' | 'lesson' | 'session' | 'concept';

/** The four buttons, 1 again / 2 hard / 3 good / 4 easy (`flashcards/models.py: GRADE_CHOICES`,
 *  bound to keys 1–4 on the review screen). */
export type ReviewGrade = 1 | 2 | 3 | 4;

/** Why a placement was refused — `flashcards/rules.py: place_block_reason`, every word with its
 *  own sentence in `lib/utils/labels.ts` (house rule 6). */
export type DeckRefusalReason = 'not_owner' | 'cannot_manage' | 'already_placed' | 'kind' | 'minor';

export interface DeckPlacementRef {
	kind: 'course' | 'event';
	id: string;
}

/** One "this deck is on that course / that event" row. */
export interface DeckPlacement {
	id: string;
	node: NodeRef | null;
	order: number;
	addedBy: { id: string; displayName: string } | null;
	addedAt: string;
}

export interface Deck {
	id: string;
	name: string;
	cardCount: number;
	/** Cards this reader could study right now — due **plus** new, because both are ready. The
	 *  split is in `ReviewQueue.counts` (`flashcards/rules.py: due_count` says the same from its
	 *  side). Per reader, never stored on the row: thirty people studying one placed deck have
	 *  thirty different answers. */
	dueCount: number;
	isPublic: boolean;
	audience: Audience;
	sourceKind: DeckSourceKind | null;
	sourceId: string | null;
	createdAt: string;
	canEdit: boolean;
	placements: DeckPlacement[];
	ownerDisplayName: string;
	/** Only on the response to a create that carried `exerciseIds`: how many were left out because
	 *  this caller cannot see them (or because the id repeated). Absent otherwise. */
	skipped?: number;
}

export type CardKind = 'exercise' | 'concept' | 'text';

/** Just enough to name an exercise in a card list. The STATEMENT is deliberately not here: the
 *  review screen loads a deck's exercises in one request through `getExercisesByIds`
 *  (`/api/exercises/bulk/`), which is already the endpoint for exactly this. */
export interface CardExerciseRef {
	id: string;
	title: string;
	branchSlug: string | null;
	number: number;
	difficulty: string;
	/** False for a card whose exercise a moderator has pulled — only its deck's owner ever sees
	 *  such a card at all, and the page says why it is greyed out. */
	published: boolean;
}

/** A concept card's two faces, resolved for this reader by `concepts/resolve.py`. Short enough to
 *  inline, unlike a statement. */
export interface CardConceptRef {
	slug: string;
	title: string;
	summary: string;
}

export interface Card {
	id: string;
	order: number;
	kind: CardKind;
	exercise: CardExerciseRef | null;
	concept: CardConceptRef | null;
	front: string;
	back: string;
	includeHint: boolean;
	includeSolution: boolean;
}

/** What `GET /api/nodes/{kind}/{id}/decks/` answers — the DECK embedded, where `DeckPlacement`
 *  embeds the node. Two shapes on purpose: one is read from inside a deck ("where is my deck?"),
 *  the other from a course or an event page ("what is on this page?"), and one carrying both would
 *  be a cycle. `flashcards/serializers.py: NodeDeckPlacementSerializer` says the same. */
export interface NodeDeckPlacement {
	id: string;
	deck: Deck;
	order: number;
	addedBy: { id: string; displayName: string } | null;
	addedAt: string;
}

/** `GET /api/decks/{id}/review/`. The counts are the honest totals, not the length of `cards` —
 *  somebody with 300 waiting is told 300 and handed a session. */
export interface ReviewQueue {
	cards: Card[];
	counts: { due: number; new: number; learned: number; total: number };
}

/** `POST /api/cards/{id}/grade/` — this person's new schedule for that card. */
export interface ReviewState {
	cardId: string;
	dueAt: string;
	intervalDays: number;
	ease: number;
	repetitions: number;
	lapses: number;
}

/** `GET /api/flashcards/due/`. */
export interface DueSummary {
	decks: { id: string; name: string; due: number }[];
	total: number;
}

export interface DeckFromExercisesDraft {
	name: string;
	exerciseIds: string[];
	source?: { kind: DeckSourceKind; id: string };
	placement?: DeckPlacementRef;
}

/** `POST /api/decks/{id}/cards/` — exactly one of the three faces, refused as a 400 otherwise
 *  (`flashcards/serializers.py: CardDraftSerializer`). */
export interface CardDraft {
	exerciseId?: string;
	conceptSlug?: string;
	front?: string;
	back?: string;
	includeHint?: boolean;
	includeSolution?: boolean;
}

export type { NodeKind };
