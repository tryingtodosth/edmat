// `goals` — what a node is trying to achieve, and the criteria that say when it has (owner,
// 2026-10-08: "a goal class which is going to be used as a definition of done and also
// commentable"). Mirrors `backend/goals/models.py`'s choices; say so in both files (house rule 13).

import type { NodeRef } from './node';
import type { LanguageReading, TextVersion } from '$lib/types/translation';

/** `met` is never written by a client: the backend derives it from the criteria
 *  (`goals/rules.py: recount`), and a PATCH that asks for it is refused with the reason. */
export type GoalStatus = 'open' | 'met' | 'abandoned';

export interface GoalPerson {
	id: string;
	displayName: string;
}

/** One line of a definition of done. `isMet` is the server's reading of `metAt`, which is the
 *  single field that holds the state — there is no boolean column behind it. */
export interface GoalCriterion {
	id: string;
	text: string;
	order: number;
	isMet: boolean;
	metAt: string | null;
	metBy: GoalPerson | null;
	createdAt: string;
	language: LanguageReading;
	textVersions: TextVersion[];
}

export interface Goal {
	id: string;
	/** `null` only if the node behind it was deleted after the goal was written. */
	node: NodeRef | null;
	title: string;
	description: string;
	status: GoalStatus;
	order: number;
	/** The definition of done, in order. Empty means the goal has not said what done is — and a
	 *  goal with no criteria can never become `met`, which is the point rather than an edge case. */
	criteria: GoalCriterion[];
	criteriaMetCount: number;
	criteriaCount: number;
	createdBy: GoalPerson | null;
	metBy: GoalPerson | null;
	metAt: string | null;
	createdAt: string;
	updatedAt: string;
	/** Whether this reader may rewrite the goal and its criteria (node manager, or its author). */
	canEdit: boolean;
	/** Whether this reader may tick a criterion off (node staff — deliberately wider than
	 *  `canEdit`: whoever is doing the work is who knows a criterion is now true). */
	canTick: boolean;
	language: LanguageReading;
	textVersions: TextVersion[];
}

export interface GoalDraft {
	title: string;
	description: string;
}
