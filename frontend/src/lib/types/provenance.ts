// Where a piece of content came from — the "AI-assisted" mark (backend `provenance/`, 2026-10-08).
//
// The reading is deliberately TWO MARKS AND ONE NUMBER, which is the owner's decision of
// 2026-10-07 kept in the shape of the type: `authorMarked` is the single-person icon ("the author
// said a machine helped"), `communityMarked` is the three-people icon ("enough readers, confident
// enough, think so"), and `score` is the one percent a filter or a sort would use. They are not
// folded into one tri-state because they are different claims with different standing, and a
// reader wants to know which one they are looking at.
//
// THIS MIRRORS `backend/provenance/rules.py`'s own reading (`_blank` lists every field), and that
// file says so from its side.

/** The four things a mark may be attached to — mirrors `backend/provenance/targets.py`'s
 *  `PROVENANCE_KIND_MODELS`, which is deliberately SHORTER than the report registry: everything
 *  here is a judgement about who wrote a piece of prose, so only things somebody wrote are in it.
 *  A hint and a solution are both `solution_entry` — they are one model that differs by its own
 *  `kind` field. */
export type AssistanceTargetKind = 'exercise' | 'solution_entry' | 'comment' | 'review';

export interface AssistanceReading {
	kind: AssistanceTargetKind;
	id: string;
	/** Percent, 0–100. 100 whenever the author has owned up, otherwise the mean of the votes. */
	score: number;
	/** The single-person icon: the author says a machine helped write this. */
	authorMarked: boolean;
	/** Whether the author has answered AT ALL. `authorAnswered && !authorMarked` is "the author
	 *  says no machine helped", which is a different thing from nobody having asked — the whole
	 *  reason the backend stores `assisted=false` rather than deleting the row. */
	authorAnswered: boolean;
	authorNote: string;
	/** The three-people icon. Needs both enough voters and a high enough mean — see
	 *  `MIN_VOTES_FOR_COMMUNITY_MARK` in the rule module for why one confident vote is not a
	 *  community. */
	communityMarked: boolean;
	votes: number;
	averageConfidence: number;
	/** A moderator has frozen the community reading at `lockValue`, for `lockReason` (house
	 *  rule 6 — a refusal carries its reason, and this one is shown). */
	locked: boolean;
	lockValue: number | null;
	lockReason: string;
	/** This reader's own vote, or `null` for "I have not voted". */
	myConfidence: number | null;
	canVote: boolean;
	canDeclare: boolean;
	canLock: boolean;
}

/** `"<kind>:<id>"` -> reading, exactly as the batch endpoint answers. A target the reader may not
 *  see is simply absent (house rule 4), so every consumer treats "missing" as "draw nothing". */
export type AssistanceReadings = Record<string, AssistanceReading>;

export function assistanceKey(kind: AssistanceTargetKind, id: string): string {
	return `${kind}:${id}`;
}
