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

/** The five things a mark may be attached to — mirrors `backend/provenance/targets.py`'s
 *  `PROVENANCE_KIND_MODELS`, which is deliberately SHORTER than the report registry: everything
 *  here is a judgement about who wrote a piece of prose, so only things somebody wrote are in it.
 *  A hint and a solution are both `solution_entry` — they are one model that differs by its own
 *  `kind` field. `concept_article` (2026-10-21) is the concept page's ARTICLE, not one revision of
 *  it — the unit with one author, and what `import_concepts --ai-assisted` marks. Every kind here
 *  is also a `ReportKind` under the same name, which `ContentActionsMenu` relies on. */
export type AssistanceTargetKind =
	'exercise' | 'solution_entry' | 'comment' | 'review' | 'concept_article' | 'material';

/** Who stands behind the number the chip prints — mirrors `backend/provenance/rules.py: BASES`,
 *  which names this file back (house rule 13). `too_few` and `none` always print 0: since
 *  2026-11-02 the chip is on every exercise and material, and below three readers a percentage
 *  would be one person's vote dressed as a reading. */
export type AssistanceBasis = 'moderator' | 'author' | 'readers' | 'too_few' | 'none';

export interface AssistanceReading {
	kind: AssistanceTargetKind;
	id: string;
	/** Percent, 0–100. 100 whenever the author has owned up, otherwise the mean of the votes. The
	 *  number a filter or a sort would use — NOT what the chip prints (`shownScore`). */
	score: number;
	/** What the chip prints as "N% AI": `score` when a moderator, the author or enough readers stand
	 *  behind it, else 0 (`basis` says which). */
	shownScore: number;
	basis: AssistanceBasis;
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
