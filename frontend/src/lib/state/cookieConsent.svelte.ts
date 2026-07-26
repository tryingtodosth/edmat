// The cookie-consent engine — a Svelte 5 rune module, same idiom theme.svelte.ts already
// establishes for global, persisted client state. Persisted via a REAL cookie (cookies.ts), not
// localStorage — deliberately, since the whole point is recording a consent DECISION, the same
// "strictly necessary, disclosed rather than gated" category the sibling `2donet` project already
// applies to its own auth-session cookie: recording that a choice was made doesn't itself need
// consent (you can't honor a preference you don't remember receiving).
//
// What this app actually has to disclose, checked directly rather than assumed: Paraglide's own
// i18n scaffold (copied verbatim from `2donet`, CLAUDE.md Section 10) already sets a REAL cookie —
// `PARAGLIDE_LOCALE` — for interface-language persistence, and nothing before this module ever told
// a visitor about it. That's a real, load-bearing thing to disclose, not an invented one. Beyond
// that and this module's own consent-choice cookie, EdMat sets no other cookies today — no
// analytics, no tracking — so the "Analytics & non-essential" category below is honestly empty,
// forward-looking rather than gating something that already exists (the same honesty the sibling
// project's own cookie-consent build already applies to its own currently-unused category).

import { getCookie, setCookie } from '$lib/utils/cookies';

export type CookieConsentChoice = 'accepted' | 'rejected';

const COOKIE_NAME = 'edmat-cookie-consent';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // ~400 days, matching Paraglide's own cookieMaxAge

function readStoredChoice(): CookieConsentChoice | null {
	const raw = getCookie(COOKIE_NAME);
	return raw === 'accepted' || raw === 'rejected' ? raw : null;
}

let choice = $state<CookieConsentChoice | null>(readStoredChoice());

export const cookieConsentStore = {
	get choice(): CookieConsentChoice | null {
		return choice;
	},
	/** Whether the banner itself should still be showing — null means "no decision recorded yet." */
	get needsDecision(): boolean {
		return choice === null;
	},
	/** Non-essential (analytics) cookies are allowed only once explicitly accepted — rejecting, or
	 * not having decided yet, both correctly read as "not allowed," matching a real opt-in model
	 * rather than an opt-out one. Nothing in this app currently checks this before setting a real
	 * analytics cookie (there isn't one), but the getter exists so a future one would have somewhere
	 * real to ask first, rather than needing to be invented alongside it. */
	get nonEssentialAllowed(): boolean {
		return choice === 'accepted';
	},
	acceptAll(): void {
		choice = 'accepted';
		setCookie(COOKIE_NAME, 'accepted', COOKIE_MAX_AGE_SECONDS);
	},
	rejectNonEssential(): void {
		choice = 'rejected';
		setCookie(COOKIE_NAME, 'rejected', COOKIE_MAX_AGE_SECONDS);
	}
};
