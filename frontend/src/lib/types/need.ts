// `needs` — help wanted, and who answered (MANAGEMENT-BRIEF.md §3.C). Mirrors `backend/needs/
// models.py`'s choices; say so in both files (root CLAUDE.md house rule 13).

import type { NodeRef } from './node';

export type NeedKind = 'help' | 'expertise' | 'equipment' | 'venue' | 'other';
export type NeedStatus = 'open' | 'in_progress' | 'fulfilled' | 'cancelled';
export type SkillLevel = 'none' | 'beginner' | 'intermediate' | 'advanced';
export type NeedApplicationStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';

export interface NeedPerson {
	id: string;
	displayName: string;
}

export interface Need {
	id: string;
	/** `null` only if the node behind it was deleted after the need was posted — a row this
	 *  frontend should not have been handed, but defensive rather than assumed impossible. */
	node: NodeRef | null;
	title: string;
	description: string;
	kind: NeedKind;
	status: NeedStatus;
	skillLevel: SkillLevel;
	estimatedHours: number | null;
	deadline: string | null;
	isRemote: boolean;
	wantedCount: number;
	/** Recounted server-side on every decision (house rule 5) — never trust a locally-held count. */
	acceptedCount: number;
	createdBy: NeedPerson | null;
	createdAt: string;
	updatedAt: string;
}

export interface NeedDraft {
	title: string;
	description: string;
	kind: NeedKind;
	skillLevel: SkillLevel;
	estimatedHours: number | null;
	deadline: string | null;
	isRemote: boolean;
	wantedCount: number;
}

export interface NeedApplication {
	id: string;
	needId: string;
	user: NeedPerson;
	message: string;
	status: NeedApplicationStatus;
	decidedBy: NeedPerson | null;
	decidedAt: string | null;
	createdAt: string;
}

// The five words `needs/rules.py: apply_block_reason` can answer — a refusal is a word, not a
// boolean (house rule 6), and each has a sentence in both message catalogues.
export type ApplyBlockReason = 'not_open' | 'own_node' | 'minor' | 'already_applied' | 'full';

// `needs/rules.py: decide_block_reason`, and reused by a too-late withdraw.
export type DecideBlockReason = 'already_decided';

export type NeedBoardFilters = {
	kind?: NeedKind;
	remote?: boolean;
	q?: string;
	nodeKind?: 'course' | 'event' | 'material';
};

// ---------------------------------------------------------------------------------------------
// The supply side (backend `needs.VolunteeringOffer`, 2026-10-01). It shares `NeedKind` and
// `SkillLevel` with the demand side above deliberately — the backend reuses the same two choice
// lists, so "expertise, advanced" means one thing on both boards and a future matcher has one
// vocabulary to join on.
// ---------------------------------------------------------------------------------------------

/** One field, never a pair of booleans (root CLAUDE.md): `paused` is "not right now, ask me
 *  later" and keeps the row on the volunteer's own page; `closed` is "this is over". */
export type OfferStatus = 'open' | 'paused' | 'closed';

export interface VolunteeringOffer {
	id: string;
	volunteer: NeedPerson | null;
	title: string;
	description: string;
	kind: NeedKind;
	skillLevel: SkillLevel;
	status: OfferStatus;
	/** The language the offer is WRITTEN in — the platform's content axis, what
	 *  `?content_locales=` narrows a list by. */
	language: string;
	/** The languages the volunteer can actually HELP in — a fact about the person, not the text,
	 *  and the one a reader usually means by "in different languages". */
	spokenLanguages: string[];
	hoursPerWeek: number | null;
	isRemote: boolean;
	locationText: string;
	createdAt: string;
	updatedAt: string;
}

export interface VolunteeringOfferDraft {
	title: string;
	description: string;
	kind: NeedKind;
	skillLevel: SkillLevel;
	status: OfferStatus;
	language: string;
	spokenLanguages: string[];
	hoursPerWeek: number | null;
	isRemote: boolean;
	locationText: string;
}

export type OfferBoardFilters = {
	kind?: NeedKind;
	remote?: boolean;
	q?: string;
	/** A language code the volunteer can help in — `?speaks=`, not `?content_locales=`. */
	speaks?: string;
};
