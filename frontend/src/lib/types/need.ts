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
