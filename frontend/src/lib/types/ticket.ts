// Tickets, the door and the badge sheet (CONFERENCE-BRIEF.md §3.D) — mirrors backend/events/
// `ScanEvent` and `events/ticket_views.py` one-to-one.

/** Every answer the door can give, in words. Mirrors `SCAN_RESULT_CHOICES` in
 *  backend/events/models.py, which names this file back (house rule 13). `already_in` is the
 *  "nothing changed" answer for BOTH directions — entering when already inside, leaving when
 *  already outside — so the sentence a volunteer reads depends on `direction` as well. */
export type ScanResult =
	'admitted' | 'already_in' | 'not_going' | 'unknown' | 'exited' | 'collision';

export type ScanDirection = 'entry' | 'exit';

/** What the ticket page prints. `badgeName` already has the minors' rule applied server-side
 *  (`ticket_views._badge_name`) — the page prints what it is given rather than re-deriving it. */
export interface MyTicket {
	token: string;
	shortCode: string;
	status: string;
	badgeName: string;
	isMinor: boolean;
	checkedInAt: string | null;
	checkedOutAt: string | null;
	inside: boolean;
	event: {
		id: string;
		title: string;
		startsAt: string | null;
		endsAt: string | null;
		runsUntil: string | null;
		locationKind: string;
		locationText: string;
		onlineUrl: string;
	};
}

/** One row of the list the scanner caches on open. No ids, no contact data — by construction on
 *  the server, not by the page choosing not to render them. */
export interface CheckinListRow {
	token: string;
	shortCode: string;
	name: string;
	status: string;
	checkedInAt: string | null;
	checkedOutAt: string | null;
	inside: boolean;
}

/** One scan as it sits in the phone's queue before it is sent. `clientNonce` is generated when the
 *  scan happens and is what makes a retried batch idempotent. */
export interface QueuedScan {
	token: string;
	direction: ScanDirection;
	clientNonce: string;
	clientAt: string;
	deviceLabel: string;
	isOfflineSync: boolean;
}

export interface ScanOutcome {
	clientNonce: string;
	result: ScanResult;
	direction: ScanDirection;
	token: string;
	name: string;
	clientAt: string | null;
	receivedAt: string;
	isOfflineSync: boolean;
	deviceLabel: string;
	scannedBy?: string;
}

export interface ScanCounts {
	entries: number;
	exits: number;
	inside: number;
	refused: number;
	collisions: number;
}

export interface ScanBatchReply {
	results: ScanOutcome[];
	counts: ScanCounts;
}

export interface ScanLog {
	counts: ScanCounts;
	scans: ScanOutcome[];
}

export interface Badge {
	name: string;
	isMinor: boolean;
	shortCode: string;
}

export interface BadgeSheet {
	eventTitle: string;
	badges: Badge[];
}
