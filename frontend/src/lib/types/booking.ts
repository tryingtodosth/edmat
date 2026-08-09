import type { ScheduleEvent } from './event';

// Booking a session with a tutor — see backend/booking/models.py's own module doc comment for the
// full design reasoning. The one thing worth repeating here, because it governs how every screen in
// this feature has to read: a tutor decides PER OFFERING (`Service.availabilityMode`) how the
// availability a student sees is computed, and the two answers mean genuinely different things.

/** How the shown availability is computed for one offering.
 *
 * `derived` — declared hours minus everything already taken. Booking an hour removes it from what
 * the next student sees, so a slot on screen is a slot that is really free.
 *
 * `declared` — a fixed published window that keeps showing whole even once part of it is spoken for.
 * A slot on screen means "the tutor teaches at this time", not "nobody else has asked". That is a
 * legitimate way to run a schedule, not a bug — but it MUST be said on screen, which is why every
 * availability response carries the mode rather than leaving the UI to guess. */
export type AvailabilityMode = 'derived' | 'declared';

/** One-off departures from the weekly pattern, in both directions. `block` is "not that Tuesday"
 * (including any other appointment the tutor has recorded); `open` is "and also this one Saturday",
 * which no amount of blocking could express. */
export type AvailabilityExceptionKind = 'block' | 'open';

export type BookingStatus = 'requested' | 'confirmed' | 'declined' | 'cancelled' | 'completed';

/** A recurring weekly window in the tutor's own schedule.
 *
 * `serviceId` is usually absent, and that is the common case rather than an omission: a person has
 * one calendar, so a rule belongs to the tutor and applies to every listing they run. Setting it
 * narrows the rule to one offering ("I only teach Analiza on Thursday evenings"). */
export interface AvailabilityRule {
	id: string;
	serviceId?: string;
	/** `date.getDay()`-style numbering shifted to Monday = 0, matching Python's `date.weekday()`,
	 * which is what the backend compares against. Converting at the two render sites is deliberate —
	 * the wire format follows the side that does the arithmetic. */
	weekday: number;
	startTime: string; // 'HH:MM'
	endTime: string;
}

export interface AvailabilityException {
	id: string;
	date: string; // 'YYYY-MM-DD'
	kind: AvailabilityExceptionKind;
	/** Absent on both means the whole day, which is only ever a `block` — an all-day *opening* would
	 * be a claim to be free from midnight to midnight, and the backend refuses it. */
	startTime?: string;
	endTime?: string;
	note: string;
}

/** One window inside a saved template or a laid-out week — the same shape as an `AvailabilityRule`
 * minus the identity, because these are only ever written as a whole list rather than row by row. */
export interface ScheduleWindow {
	weekday: number;
	startTime: string; // 'HH:MM'
	endTime: string;
	serviceId?: string;
}

/** A named week shape, sitting on a shelf until it is applied to real weeks.
 *
 * Deliberately not the same thing as the repeating `AvailabilityRule` pattern, even though both
 * describe "a week": the pattern is what happens by default, forever, while a template does nothing
 * at all until somebody applies it. */
export interface WeekTemplate {
	id: string;
	name: string;
	windows: ScheduleWindow[];
}

/** What one week's hours are, and where they came from.
 *
 * `detached` is the whole question this shape exists to answer. A week either follows the repeating
 * pattern or has been given its own hours, and an edit means something different in each case — so
 * the editor is told which it is looking at before the tutor makes one. Either way `windows` is
 * populated: an untouched week answers with the pattern projected onto it, so the editor draws the
 * same picture whichever it is.
 *
 * These are the hours BEFORE one-off exceptions, unlike everything the calendar draws around them.
 * This is the layer the editor owns — the hours the tutor works — and folding a dentist appointment
 * into it would mean the next save wrote that appointment in permanently. */
export interface EffectiveWeek {
	/** The stored row's id, and absent exactly when `detached` is false — a week that is only
	 * following the pattern has no row, which is what that flag means. Needed to reattach, since that
	 * is a delete. */
	id?: string;
	/** Always a Monday, whatever week order the viewer is looking at. A stored week is a lookup key
	 * and has to mean the same thing for everybody — see the backend's `monday_of`. */
	weekStart: string; // 'YYYY-MM-DD'
	detached: boolean;
	sourceTemplateId?: string;
	sourceTemplateName: string;
	windows: ScheduleWindow[];
}

/** What a bulk apply actually did. Two lists rather than a count, because "5 weeks updated" and
 * "3 updated, 2 left alone" are different outcomes and the second one is the surprising one. */
export interface WeekApplyResult {
	written: string[];
	skipped: string[];
}

export interface BookingSlot {
	start: string; // ISO instant
	end: string;
}

export interface AvailabilityDay {
	date: string; // 'YYYY-MM-DD'
	slots: BookingSlot[];
}

export interface ServiceAvailability {
	serviceId: string;
	mode: AvailabilityMode;
	sessionMinutes: number;
	/** Whether the tutor has published any weekly rules for this offering at all. Its own flag rather
	 * than inferred from "every day is empty", because a fully-booked fortnight and a schedule nobody
	 * ever wrote look identical otherwise and call for completely different words on screen. */
	hasSchedule: boolean;
	days: AvailabilityDay[];
}

export interface Booking {
	id: string;
	serviceId: string;
	serviceTitle: string;
	/** The mode the listing was in when this row was read — what lets a tutor's queue explain WHY two
	 * requests are sitting on the same hour. */
	availabilityMode: AvailabilityMode;
	tutorId: string;
	tutorDisplayName: string;
	studentId: string;
	studentDisplayName: string;
	startsAt: string;
	endsAt: string;
	status: BookingStatus;
	studentNote: string;
	tutorNote: string;
	/** Which side walked away — the only thing distinguishing "they cancelled on me" from "I
	 * cancelled". Absent while the booking is live. */
	cancelledById?: string;
	/** How many OTHER live bookings of this tutor's collide with this one. Always 0 for a student:
	 * it is a window onto the tutor's whole calendar across every listing they run, which is exactly
	 * what `declared` mode exists to keep private. */
	overlappingCount: number;
	createdAt: string;
}

/** The caller's OWN calendar — every listing they run and every lesson they take, in one picture.
 *
 * Three things it deliberately differs from `ServiceAvailability` in, which is why it is a separate
 * shape and a separate endpoint rather than a flag on that one: the windows are NOT sliced into
 * sessions (session length belongs to one offering and this spans all of them), the bookings are NOT
 * subtracted but returned alongside (a calendar with the appointments cut out of it is the one thing
 * a calendar must not be), and the past is not hidden.
 */
export interface TutorScheduleDay {
	date: string; // 'YYYY-MM-DD'
	/** Published availability, after one-off blocks and openings. Whole windows, not slots. */
	windows: BookingSlot[];
}

export interface TutorSchedule {
	days: TutorScheduleDay[];
	/** Both sides of the caller: somebody who teaches on Tuesday and takes a lesson on Thursday has
	 * one week, not two. */
	bookings: Booking[];
	/** Events the caller is hosting or going to, on the same reasoning: an evening spent running a
	 * workshop is gone whether or not anybody paid for it. Deliberately shown ALONGSIDE the published
	 * windows rather than subtracted from them — see the backend's `MyScheduleView`. */
	events: ScheduleEvent[];
}
