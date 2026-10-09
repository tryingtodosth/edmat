// The eight showcase routes, resolved once.
//
// `resolve()` is per-route and typed, so a loop over `SHOWCASE_PAGES` cannot call it with a slug —
// this record is the bridge, and it is the reason a renamed route breaks the BUILD rather than
// producing a dead link: every entry below is checked against the real route tree.
//
// Two readers: the index section mounted on `/about` and the "other pages" footer every showcase
// page carries. `svelte/no-navigation-without-resolve` cannot see through the lookup, so both call
// sites carry a disable comment naming this file.
import { resolve } from '$app/paths';
import type { ShowcaseSlug } from '$lib/content/showcase';

export const SHOWCASE_HREF: Record<ShowcaseSlug, string> = {
	exercises: resolve('/about/exercises'),
	flashcards: resolve('/about/flashcards'),
	'learning-record': resolve('/about/learning-record'),
	courses: resolve('/about/courses'),
	schools: resolve('/about/schools'),
	concepts: resolve('/about/concepts'),
	events: resolve('/about/events'),
	contests: resolve('/about/contests')
};
