// Switching the interface language without throwing the page away — and, since 2026-09-23,
// choosing the first one for somebody who has never switched at all. That second job is two lines
// of decision and one short-circuit ladder at the bottom of this file (`initFirstVisit`); the
// interesting half is in the backend's `config/geo.py`, and the default itself is not decided here
// at all but by `project.inlang/settings.json` — `baseLocale` is `pl`, so Polish is what the HTML
// already arrived in and needs no correcting.
//
// Paraglide's `setLocale` reloads the page by default, and that default is not arbitrary: `m.*()`
// reads the locale when it is CALLED, so markup already on screen keeps whatever language it was
// rendered in. A reload is the blunt way to re-render everything.
//
// It is also expensive in a way that is only obvious once measured. Switching language on
// /exercises/683: the first API call did not fire until 2891ms and the content was only back at
// 3948ms — nearly four seconds of "Loading…" where the exercise had been, because a reload re-runs
// module loading, hydration, the session restore and every fetch the page makes. It is the same
// reason the header briefly claimed nobody was signed in: the session lives in localStorage and
// costs a round trip to turn back into a user, and a reload spends that round trip every time.
//
// So the locale becomes a rune, and `getLocale` is overwritten to read it. Every `m.*()` call in a
// Svelte template goes through `getLocale()`, so each one now has this as a reactive dependency —
// changing it re-runs the text expressions and nothing else. No reload, no rebuild, no refetch: the
// exercise, the scroll position, an open menu and a half-typed comment all survive the switch,
// because none of the components involved are ever torn down.
//
// The first attempt keyed the app shell on the locale instead, which did re-render but destroyed
// and recreated the subtree — so the page still blanked to "Loading…" while it refetched, just for
// 300ms rather than 4s. Faster, and still the wrong shape: the ask was that the page stay put.

import { browser } from '$app/environment';
import {
	baseLocale,
	cookieName,
	getLocale,
	localStorageKey,
	overwriteGetLocale,
	setLocale,
	type Locale
} from '$lib/paraglide/runtime';
import { getLocaleHint } from '$lib/services/localeHint';

let current = $state<Locale>(getLocale());

// What somebody CHOSE, and — separately — what they were once OFFERED. Two keys, because the
// difference between them is the whole decision below, and because neither can be read off
// Paraglide's own storage:
//
// **The `PARAGLIDE_LOCALE` cookie is not evidence of a choice.** It is written on the very first
// visit by Paraglide's own resolution (a fresh, never-visited browser comes out of the first page
// load already carrying `PARAGLIDE_LOCALE=pl`), so treating "a cookie exists" as "they have
// decided" means nobody is ever asked anything — which is exactly what a browser run showed:
// zero requests to the hint endpoint, on a context with no storage at all. The cookie's job is to
// make the NEXT paint correct without script, and it does that job for a guess and a choice alike.
const CHOICE_KEY = 'edmat.localeChoice';
const GUESS_KEY = 'edmat.localeGuess';

function readLocal(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		// A locked-down context (private mode, blocked site data). Nothing here is load-bearing.
		return null;
	}
}

function writeLocal(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Then the decision is re-made next time from whatever else is known, which is a wasted
		// request at worst — never a wrong language, since the cookie still carries it.
	}
}

function asLocale(value: string | null): Locale | null {
	return value === 'en' || value === 'pl' ? value : null;
}

/** A language this visitor actually chose, from either of the two places one can be recorded:
 * this module's own key (written by `set`, which is what the picker and the registration form
 * call), and Paraglide's `localStorage` key — the other place its strategies can persist a
 * locale. That key is not in this project's strategy list today (`cookie`, `globalVariable`,
 * `baseLocale`), so nothing reads it on its own; a locale sitting in it is still somebody's
 * choice, and the honest thing to do with it is to apply it rather than ignore it. */
function storedChoice(): Locale | null {
	return asLocale(readLocal(CHOICE_KEY)) ?? asLocale(readLocal(localStorageKey)) ?? cookieChoice();
}

/** The one thing Paraglide's cookie CAN say about a choice, and the boundary of it.
 *
 * Its own first-visit write is always `baseLocale`, so a cookie holding anything else was written
 * by `setLocale` — that is, by somebody using the picker, or by the offer below being applied. Both
 * are worth honouring, and honouring them is what stops a returning English reader whose
 * localStorage has been cleared (or who chose English before any of this existed) from being
 * quietly moved back to Polish by a guess.
 *
 * What it cannot say: a cookie holding `pl` is indistinguishable from the automatic write, so a
 * Polish-by-choice reader abroad with no localStorage left will be offered English once. One click
 * on the picker settles it for good, and there is no signal here that would settle it for them. */
