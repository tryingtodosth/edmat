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
	return localizeHref(path) as ResolvedPathname;
}
