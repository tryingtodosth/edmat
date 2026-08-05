// Rendering a clock, a date or a weekday name according to the viewer's own preferences.
//
// Separate from `state/displayPrefs.svelte.ts`, which holds the preferences themselves. These build
// throwaway `Date` objects, and this project's `svelte/prefer-svelte-reactivity` rule refuses a
// mutable Date inside a rune module — which is the right instinct and produces the better split:
// there the setting, here the rendering.
//
// Everything goes through `Intl` with the preference applied, never through `Intl`'s own per-locale
// default. That default hands an English reader "4:00 PM" and a Sunday-first week whether they asked
// for either or not, which is exactly what these preferences exist to stop being decided for them.

import { getLocale } from '$lib/paraglide/runtime';
import { displayPrefs } from '$lib/state/displayPrefs.svelte';
/** An instant's time of day, in the viewer's own preference. */
export function formatTimeOfDay(iso: string): string {
	return new Intl.DateTimeFormat(getLocale(), displayPrefs.clockOptions).format(new Date(iso));
}

/** A bare 'HH:MM' — an availability rule's own start and end, which are wall-clock strings with no
 * date attached. Rendered through a throwaway date on an arbitrary day, since `Intl` has no
 * time-only formatter and hand-rolling "13 → 1 PM" is how AM/PM bugs get written. */
export function formatClock(hhmm: string): string {
	const [hour, minute] = hhmm.split(':').map(Number);
	return new Intl.DateTimeFormat(getLocale(), displayPrefs.clockOptions).format(
		new Date(2024, 0, 1, hour, minute)
	);
}

/** A whole hour on a calendar's axis. Minutes are dropped in 12-hour mode ("4 PM", not "4:00 PM") —
 * an axis label is a marker, and the minutes are always zero. */
export function formatHourMark(hour: number): string {
	if (!displayPrefs.hour12) return `${String(hour).padStart(2, '0')}:00`;
	return new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', hour12: true }).format(
		new Date(2024, 0, 1, hour)
	);
}

/** A date and time together — a booking row, a notification. */
export function formatDateTime(iso: string): string {
	return new Intl.DateTimeFormat(getLocale(), {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		...displayPrefs.clockOptions
	}).format(new Date(iso));
}

/** The seven weekday names, in the viewer's own week order.
 *
 * Built from a real week through `Intl` rather than seven message keys, so they arrive translated and
 * abbreviated the way each locale abbreviates. 2024-01-01 was a Monday; day 0 of that month is the
 * Sunday before it, which the Date constructor resolves for us.
 */
export function weekdayNames(style: 'short' | 'long' = 'short'): string[] {
	const offset = displayPrefs.weekStartsOn === 0 ? 0 : 1;
	return Array.from({ length: 7 }, (_, index) =>
		new Intl.DateTimeFormat(getLocale(), { weekday: style }).format(
			new Date(2024, 0, index + offset)
		)
	);
}
