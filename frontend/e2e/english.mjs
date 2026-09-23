// Asking for the English interface, for scripts whose checks read English copy.
//
// Since 2026-09-23 the base locale is **Polish** (`project.inlang/settings.json`), so a fresh
// browser context — no cookie, no storage — reads the Polish interface. That is deliberate: this
// is a Polish platform, and a first-time Polish visitor should not watch the page correct itself
// from English. It does mean a script written before that date, whose checks name English buttons,
// is now asserting against the wrong catalogue: it fails, or — worse — passes vacuously because
// its `includes()` never matched anything either way.
//
// The fix is one cookie, which is exactly what the picker itself writes, so a script using this is
// on the same code path as a person who chose English rather than on a test-only shortcut. Set on
// the CONTEXT, before the first navigation, so even the server-rendered first paint is English.
//
//   import { englishContext } from './english.mjs';
//   const ctx = await englishContext(browser, BASE, { viewport: { width: 1280, height: 950 } });
//
// A script that wants the Polish default (or that tests the default itself, like
// `language-default.mjs`) simply does not use this.

/** The cookie the header's picker writes when somebody chooses English. */
export const englishLocaleCookie = (base) => [{ name: 'PARAGLIDE_LOCALE', value: 'en', url: base }];

/** `browser.newContext(...)`, plus that cookie. `base` is the script's own `E2E_BASE`. */
export async function englishContext(browser, base, options = {}) {
	const ctx = await browser.newContext(options);
	await ctx.addCookies(englishLocaleCookie(base));
	return ctx;
}
