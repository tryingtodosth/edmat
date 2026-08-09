// The shapes the two calendar views render, and the small amount of geometry they share.
//
// Deliberately generic — no import of Booking, ServiceAvailability or anything else from the booking
// domain. The student's slot grid and the tutor's schedule are the same picture drawn from different
// data, and the components stay reusable only if each caller resolves its own domain objects into
// these first. It is the same "dumb component, pure props in" contract ProductionPathway-style shared
// pieces already follow elsewhere in this project.

/** What a block on the calendar is, visually — never a domain status directly.
 *
 * `window` is the odd one out and is why this is not just "the booking status": it is a band of
 * published availability drawn BEHIND everything else, so a booking can sit visibly inside the hours
 * it occupies. Mapping a status to a tone at the call site is what lets one grid serve a student
 * looking at bookable slots and a tutor looking at their week. */
// `event` is its own tone rather than a reuse of `confirmed`, because a one-off event on a tutor's
// calendar is a genuinely different kind of thing from a booked lesson: nobody paid for it, nobody
// is waiting on the tutor to confirm it, and — the load-bearing difference — it does NOT remove the
// hour from what students are offered (see backend `MyScheduleView`). Drawing it in the same green
// as a confirmed session would say the opposite of all three.
export type CalendarTone = 'window' | 'free' | 'requested' | 'confirmed' | 'settled' | 'event';

/** Tones drawn as a background band rather than a block: full width, behind the rest, never
 * interactive. One definition so the layout and the styling cannot disagree about which is which. */
export const BACKGROUND_TONES: readonly CalendarTone[] = ['window'];

export interface CalendarEntry {
	id: string;
	/** 'YYYY-MM-DD' — which column this belongs in. Kept separate from `start` rather than derived
	 * from it so a caller can place an entry explicitly, and so the grid never has to agree with the
	 * browser about which local day an instant falls in. */
	date: string;
	start: string; // ISO instant
	end: string;
	label: string;
	sublabel?: string;
	tone: CalendarTone;
	/** Whether clicking it means anything. A published-hours band does not; a bookable slot does. */
	interactive?: boolean;
}

export interface CalendarMonthDay {
	date: string; // 'YYYY-MM-DD'
	/** What the number on the cell counts — slots free, or sessions booked, depending on the caller.
	 * The component does not know or care which, which is why the cell's own aria-label is supplied
	 * by the caller rather than invented here. */
	count: number;
	tone?: CalendarTone;
	/** Something is in the background on this day that the count does not measure — the tutor's own
	 * published hours, say, on a day with no sessions booked into them yet. Rendered as a small dot
	 * rather than folded into `count`, because a number that sometimes means sessions and sometimes
	 * means hours is a number nobody can read. */
	marked?: boolean;
}

/** Minutes since midnight, in the viewer's own timezone.
 *
 * Local rather than UTC on purpose: the grid is a picture of somebody's day, and 14:00 has to land on
 * the 14:00 line whatever offset the instant was serialized in. The app has no per-tutor timezone
 * (see CLAUDE.md), so "the viewer's own" is the only answer available and is the right one for the
 * overwhelmingly common case where both parties are in the same place.
 */
export function minutesIntoDay(iso: string): number {
	const at = new Date(iso);
	return at.getHours() * 60 + at.getMinutes();
}

/** 'YYYY-MM-DD' for a Date, from its LOCAL parts.
 *
 * Not `toISOString().slice(0, 10)`, which converts to UTC first and so hands back yesterday for
 * anybody east of Greenwich late in the evening — a real, silent off-by-one-day bug in exactly the
 * component whose entire job is putting things in the right day column.
 */
export function isoDate(day: Date): string {
	return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

/** A local Date at midnight on a 'YYYY-MM-DD'. Parsing the bare string would be read as UTC. */
export function fromIsoDate(date: string): Date {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(year, month - 1, day);
}

/** `count` consecutive days starting at `from`. The constructor normalises an out-of-range day
 * itself, so no Date is ever mutated — which is also what this project's
 * `svelte/prefer-svelte-reactivity` rule wants. */
export function dayRange(from: Date, count: number): string[] {
	return Array.from({ length: count }, (_, offset) =>
		isoDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset))
	);
}

/** `count` days from `day`, without mutating anything — the Date constructor normalises an
 * out-of-range day itself, which is both correct across month ends and what this project's
 * `svelte/prefer-svelte-reactivity` rule wants. */
export function shiftDays(day: Date, count: number): Date {
	return new Date(day.getFullYear(), day.getMonth(), day.getDate() + count);
}

