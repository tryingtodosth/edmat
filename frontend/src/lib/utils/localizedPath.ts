/**
 * The one localized address on this site, as a link.
 *
 * `/tutoring` is where the route lives on disk; `/korki` is what a Polish reader sees
 * (`vite.config.ts` `urlPatterns`, and `hooks.ts` reroutes the Polish address back onto the route).
 * `resolve()` always hands back the canonical English path, so a link that wants to show the
 * reader's own address has to pass it through Paraglide — this is that one step, in one place.
 *
 * **It is reactive**, which is the part worth knowing: `lib/state/locale.svelte.ts` overwrites
 * `getLocale` with a `$state` rune, so a template calling this re-evaluates when somebody uses the
 * language picker, and the address in the bar changes with the text — without the reload that
 * `setLocale` would otherwise force.
 *
 * **The return type is deliberate.** `svelte/no-navigation-without-resolve` accepts an href whose
 * type is exactly `ResolvedPathname`, as well as a literal `resolve()` call, so wrapping a
 * `resolve()` here keeps every call site lint-clean instead of carrying a disable comment. The
 * cast is sound in the direction that matters: the input is already a resolved path, and
 * `localizeHref` only ever rewrites the first segment of one.
 */
import type { ResolvedPathname } from '$app/types';
import { localizeHref } from '$lib/paraglide/runtime';

export function localizedPath(path: ResolvedPathname): ResolvedPathname {
	const href = localizeHref(path);
	// **While prerendering**, `resolve()` hands back a RELATIVE path (`../../tutoring`) and Paraglide
	// resolves it against the prerenderer's own origin, so the written HTML said
	// `href="http://sveltekit-prerender/korki"` — on every prerendered page's Materials link and on
	// the manual's "Open this screen" links, live for anybody who clicked before hydration or read
	// the page without JS (found 2026-10-14 by reading `build/about/guide/tutoring.html`). An
	// absolute answer to a relative question is that, and the honest fallback is the canonical path,
	// which `hooks.ts` reroutes for either language; hydration then writes the localized one.
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(href) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
	return href as ResolvedPathname;
}
