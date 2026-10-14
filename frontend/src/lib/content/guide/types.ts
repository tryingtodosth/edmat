/**
 * The shapes the user manual at `/about/guide` is written in.
 *
 * The manual is **one piece of writing per chapter, in both languages, in one file** — the same
 * deliberate exception to "every string is a message key" that `content/privacy.ts`,
 * `content/levels.ts`, `content/legal.ts` and `content/about.ts` already take, and for the same
 * reason: a reviewer cannot tell whether the Polish version still says what the English one does
 * when the two are scattered across sixty catalogue keys. Only the page's *chrome* — "Chapter 3 of
 * 11", "Back to the manual", "Not written yet" — lives in `messages/{en,pl}.json` under the
 * `guide_` prefix.
 *
 * **The pictures are of the English interface, one set only** (`frontend/e2e/guide-screenshots.mjs`
 * takes them). A Polish reader gets Polish text describing the same screens. A second set would
 * double `static/guide/`, which `npm run build` copies verbatim into the deploy bundle, and a
 * reader who can see which button is which does not need the button's label in their own language
 * as well. The cost is named rather than paid: `HISTORY.md` §17BR.H.
 */

import type { PathnameWithSearchOrHash } from '$app/types';
import type { FeatureFlagKey } from '$lib/types';

/** A picture of the real app, taken by `e2e/guide-screenshots.mjs`. */
export interface GuideScreenshot {
	/** Path under `static/`, e.g. `/guide/exercises/03-exercise.png`. */
	src: string;
	/** What the picture shows, in this chapter's language. Never empty. */
	alt: string;
}

/** One thing a reader does, with the screen it happens on. */
export interface GuideStep {
	heading: string;
	/** One or more paragraphs. Plain text — no Markdown, no HTML, nothing to sanitize. */
	body: string[];
	screenshot?: GuideScreenshot;
	/**
	 * The real screen this step describes, drawn as "Open this screen →" under the step so a reader
	 * can go and try it. Typed as SvelteKit's own `PathnameWithSearchOrHash`, so an address that is
	 * not a route of this app is a TYPE error, not a broken link somebody finds later; the chapter
	 * page passes it through `resolve()` and `localizedPath()` (so `/tutoring` becomes `/korki` for a
	 * Polish reader). Only addresses that exist on every deployment: a hub, a form, a corpus slug —
	 * never a numeric id from the development database. `e2e/guide-try-links.mjs` opens every one.
	 */
	tryHref?: PathnameWithSearchOrHash;
	/**
	 * The kill switch for `tryHref` when it is not the chapter's own (the help chapter's offers board
	 * answers to `volunteering`, not `needs`). Off, the link is not drawn — house rule 3, for a page
	 * that is otherwise only writing. Without it the chapter's `flag` decides.
	 */
	tryFlag?: FeatureFlagKey;
	/** Who the link is for: `guests` hides it once signed in (registering), `members` shows it only
	 *  to somebody signed in (a form that founds something), `moderators` only to people who have
	 *  the moderation page at all. Absent, it is for everybody. */
	tryFor?: 'guests' | 'members' | 'moderators';
}

/** A chapter, in one language. */
export interface GuideChapterDoc {
	title: string;
	/** One or two sentences under the chapter title, before the first step. */
	lead: string[];
	steps: GuideStep[];
	/** An honest closing note: what this chapter does not cover, and where that is written down. */
	note?: string;
}
