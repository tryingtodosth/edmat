// Venues, rooms, room bookings and checklists — mirrors backend/venues/ one-to-one
// (CONFERENCE-BRIEF.md §3.A).
//
// Every enum below is a hand-maintained mirror of a `_CHOICES` list in `backend/venues/models.py`,
// which names this file back (house rule 13: say so in BOTH files, because a mirrored enum is where
// drift creeps in). The label maps for them live at the end of `lib/utils/labels.ts`.

/** `VENUE_ROLE_CHOICES`. An administrator does everything; a porter sees the building's bookings
 *  and checklists and ticks nothing. */
export type VenueRole = 'administrator' | 'porter';

/** `BOOKING_STATUS_CHOICES`. `rejected` and `cancelled` are kept rather than deleted — an organiser
 *  who was told no needs to see that they were told no, and by whom. */
export type RoomBookingStatus = 'requested' | 'approved' | 'rejected' | 'cancelled';

/** `ITEM_OWNER_CHOICES` — whose job this line is, which is not the same as who may tick it. */
export type ChecklistOwnerRole = 'organiser' | 'venue';

/** `ANCHOR_CHOICES` — whether the signed offset is measured from the event's start or its end. */
export type ChecklistAnchor = 'start' | 'end';

/** `EVIDENCE_KIND_CHOICES` — what "done" has to be accompanied by. */
export type ChecklistEvidenceKind = 'none' | 'text' | 'link' | 'file';

/** `ITEM_STATUS_CHOICES`. One status field, never two booleans. */
export type ChecklistItemStatus = 'pending' | 'in_progress' | 'done' | 'not_applicable';

/**
 * Why a booking may not be made, or an event may not be published, or an item may not change —
 * the word the API hands back instead of a boolean (house rule 6). Every one of these has its own
 * line in the catalogues, because "the room is taken" and "you are bringing more people than the
 * fire instruction allows" are completely different things to do about.
 */
export type VenueBlockReason =
	| 'bad_times'
	| 'room_closed'
	| 'over_fire_capacity'
	| 'room_busy'
	| 'already_decided'
	| 'not_allowed'
	| 'last_administrator'
	| 'already_started'
	| 'venue_required'
	| 'no_such_template'
	| 'na_not_allowed'
	| 'na_reason_required'
	| 'needs_venue_signoff'
	| 'no_signoff_needed'
	| 'checklist_pending';

export interface VenuePerson {
	id: string;
	displayName: string;
}

export interface Room {
	id: string;
	venueId: string;
	name: string;
	number: string;
	floor: string;
	/** How many chairs there are. */
	seatedCapacity: number;
	/** How many people the fire safety instruction lets into the room at once, standing included.
	 *  Never the same number as `seatedCapacity`, and confusing the two is the bug this pair of
	 *  fields exists to make impossible. */
	fireCapacity: number;
	hasAv: boolean;
	accessible: boolean;
	notes: string;
	isActive: boolean;
}

export interface VenueSummary {
	id: string;
	name: string;
	slug: string;
	address: string;
	isActive: boolean;
	roomCount: number;
}

export interface Venue {
	id: string;
	name: string;
	slug: string;
	address: string;
	contactNote: string;
	securityPhone: string;
	isActive: boolean;
	rooms: Room[];
	/** Whether the reader may edit this building — answered by the API, never derived here. */
	canAdminister: boolean;
	myRole: VenueRole | null;
}

export interface VenueStaffMember {
	id: string;
	user: VenuePerson;
	role: VenueRole;
	addedBy: VenuePerson | null;
	addedAt: string;
}

export interface RoomBooking {
	id: string;
	eventId: string;
	eventTitle: string;
	room: Room;
	venue: VenueSummary;
	startsAt: string;
	endsAt: string;
	status: RoomBookingStatus;
	expectedHeadcount: number;
	purpose: string;
	decidedBy: VenuePerson | null;
	decidedAt: string | null;
	/** The building's own sentence. A rejection with no note is a door closed with nobody behind it. */
	note: string;
	createdAt: string;
}

export interface RoomBookingDraft {
	eventId: string;
	roomId: string;
	startsAt: string;
	endsAt: string;
	expectedHeadcount: number;
	purpose: string;
}

export interface ChecklistTemplateItem {
	id: string;
	titleEn: string;
	titlePl: string;
	descriptionEn: string;
	descriptionPl: string;
	ownerRole: ChecklistOwnerRole;
	dueOffsetMinutes: number;
	anchor: ChecklistAnchor;
	isMandatory: boolean;
	naAllowed: boolean;
	evidenceKind: ChecklistEvidenceKind;
	requiresVenueSignoff: boolean;
	order: number;
}

export interface ChecklistTemplate {
	id: string;
	venueId: string | null;
	venueName: string;
	name: string;
	description: string;
	version: number;
	eventKindHint: string;
	isActive: boolean;
	items: ChecklistTemplateItem[];
}

export interface ChecklistItem extends ChecklistTemplateItem {
	instanceId: string;
	/** Null when the event has no time yet — an honest "not known", never "due now". */
	computedDueAt: string | null;
	status: ChecklistItemStatus;
	naReason: string;
	evidenceText: string;
	evidenceUrl: string;
	evidenceFileUrl: string;
	doneBy: VenuePerson | null;
	doneAt: string | null;
	signedOffBy: VenuePerson | null;
	signedOffAt: string | null;
	isOverdue: boolean;
}

export interface ChecklistInstance {
	id: string;
	eventId: string;
	venue: VenueSummary;
	templateId: string | null;
	templateName: string;
	templateVersion: number;
	/** The building has edited the template since this copy was cut — an offer, never an overwrite. */
	templateHasNewItems: boolean;
	/** A `COUNT`, recomputed server-side every read (house rule 5). */
	mandatoryPending: number;
	canSignOff: boolean;
	createdAt: string;
	items: ChecklistItem[];
}
