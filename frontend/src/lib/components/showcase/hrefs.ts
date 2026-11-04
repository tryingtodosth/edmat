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
import type { ResolvedPathname } from '$app/types';
import type { ShowcaseLiveRoute, ShowcaseSlug } from '$lib/content/showcase';
import type { FeatureFlagKey } from '$lib/types';
import { localizedPath } from '$lib/utils/localizedPath';

export const SHOWCASE_HREF: Record<ShowcaseSlug, string> = {
	exercises: resolve('/about/exercises'),
	flashcards: resolve('/about/flashcards'),
	'learning-record': resolve('/about/learning-record'),
	courses: resolve('/about/courses'),
	schools: resolve('/about/schools'),
	concepts: resolve('/about/concepts'),
	events: resolve('/about/events'),
	contests: resolve('/about/contests'),
	'goals-and-work': resolve('/about/goals-and-work'),
	tutoring: resolve('/about/tutoring'),
	materials: resolve('/about/materials'),
	conference: resolve('/about/conference'),
	account: resolve('/about/account'),
	'licences-and-data': resolve('/about/licences-and-data')
};

/**
 * Every live page a showcase page may link to, with the kill switch it answers to (`null` for the
 * surfaces no switch can remove). The shell asks `flag` before drawing a link, with the same
 * moderator bypass `FeatureGate` and the backend have — so a killed feature's "Try it" link and
 * its screenshot's "Open the real page" both disappear, and no content file has to remember to
 * ask (house rule 3). `e2e/showcase.mjs` keeps an allowlist of the same routes.
 */
export interface ShowcaseLiveLink {
	href: ResolvedPathname;
	flag: FeatureFlagKey | null;
	/**
	 * `/tutoring` and `/materials` have a Polish address (`/korki`, `/materialy` — frontend/CLAUDE.md,
	 * "i18n"). The href stays canonical here and `liveHref()` localises it at the call site, because
	 * `localizedPath` is reactive and this module is evaluated once.
	 */
	localized?: boolean;
	/**
	 * A page that is only somebody's own: `/work` answers a signed-out visitor with an error rather
	 * than a sign-in prompt, so the link is drawn only for a signed-in reader.
	 */
	signedIn?: boolean;
	/**
	 * The mirror image: `/login` and `/register` are for somebody who is not signed in — a signed-in
	 * reader already has the account those pages would make or open, and "Create an account" would
	 * only offer them a second one. Drawn only for a signed-out reader.
	 */
	signedOut?: boolean;
}

export const SHOWCASE_LIVE: Record<ShowcaseLiveRoute, ShowcaseLiveLink> = {
	'/disciplines': { href: resolve('/disciplines'), flag: null },
	'/my-set': { href: resolve('/my-set'), flag: null },
	'/flashcards': { href: resolve('/flashcards'), flag: 'flashcards' },
	'/concepts': { href: resolve('/concepts'), flag: 'concepts' },
	'/contests': { href: resolve('/contests'), flag: 'contests' },
	'/courses': { href: resolve('/courses'), flag: 'courses' },
	'/events': { href: resolve('/events'), flag: 'events' },
	'/organizations': { href: resolve('/organizations'), flag: 'organizations' },
	'/settings': { href: resolve('/settings'), flag: 'learning_record' },
	// The four module pages (2026-10-14, WP5).
	'/coop': { href: resolve('/coop'), flag: 'organizations' },
	'/work': { href: resolve('/work'), flag: 'work_dashboard', signedIn: true },
	'/tasks': { href: resolve('/tasks'), flag: 'tasks' },
	'/needs': { href: resolve('/needs'), flag: 'needs' },
	'/tutoring': { href: resolve('/tutoring'), flag: 'tutoring', localized: true },
	'/bookings': { href: resolve('/bookings'), flag: 'tutoring' },
	'/materials': { href: resolve('/materials'), flag: null, localized: true },
	'/material-projects': { href: resolve('/material-projects'), flag: 'coauthoring' },
	'/conference': { href: resolve('/conference'), flag: 'events' },
	'/venues': { href: resolve('/venues'), flag: 'venues' },
	'/volunteering/hours': { href: resolve('/volunteering/hours'), flag: 'shifts' },
	// The account and licences pages (2026-10-15, WP6). None of these has a kill switch: signing up,
	// signing in, Settings, the terms and the privacy policy are always there. The two forms each
	// answer to their own submission switch. `/settings#account` is `/settings` itself — see
	// `ShowcaseLiveRoute` for why it has a key of its own.
	'/register': { href: resolve('/register'), flag: null, signedOut: true },
	'/login': { href: resolve('/login'), flag: null, signedOut: true },
	'/settings#account': { href: resolve('/settings'), flag: null },
	'/settings/account': { href: resolve('/settings/account'), flag: null },
	'/submit': { href: resolve('/submit'), flag: 'exercise_submissions' },
	'/submit-material': { href: resolve('/submit-material'), flag: 'material_submissions' },
	'/terms': { href: resolve('/terms'), flag: null },
	'/privacy': { href: resolve('/privacy'), flag: null }
};

/** The href to draw for a live route, in the reader's own address where it has one. Reactive
 *  when called from a template (`localizedPath` reads the locale rune). */
export function liveHref(route: ShowcaseLiveRoute): ResolvedPathname {
	const link = SHOWCASE_LIVE[route];
	return link.localized ? localizedPath(link.href) : link.href;
}

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
 * (`learning-record`, `schools`, `conference` — the first two the manual's own hub lists as not
 * written yet, the third because its subject's chapter already names `/about/events`) have no
 * entry and draw no link.
 */
export const SHOWCASE_GUIDE: Partial<Record<ShowcaseSlug, string>> = {
	exercises: resolve('/about/guide/[chapter]', { chapter: 'exercises' }),
	flashcards: resolve('/about/guide/[chapter]', { chapter: 'flashcards' }),
	courses: resolve('/about/guide/[chapter]', { chapter: 'courses' }),
	concepts: resolve('/about/guide/[chapter]', { chapter: 'concepts' }),
	events: resolve('/about/guide/[chapter]', { chapter: 'events' }),
	contests: resolve('/about/guide/[chapter]', { chapter: 'contests' }),
	// 2026-10-14: the three chapters that had no showcase page until now. `conference` has none —
	// the events chapter already points at `/about/events`, and one chapter names one page.
	'goals-and-work': resolve('/about/guide/[chapter]', { chapter: 'help' }),
	tutoring: resolve('/about/guide/[chapter]', { chapter: 'tutoring' }),
	materials: resolve('/about/guide/[chapter]', { chapter: 'submit' })
};