/** The first day of the week containing `day`.
 *
 * `weekStartsOn` is in `Date.getDay()` numbering — 1 for Monday, 0 for Sunday — and defaults to
 * Monday, which is this app's own default (see state/displayPrefs.svelte.ts) and what the backend
 * speaks. It is a parameter rather than a store read on purpose: this module is pure geometry with
 * no imports of its own, which is what makes it testable and what keeps the preference in exactly
 * one place.
 */
export function startOfWeek(day: Date, weekStartsOn: 0 | 1 = 1): Date {
	const offset = (day.getDay() - weekStartsOn + 7) % 7;
	return new Date(day.getFullYear(), day.getMonth(), day.getDate() - offset);
}

/** Every day drawn by a month grid: the whole month, plus the leading and trailing days needed to
 * fill whole weeks, in whichever week order the viewer has asked for.
 *
 * The neighbouring days are real days rather than blanks because a grid that ends mid-row reads as
 * broken, and because "the 1st is a Thursday" is far easier to see when the preceding first-day-of-
 * week is drawn than when three empty cells are.
 */
export function monthGridDays(month: string, weekStartsOn: 0 | 1 = 1): string[] {
	const [year, monthNumber] = month.split('-').map(Number);
	const first = new Date(year, monthNumber - 1, 1);
	const last = new Date(year, monthNumber, 0);
	const from = startOfWeek(first, weekStartsOn);
	const to = startOfWeek(last, weekStartsOn);
	// `to` starts the last row, so the grid runs to that day + 6.
	const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 7;
	return dayRange(from, days);
}

/** 'YYYY-MM' for a date string. */
export function monthOf(date: string): string {
	return date.slice(0, 7);
}

/** `months` further along from a 'YYYY-MM'. Day 1 of the month, so a 31st never lands in the wrong
 * month on the way past February. */
export function shiftMonth(month: string, months: number): string {
	const [year, monthNumber] = month.split('-').map(Number);
	const shifted = new Date(year, monthNumber - 1 + months, 1);
	return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}

export interface LaidOutEntry {
	entry: CalendarEntry;
	/** Fractions of the visible span, 0–1, ready to become `top`/`height` percentages. */
	top: number;
	height: number;
	/** Which of `lanes` side-by-side columns this sits in, and how many there are in its cluster. */
	lane: number;
	lanes: number;
}

/** Place one day's foreground entries, splitting overlapping ones into side-by-side lanes.
 *
 * Overlaps are not a pathological case here — they are the `declared` mode working as designed, where
 * two people can legitimately hold a request on the same hour. Stacking them on top of each other
 * would hide exactly the conflict the tutor opened the calendar to see, so they are laid out beside
 * each other instead, the way every real calendar does it.
 *
 * Clusters, not a global lane count: two overlapping entries in the morning should not make an
 * unrelated afternoon one half-width.
 */
export function layOutDay(
	entries: CalendarEntry[],
	minMinutes: number,
	spanMinutes: number
): LaidOutEntry[] {
	const sorted = [...entries].sort(
		(a, b) => minutesIntoDay(a.start) - minutesIntoDay(b.start) || a.id.localeCompare(b.id)
	);
	const placed: LaidOutEntry[] = [];

	let cluster: LaidOutEntry[] = [];
	let clusterEnd = -1;

	const closeCluster = () => {
		const lanes = cluster.reduce((most, item) => Math.max(most, item.lane + 1), 0);
		for (const item of cluster) item.lanes = lanes;
		cluster = [];
		clusterEnd = -1;
	};

	for (const entry of sorted) {
		const start = minutesIntoDay(entry.start);
		// An entry ending at exactly midnight reads as 0 minutes, which would collapse it to nothing;
		// treat that as the end of the day, which is what it means.
		const rawEnd = minutesIntoDay(entry.end);
		const end = rawEnd <= start ? 24 * 60 : rawEnd;

		if (start >= clusterEnd && cluster.length > 0) closeCluster();

		// The first lane not already occupied at this instant.
		const taken = new Set(
			cluster.filter((item) => minutesIntoDay(item.entry.end) > start).map((item) => item.lane)
		);
		let lane = 0;
		while (taken.has(lane)) lane += 1;

		const item: LaidOutEntry = {
			entry,
			top: (start - minMinutes) / spanMinutes,
			height: Math.max((end - start) / spanMinutes, 0.02), // a sliver, never invisible
			lane,
			lanes: 1
		};
		cluster.push(item);
		placed.push(item);
		clusterEnd = Math.max(clusterEnd, end);
	}
	if (cluster.length > 0) closeCluster();

	return placed;
}