function cookieChoice(): Locale | null {
	const found = document.cookie
		.split('; ')
		.find((pair) => pair.startsWith(`${cookieName}=`))
		?.slice(cookieName.length + 1);
	const locale = asLocale(found ?? null);
	return locale && locale !== baseLocale ? locale : null;
}

/** The `<html lang>` attribute, which `app.html` paints from the BUILD locale and which nothing
 * updated afterwards — because switching language used to reload the page, and now does not. A
 * stale `lang` is what a screen reader picks its pronunciation rules from, so it is wrong in the
 * way that is hardest to notice by looking. */
function syncDocumentLanguage(locale: Locale): void {
	try {
		document.documentElement.lang = locale;
	} catch {
		// Nothing here is load-bearing either.
	}
}

/** Move the rune, and persist through Paraglide, without recording an opinion about WHY.
 *
 * `{ reload: false }` is the point of this module. `setLocale` still persists the same way it
 * always did — the same cookie Paraglide reads on the next real page load — so a refresh, a shared
 * link or a server-rendered visit all still come back in this language. Only the immediate
 * full-page reload is skipped.
 *
 * Persist first, then move the rune: `setLocale` reads the current locale on its way through, and
 * having already told it the new value is how you get it to decide there is nothing to do. */
function apply(next: Locale): void {
	if (next === current) return;
	setLocale(next, { reload: false });
	current = next;
	syncDocumentLanguage(next);
}

// Client only, and that restriction is load-bearing rather than cautious. This is module-level
// state, and a module on the server is shared by every request being handled at once — so a getter
// reading it would let one visitor's language decide what another visitor's page renders in. On the
// server Paraglide's own request-scoped resolution stays exactly as it was.
if (browser) {
	overwriteGetLocale(() => current);
	// The document was built in `baseLocale`; this visitor may have arrived with a cookie saying
	// otherwise, in which case the attribute is already wrong before anything else happens.
	syncDocumentLanguage(current);
}

export const localeStore = {
	/** The active interface locale. Reading this is what any message call is already doing. */
	get value(): Locale {
		return current;
	},

	/** Switch the interface language, and remember that a person asked for it.
	 *
	 * Everything that calls this is somebody DECIDING — the header picker, the registration form —
	 * so it is also where the decision is written down, before the early return: choosing the
	 * language you are already reading is still a choice, and it is the one that has to stop the
	 * first-visit guess below from ever second-guessing it. */
	set(next: Locale): void {
		writeLocal(CHOICE_KEY, next);
		apply(next);
	},

	/** The very first paint, for somebody who has never chosen a language.
	 *
	 * The default is Polish, and it is free: `baseLocale` is `pl`, so a visitor with no cookie is
	 * already reading Polish in the HTML that arrived — no request, no flash, nothing to correct.
	 * This exists only for the other case, which cannot be known in the browser at all: somebody
	 * outside Poland, who is offered English instead. The server answers that from the address the
	 * request already came from (`GET /api/locale-hint/`), and only when a GeoIP database is
	 * installed to say so — with none, it answers Polish and this changes nothing.
	 *
	 * Three short-circuits, in order, because the cheapest correct answer should cost the least:
	 *   1. a choice — theirs, in either place one can be stored; applied, and never asked about;
	 *   2. a remembered offer from a previous visit — applied, and not asked again;
	 *   3. otherwise ask once, apply it, and remember it as an offer rather than a decision.
	 *
	 * Applied through `apply` rather than `set`, deliberately: a guess must not be written down as
	 * a choice, or the picker would have nothing left to overrule. It still persists — `setLocale`
	 * writes Paraglide's cookie either way — so the SECOND visit already paints in the right
	 * language before any script runs, which is the entire point of a first-visit default.
	 *
	 * A failure is silent by design: the answer this replaces is Polish, which is also the answer
	 * to every failure, so there is nothing to tell anybody about. */
	async initFirstVisit(): Promise<void> {
		if (!browser) return;
		const chosen = storedChoice();
		if (chosen) {
			apply(chosen);
			return;
		}
		const remembered = asLocale(readLocal(GUESS_KEY));
		if (remembered) {
			apply(remembered);
			return;
		}
		try {
			const hint = await getLocaleHint();
			writeLocal(GUESS_KEY, hint.suggestedLocale);
			apply(hint.suggestedLocale);
		} catch {
			// Offline, API down, CORS: the page keeps the language it painted in.
		}
	}
};
