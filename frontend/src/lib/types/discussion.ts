// Discussions under the standing pages — `/about`, the seven `/about/<feature>` showcase pages and
// the manual's twelve. The backend half is `backend/community/discussions.py` and every rule is
// argued there; this file is the shape its two reading endpoints answer with.
//
// The audience values and the refusal words are a hand-maintained mirror of that module
// (`AUDIENCE_CHOICES` and `post_block_reason`'s vocabulary). It says so from its side too — house
// rule 13, because this is exactly where drift creeps in: a word added on the server and not here
// shows a reader a blank line where a sentence should be.

/** Who may WRITE at a location. Reading is never gated — the prose is public and so is the talk
 *  about it (`DiscussionThreadView`'s own docstring). */
export type DiscussionAudience = 'anyone' | 'users' | 'verified' | 'staff';

/** Why this reader may not write here. `null` means they may. One word per sentence the UI has
 *  (house rule 6): "sign in", "verified contributors only" and "a moderator closed this" are three
 *  different things to be told, and a boolean would make them one greyed-out box. */
export type DiscussionBlockReason =
	'off' | 'anonymous' | 'verification_required' | 'staff_only' | 'minor';

export interface DiscussionPolicy {
	/** `<page>` or `<page>#<section>` — the one spelling, built by the server. */
	key: string;
	page: string;
	/** '' for the page's own row, which acts as a ceiling over every section on it. */
	section: string;
	/** The flag, the page's row and this section's row, already folded together. A location that is
	 *  off draws NO affordance at all rather than one that refuses on click (house rule 3). */
	isEnabled: boolean;
	audience: DiscussionAudience;
	/** Whether what gets written here waits for a moderator. Separate from `audience` because
	 *  "verified contributors, and hold what they write" is a real setting. */
	moderated: boolean;
	canPost: boolean;
	postBlockReason: DiscussionBlockReason | null;
	/** True when this reader MAY write and what they write will be held. Not a refusal — somebody
	 *  allowed to write deserves to know before they write, not after. */
	heldForYou: boolean;
	/** Public comments only; held ones are not counted, so the collapsed affordance never promises
	 *  a thread that turns out to be empty. */
	commentCount: number;
}

/** What a moderator sees and edits in `/moderation`. The ROW's own fields, deliberately not the
 *  effective policy — see `DiscussionLocationSerializer`'s docstring for why folding the page's
 *  ceiling in here would make a moderator unable to tell which row to change. */
export interface DiscussionLocationRow {
	id: string;
	key: string;
	page: string;
	section: string;
	isEnabled: boolean;
	audience: DiscussionAudience;
	moderated: boolean;
	commentCount: number;
	/** Waiting for a moderator. The number that makes this list worth opening. */
	heldCount: number;
	updatedAt: string;
	updatedByDisplayName: string;
}