/** The hour range the grid should draw, from any set of minute ranges.
 *
 * Fitted to the content rather than fixed at 00:00–24:00, because a day drawn from midnight makes a
 * two-hour afternoon window an unreadable sliver. Padded by an hour at each end so a block never
 * touches the frame, floored to whole hours so the axis labels are whole hours, and held to a
 * minimum height so a single one-hour session does not fill the screen.
 */
export function hourSpan(
	ranges: { start: number; end: number }[],
	fallback: { from: number; to: number } = { from: 8, to: 20 }
): { from: number; to: number } {
	if (ranges.length === 0) return fallback;
	let earliest = 24 * 60;
	let latest = 0;
	for (const range of ranges) {
		earliest = Math.min(earliest, range.start);
		latest = Math.max(latest, range.end <= range.start ? 24 * 60 : range.end);
	}
	let from = Math.max(0, Math.floor(earliest / 60) - 1);
	let to = Math.min(24, Math.ceil(latest / 60) + 1);
	if (to - from < 6) to = Math.min(24, from + 6);
	if (to - from < 6) from = Math.max(0, to - 6);
	return { from, to };
}

export function visibleHours(
	entries: CalendarEntry[],
	fallback: { from: number; to: number } = { from: 8, to: 20 }
): { from: number; to: number } {
	return hourSpan(
		entries.map((entry) => ({
			start: minutesIntoDay(entry.start),
			end: minutesIntoDay(entry.end)
		})),
		fallback
	);
}

// ---- editing --------------------------------------------------------------------------------
//
// Still domain-free: a window being dragged is a date and two minute offsets, and the grid neither
// knows nor cares whether it is a tutor's published hours, a repeating rule projected onto a week,
// or anything else a later caller might want to draw this way.

/** The grid a drag lands on. Fifteen minutes is the coarsest step nobody has to fight — half-hour
 * snapping cannot express a 45-minute session, and free-form dragging produces 14:07 starts that
 * look like mistakes because they are. */
export const SNAP_MINUTES = 15;

/** The shortest window a drag may produce. Below this a create gesture is read as a mis-click and
 * discarded, which is what stops a stray tap on the grid from writing a one-minute window somebody
 * then has to find and delete. */
export const MIN_WINDOW_MINUTES = 15;

/** A window the grid may create, move, resize and delete.
 *
 * Minutes into the day rather than ISO instants, unlike `CalendarEntry`: an editable window is being
 * dragged around a grid whose whole coordinate system is minutes, and round-tripping every pointer
 * move through a Date only to read the hours back off it would be work in service of nothing. The
 * caller converts once, at the edge.
 */
export interface EditableWindow {
	id: string;
	date: string; // 'YYYY-MM-DD'
	startMinutes: number;
	endMinutes: number;
	/** A short note drawn inside the block — which listing it is narrowed to, typically. */
	label?: string;
}

/** Round to the editing grid. */
export function snap(minutes: number): number {
	return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

export function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

/** Merge overlapping and touching windows on the same day, in order.
 *
 * The browser-side counterpart of the backend's `normalise_windows`, and it exists for the same
 * reason: two dragged blocks at 10–12 and 11–13 are ONE band of published hours, and leaving them as
 * two would draw them stacked on top of each other. Applied on the way out of a gesture so the grid
 * shows what will be saved rather than what was drawn, which is the only version of this that does
 * not surprise somebody on the next reload.
 *
 * `key` groups windows that are genuinely the same axis — the caller supplies it because what counts
 * as "the same hours twice" is a domain question (here: the same day and the same listing) and this
 * module deliberately knows no domain.
 */
export function mergeWindows(
	windows: EditableWindow[],
	key: (window: EditableWindow) => string = (window) => window.date
): EditableWindow[] {
	const grouped = new Map<string, EditableWindow[]>();
	for (const window of windows) {
		const group = grouped.get(key(window));
		if (group) group.push(window);
		else grouped.set(key(window), [window]);
	}

	const merged: EditableWindow[] = [];
	for (const group of grouped.values()) {
		const ordered = [...group].sort((a, b) => a.startMinutes - b.startMinutes);
		let current = { ...ordered[0] };
		for (const window of ordered.slice(1)) {
			if (window.startMinutes <= current.endMinutes) {
				current.endMinutes = Math.max(current.endMinutes, window.endMinutes);
			} else {
				merged.push(current);
				current = { ...window };
			}
		}
		merged.push(current);
	}
	return merged.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);
}

/** 'HH:MM' for minutes into the day — the wire format every time field in this feature speaks. */
export function minutesToClock(minutes: number): string {
	const whole = Math.round(minutes);
	return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** Minutes into the day for an 'HH:MM'. */
export function clockToMinutes(clock: string): number {
	const [hours, minutes] = clock.split(':').map(Number);
	return hours * 60 + (minutes || 0);
}
