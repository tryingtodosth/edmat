// How this app draws clocks and calendars: 24-hour or 12-hour, weeks starting Monday or Sunday.
//
// **Why these are stored preferences and not read off the locale.** `Intl` will happily pick for
// you — and for `en` it picks 12-hour and a Sunday-first week. That was this app's behaviour before
// these existed, and it was nobody's decision: plenty of people read the English interface and still
// expect 16:00 on a Monday-first week, and the interface language is not a statement about either.
// So the two are their own settings, with their own defaults.
//
// **The defaults are 24-hour and Monday**, and they cost nothing to hold: they are what this app's
// own markets use, and what the rest of the stack already speaks — `AvailabilityRule` stores a
// 24-hour `TimeField` and numbers weekdays from Monday, matching Python's `date.weekday()`. The
// other two are a real choice somebody makes in Settings.
//
// Read directly by the components that draw a clock, the same way `themeStore` is, rather than
// threaded through props from every page. That is the distinction worth holding onto: the calendar
// components stay free of any DOMAIN import (they know nothing about bookings or services, see
// calendar.ts), while chrome this global is fetched where it is needed.
//
// The formatting functions that USE these live in `lib/utils/datetime.ts`, not here. They construct
// throwaway `Date`s, and this project's `svelte/prefer-svelte-reactivity` rule (rightly) refuses a
// mutable Date inside a `.svelte.ts` rune module — a split that turns out to be the better shape
// anyway: this file holds the preference, that one renders with it.

import { authStore } from './auth.svelte';

export type TimeFormat = '24h' | '12h';
export type WeekStart = 'monday' | 'sunday';

export type SaveMenuLayout = 'beside' | 'above';

export const DEFAULT_TIME_FORMAT: TimeFormat = '24h';
export const DEFAULT_WEEK_START: WeekStart = 'monday';
/** Courses beside the sets, because filing an exercise into a course is the rarer of the two jobs —
 * so the sets, which is what most people opened the menu for, stay on the direct path. */
export const DEFAULT_SAVE_MENU_LAYOUT: SaveMenuLayout = 'beside';

class DisplayPrefsStore {
	/** Falls back to the defaults for a signed-out visitor, which is most of the people looking at a
	 * public tutoring listing — so a guest gets the same 24-hour Monday-first calendar the app
	 * defaults to for everybody, not whatever their browser's language implies. */
	get timeFormat(): TimeFormat {
		return authStore.user?.timeFormat ?? DEFAULT_TIME_FORMAT;
	}

	get weekStart(): WeekStart {
		return authStore.user?.weekStartsOn ?? DEFAULT_WEEK_START;
	}

	get hour12(): boolean {
		return this.timeFormat === '12h';
	}

	/** Where the save menu puts the "add to a course" half. `beside` for a guest, who has neither
	 * saved sets nor courses and so never sees the second half at all — the default matters only
	 * once somebody signs in and has said nothing. */
	get saveMenuLayout(): SaveMenuLayout {
		return authStore.user?.saveMenuLayout ?? DEFAULT_SAVE_MENU_LAYOUT;
	}

	/** The week's first day in `Date.getDay()` numbering (Sunday = 0), which is what the geometry in
	 * calendar.ts works in. Converted here, once, rather than at each call site. */
	get weekStartsOn(): 0 | 1 {
		return this.weekStart === 'sunday' ? 0 : 1;
	}

	/** The `Intl` options for a clock, honouring the preference.
	 *
	 * `hourCycle: 'h23'` rather than `hour12: false` for the 24-hour case: `hour12: false` produces
	 * the h24 cycle in some locales, which prints midnight as "24:00" — correct by one convention and
	 * baffling on a calendar.
	 */
	get clockOptions(): Intl.DateTimeFormatOptions {
		return this.hour12
			? { hour: 'numeric', minute: '2-digit', hour12: true }
			: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
	}
}

export const displayPrefs = new DisplayPrefsStore();
