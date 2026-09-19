import { m } from '$lib/paraglide/messages.js';

/**
 * The one place a browser tab's name is shaped.
 *
 * Every tab starts with the app's own name — `EdMat: Materials`, `EdMat: Analiza Matematyczna II` —
 * rather than ending with it. A tab strip gives a page perhaps a dozen characters before it
 * truncates, and with the name last those characters are spent on whichever route the person is on
 * while the answer to "which of these tabs is the one I want" is the part that gets cut. With it
 * first, a row of EdMat tabs is recognisable at a glance and still distinguishable by whatever of
 * the page's own name survives. The same reason a bookmark list and a browser history search read
 * better this way.
 *
 * Passing nothing (or a value that is not there yet — a detail page whose record is still loading)
 * gives the bare app name rather than a stray colon with nothing after it.
 */
export function pageTitle(part?: string | null): string {
	const app = m.common_appName();
	return part ? `${app}: ${part}` : app;
}
