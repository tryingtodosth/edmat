import type { RawLanguageReading, RawTextVersion } from '$lib/types/translation';

/**
 * Poll types — decisions step (MANAGEMENT-BRIEF.md §3.E)
 * Mirrored from backend: decisions/models.py
 */

export interface PollOption {
	id: number;
	text: string;
	order: number;
	/** An option is one line of text, so it has a heading and no body — the one translatable kind
	 *  shaped that way (backend `translations/targets.py`). */
	language?: RawLanguageReading;
	text_versions?: RawTextVersion[];
}

export type PollMode = 'single' | 'multiple';
export type PollStatus = 'draft' | 'open' | 'closed';
export type PollEligibility = 'staff' | 'members';

export interface Poll {
	id: number;
	question: string;
	description: string;
	mode: PollMode;
	anonymous: boolean;
	eligibility: PollEligibility;
	opens_at: string | null;
	closes_at: string | null;
	status: PollStatus;
	decision_note: string;
	closed_by_id: number | null;
	closed_at: string | null;
	created_by_id: number;
	created_at: string;
	options: PollOption[];
	content_type_id: number;
	object_id: number;
	/** Where this poll hangs and where this reader stands on it (backend `config/nodes.py:
	 *  node_ref`, added 2026-10-10). RAW snake_case like the rest of this type — this service has
	 *  no mapper — so it is deliberately NOT the camelCase `NodeRef` every other row carries. */
	node?: {
		kind: string;
		id: number;
		title: string;
		is_staff: boolean;
		is_member: boolean;
		can_manage: boolean;
	} | null;
	/** Whether the requesting user has already cast a ballot — false for an anonymous reader. */
	has_voted: boolean;
	/** The vote form is drawn only when the server says so: open now, eligible, not yet voted. */
	can_vote: boolean;
	/** The tally may be shown: a manager, a closed poll, or an organisation's open board. */
	can_see_results: boolean;
	/** The bilingual text blocks (backend `translations/`, 2026-10-08). RAW snake_case, unlike
	 *  every other management type, because this service has no mapper — see the note beside
	 *  `RawLanguageReading` in `types/translation.ts`. */
	language?: RawLanguageReading;
	text_versions?: RawTextVersion[];
}

export interface PollResults {
	options: Array<{ id: number; text: string; count: number }>;
	ballots: Array<{ id: number; user_id: number; cast_at: string }>;
	eligible_count: number;
}

/** Every refusal word a poll action can answer with (`decisions/rules.py`, house rule 6 — a
 * refusal carries its reason). `not_draft` (PATCH/DELETE) is not surfaced here: the frontend
 * never edits or deletes a poll, only creates, votes, opens and closes one. */
export type PollRefusalReason =
	| 'not_open'
	| 'not_eligible'
	| 'already_voted'
	| 'too_many_choices'
	| 'unknown_option'
	| 'no_options'
	| 'already_open'
	| 'already_closed';
