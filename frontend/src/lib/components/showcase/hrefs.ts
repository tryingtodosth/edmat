// The showcase's own routes, and the live pages it sends readers to, resolved once.
//
// `resolve()` is per-route and typed, so a loop over `SHOWCASE_PAGES` cannot call it with a slug —
// these records are the bridge, and they are the reason a renamed route breaks the BUILD rather
// than producing a dead link: every entry below is checked against the real route tree.
//
// Readers: the index section mounted on `/about`, the "other pages" footer, the "Try it yourself"
// row and the manual link every showcase page carries, and `ShowcaseShot`'s "Open the real page".
// `svelte/no-navigation-without-resolve` cannot see through the lookup, so each call site carries
// a disable comment naming this file.
import { resolve } from '$app/paths';
import type { ShowcaseLiveRoute, ShowcaseSlug } from '$lib/content/showcase';
import type { FeatureFlagKey } from '$lib/types';

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

/**
 * Every live page a showcase page may link to, with the kill switch it answers to (`null` for the
 * surfaces no switch can remove). The shell asks `flag` before drawing a link, with the same
 * moderator bypass `FeatureGate` and the backend have — so a killed feature's "Try it" link and
 * its screenshot's "Open the real page" both disappear, and no content file has to remember to
 * ask (house rule 3). `e2e/showcase.mjs` keeps an allowlist of the same routes.
 */
export const SHOWCASE_LIVE: Record<
	ShowcaseLiveRoute,
	{ href: string; flag: FeatureFlagKey | null }
> = {
	'/disciplines': { href: resolve('/disciplines'), flag: null },
	'/my-set': { href: resolve('/my-set'), flag: null },
	'/flashcards': { href: resolve('/flashcards'), flag: 'flashcards' },
	'/concepts': { href: resolve('/concepts'), flag: 'concepts' },
	'/contests': { href: resolve('/contests'), flag: 'contests' },
	'/courses': { href: resolve('/courses'), flag: 'courses' },
	'/events': { href: resolve('/events'), flag: 'events' },
	'/organizations': { href: resolve('/organizations'), flag: 'organizations' },
	'/settings': { href: resolve('/settings'), flag: 'learning_record' }
};

/**
 * The manual chapter that describes the same thing as each showcase page — the inverse of
 * `lib/content/guide/index.ts: GUIDE_CHAPTERS[].showcase`.
 *
 * **Kept by hand rather than computed from `GUIDE_CHAPTERS`, on purpose**: that module imports
 * every chapter's full text (~125 KB of prose), and importing it here would put all of it into the
 * bundle of every showcase page for the sake of one link — `EmptyState.svelte` declined the same
 * import for the same reason. Drift is caught by running it, not by trust: `e2e/showcase.mjs`
 * opens every chapter of the manual, reads which showcase page it links to, and fails unless this
 * map says exactly the same thing in the other direction. Pages no chapter illustrates
 * (`learning-record`, `schools` — the manual's own hub lists them as not written yet) have no
 * entry and draw no link.
 */
export const SHOWCASE_GUIDE: Partial<Record<ShowcaseSlug, string>> = {
	exercises: resolve('/about/guide/[chapter]', { chapter: 'exercises' }),
	flashcards: resolve('/about/guide/[chapter]', { chapter: 'flashcards' }),
	courses: resolve('/about/guide/[chapter]', { chapter: 'courses' }),
	concepts: resolve('/about/guide/[chapter]', { chapter: 'concepts' }),
	events: resolve('/about/guide/[chapter]', { chapter: 'events' }),
	contests: resolve('/about/guide/[chapter]', { chapter: 'contests' })
};
