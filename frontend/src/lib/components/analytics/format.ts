// Number and date drawing for the analytics dashboard. Plain .ts on purpose: it builds throwaway
// Date objects, which `svelte/prefer-svelte-reactivity` refuses inside a rune module (frontend
// CLAUDE.md trap 7). A date-only string ('2026-10-14') is built in LOCAL time, because
// `new Date('2026-10-14')` is UTC midnight and would show the previous day west of Greenwich.

import { getLocale } from '$lib/paraglide/runtime';
import type { PeopleCount } from '$lib/types/analytics';

/** The server's suppression threshold (`backend/analytics/privacy.py`, k = 10): a count of people
 *  between 1 and k-1 arrives as `null`. The one place the number is written on this side; every
 *  string that mentions it takes it as a `{k}` parameter. The cohorts payload also carries `k`. */
export const PRIVACY_K = 10;

function localDate(iso: string): Date {
	const [y, mo, d] = iso.slice(0, 10).split('-').map(Number);
	return new Date(y, mo - 1, d);
}

/** "14 Oct" — an axis tick or a table cell. */
export function shortDate(iso: string): string {
	return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(
		localDate(iso)
	);
}

/** "Wed, 14 Oct 2026" — a tooltip. */
export function longDate(iso: string): string {
	return new Intl.DateTimeFormat(getLocale(), {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}).format(localDate(iso));
}

export function formatCount(value: number): string {
	return new Intl.NumberFormat(getLocale()).format(value);
}

/** A fraction as a percentage; `digits` decimals. */
export function formatPercent(fraction: number, digits = 0): string {
	return new Intl.NumberFormat(getLocale(), {
		style: 'percent',
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	}).format(fraction);
}

export function formatMs(ms: number): string {
	return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(ms)} ms`;
}

/** A count of people: the server sends `null` for 1..k-1 (suppression), drawn as "<10". */
export function peopleText(value: PeopleCount): string {
	return value === null ? `<${PRIVACY_K}` : formatCount(value);
}

/** A rounded-up axis maximum (1, 2, 5 x 10^n) so gridlines land on tidy numbers. */
export function niceMax(value: number): number {
	if (value <= 0) return 1;
	const exp = Math.pow(10, Math.floor(Math.log10(value)));
	const f = value / exp;
	const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
	return nice * exp;
}
