/** The volunteer rota — mirrors `backend/shifts/` one to one (CONFERENCE-BRIEF.md §3.E).
 *
 * A station is a post, a shift is an hour of it, an assignment is a person. The three are separate
 * types here for the same reason they are separate tables there: a station outlives the day, a
 * shift outlives the person standing in it, and "who is on the door at 14:00" is a question about
 * an assignment, not about either of the other two.
 *
 * **`RotaPerson.id` is `null` for a volunteer looking at a co-volunteer.** That is not a missing
 * field to work around — it is the backend saying this reader may not be handed another
 * volunteer's account (§6 rule 3), and `displayName` is already "Anna K." by the time it arrives.
 */

export type StationKind = 'door' | 'room' | 'info' | 'cloakroom' | 'runner' | 'setup' | 'other';

/** One `status`, never two booleans — `dropped`, `no_show` and `done` are three different ends. */
export type AssignmentStatus = 'offered' | 'claimed' | 'confirmed' | 'dropped' | 'no_show' | 'done';
export type AssignmentSource = 'self' | 'organiser' | 'pool';

/** Why a Claim button is disabled, in the backend's own words (house rule 6). The two SOFT ones
 * (`needs_adult`, `needs_confirmation`) do not disable it — they say what the claim will become. */
export type ClaimBlockReason =
	| 'sign_in'
	| 'event_over'
	| 'not_volunteer'
	| 'organiser_assigns'
	| 'minor_no_consent'
	| 'already_assigned'
	| 'shift_full'
	| 'overlap'
	| 'too_close'
	| 'minor_station'
	| 'minor_night'
	| 'minor_daily_cap'
	| 'needs_adult'
	| 'needs_confirmation';

export type DropBlockReason = 'sign_in' | 'not_yours' | 'not_active' | 'cutoff';

/** The soft half of `ClaimBlockReason`, mirrored from `shifts/rules.py`'s `SOFT_REASONS`. */
export const SOFT_CLAIM_REASONS: ClaimBlockReason[] = ['needs_adult', 'needs_confirmation'];

export interface RotaPerson {
	/** `null` when the reader is not an organiser — see the module note. */
	id: string | null;
	displayName: string;
}

export interface Assignment {
	id: string;
	shiftId: string;
	user: RotaPerson;
	status: AssignmentStatus;
	source: AssignmentSource;
	claimedAt: string | null;
	confirmedAt: string | null;
	droppedAt: string | null;
	dropReason: string;
	/** `null` means "the shift's own length" — the derived answer, not zero. */
	hoursCredited: string | null;
	creditNote: string;
	/** What it is actually worth, already resolved by the backend. */
	creditedHours: string;
	/** Organisers only; `null` for everybody else, deliberately. */
	isMinor: boolean | null;
}

export interface Shift {
	id: string;
	stationId: string;
	stationName: string;
	stationKind: StationKind;
	locationText: string;
	briefingNote: string;
	startsAt: string;
	endsAt: string;
	hours: string;
	needed: number;
	note: string;
	followsSession: boolean;
	confirmedCount: number;
	claimedCount: number;
	isShort: boolean;
	/** A shift that is full and still cannot run: everybody on it is a minor. */
	needsAdult: boolean;
	assignments: Assignment[];
	myAssignment: Assignment | null;
	claimBlockReason: ClaimBlockReason | null;
	canClaim: boolean;
	dropBlockReason: DropBlockReason | null;
}

export interface Station {
	id: string;
	eventId: string;
	kind: StationKind;
	name: string;
	locationText: string;
	sessionId: string | null;
	sessionTitle: string;
	briefingNote: string;
	minorsPermitted: boolean;
	requiresAdult: boolean;
	needsConfirmation: boolean;
	order: number;
	shifts: Shift[];
}

export interface StationDraft {
	kind: StationKind;
	name: string;
	locationText?: string;
	session?: string | null;
	briefingNote?: string;
	minorsPermitted?: boolean;
	requiresAdult?: boolean;
	needsConfirmation?: boolean;
	order?: number;
}

export interface ShiftDraft {
	startsAt?: string;
	endsAt?: string;
	needed?: number;
	note?: string;
}

export interface CoverageCell {
	shiftId: string;
	stationId: string;
	stationName: string;
	stationKind: StationKind;
	startsAt: string;
	endsAt: string;
	needed: number;
	confirmed: number;
	claimed: number;
	isShort: boolean;
	needsAdult: boolean;
}

export interface MyShift {
	assignmentId: string;
	shiftId: string;
	status: AssignmentStatus;
	stationName: string;
	stationKind: StationKind;
	locationText: string;
	briefingNote: string;
	startsAt: string;
	endsAt: string;
	hours: string;
	creditedHours: string;
	dropBlockReason: DropBlockReason | null;
	/** First name + last initial. There is no contact for any of them, on purpose. */
	coVolunteers: string[];
}

export interface RotaEvent {
	id: string;
	title: string;
	startsAt: string | null;
	endsAt: string | null;
	locationText: string;
	organiser: string;
}

export interface MyShifts {
	event: RotaEvent;
	/** Where to go when something goes wrong — the `info` station's location, which is what the
	 * rota offers instead of a supervisor's phone number. */
	deskLocation: string;
	shifts: MyShift[];
	hours: string;
}

export interface VolunteerRecord {
	/** `null` for a volunteer on staff who has no record row yet — the list shows them anyway, so
	 * that "cannot claim because no consent is on file" is visible rather than absent. */
	id: string | null;
	user: RotaPerson;
	isMinor: boolean;
	hasConsent: boolean;
	consentRecordedAt: string | null;
	consentNote: string;
	vettingCheckedAt: string | null;
	vettingReference: string;
	emergencyContactNote: string;
	hours: string;
}

export interface VolunteeringSummary {
	event: RotaEvent;
	shiftCount: number;
	doneCount: number;
	hours: string;
}
