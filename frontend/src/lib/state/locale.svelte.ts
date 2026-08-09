// Switching the interface language without throwing the page away.
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
import { getLocale, overwriteGetLocale, setLocale, type Locale } from '$lib/paraglide/runtime';

let current = $state<Locale>(getLocale());

// Client only, and that restriction is load-bearing rather than cautious. This is module-level
// state, and a module on the server is shared by every request being handled at once — so a getter
// reading it would let one visitor's language decide what another visitor's page renders in. On the
// server Paraglide's own request-scoped resolution stays exactly as it was.
if (browser) overwriteGetLocale(() => current);

export const localeStore = {
	/** The active interface locale. Reading this is what any message call is already doing. */
	get value(): Locale {
		return current;
	},

	/** `{ reload: false }` is the point of this module. `setLocale` still persists the choice the
	 * same way it always did — the same cookie Paraglide reads on the next real page load — so a
	 * refresh, a shared link, or a server-rendered visit all still come back in this language. Only
	 * the immediate full-page reload is skipped.
	 *
	 * Persist first, then move the rune: `setLocale` reads the current locale on its way through,
	 * and having already told it the new value is how you get it to decide there is nothing to do. */
	set(next: Locale): void {
		if (next === current) return;
		setLocale(next, { reload: false });
		current = next;
	}
};
