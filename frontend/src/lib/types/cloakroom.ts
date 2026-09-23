// The cloakroom desk — mirrors backend/cloakroom/ one-to-one (CONFERENCE-BRIEF.md §3.F).
//
// The one thing worth reading this file for: **a `CloakroomItem` has no owner**. There is no
// `attendee`, no `userId`, no name. A coat is found by the token on the paper slip and by nothing
// else, and the exception path records what the item looks like plus the KIND of identity a clerk
// was shown — never a document number. That is not an omission in the mapping; it is the feature.

/** `open` takes coats; `closed` is what reconciliation leaves behind, and it does not reopen. */
export type CloakroomDeskStatus = 'open' | 'closed';

/** One field, not a pile of booleans: `stored` → `returned` (the slip came back),
 * `returned_by_exception` (it did not) or `unclaimed` (nobody came for it). */
export type CloakroomItemStatus = 'stored' | 'returned' | 'unclaimed' | 'returned_by_exception';

/** WHAT was shown at the counter, never what it said. Mirrors `IDENTITY_KIND_CHOICES` in
 * backend/cloakroom/models.py, which names this file back (house rule 13). */
export type CloakroomIdentityKind = 'none' | 'student_card' | 'id_document' | 'account';

/** Why a coat cannot go on that hook — `cloakroom/rules.py`'s `deposit_block_reason`, plus the
 * two the exception dialog can hit and the one a desk delete can. Each has its own sentence in
 * `utils/labels.ts`; "no" on its own is useless to somebody with a queue in front of them. */
export type CloakroomBlockReason =
	| 'not_staff'
	| 'desk_closed'
	| 'rack_taken'
	| 'unknown_rack'
	| 'description_required'
	| 'identity_required'
	| 'not_stored'
	| 'has_items';

/** The verdict on a slip. Not a boolean, and not an HTTP status: all five are sentences the clerk
 * says out loud, and "I have never seen this number" and "that coat went home an hour ago" are
 * completely different things to be told. */
export type CloakroomReturnResult =
	'returned' | 'unknown_token' | 'already_returned' | 'blacklisted' | 'desk_closed';

/** A desk as the reader is allowed to know it. An attendee gets the top four fields and nothing
 * else — the server sends no racks and no counts to somebody who is not working the counter — so
 * the rack fields default to empty here rather than being optional at every call site. */
export interface CloakroomDesk {
	id: string;
	eventId: string;
	name: string;
	opensNote: string;
	status: CloakroomDeskStatus;
	canOperate: boolean;
	/** As typed, and as the server cleaned it (trimmed, deduplicated). Empty for an attendee. */
	racks: string[];
	freeRacks: string[];
	storedCount: number;
	returnedCount: number;
	unclaimedCount: number;
	closedAt: string | null;
}

export interface CloakroomItem {
	id: string;
	deskId: string;
	rackLabel: string;
	/** The whole identity of the coat. Printed on the slip, and nowhere else. */
	token: string;
	status: CloakroomItemStatus;
	description: string;
	depositedAt: string;
	returnedAt: string | null;
	identityKind: CloakroomIdentityKind;
	exceptionNote: string;
}

export interface CloakroomReturn {
	result: CloakroomReturnResult;
	item: CloakroomItem | null;
}

export interface CloakroomReconciliation {
	desk: CloakroomDesk;
	unclaimed: CloakroomItem[];
}

export interface CloakroomDeskDraft {
	name: string;
	racks: string[];
	opensNote: string;
}

export interface CloakroomExceptionDraft {
	description: string;
	identityKind: CloakroomIdentityKind;
	note: string;
}
