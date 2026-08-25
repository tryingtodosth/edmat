// The door to renderContent.ts (KaTeX + markdown-it + DOMPurify, ~380 KB of JavaScript) — reached
// through a dynamic import so that code is its own chunk, fetched only when a MathTitle or
// MathContent actually mounts, instead of being parsed by every page as part of the app entry.
//
// Two callers, two timings:
//   - On the server (prerendering), the root layout's `load` awaits `loadMath()` before any page
//     renders, so `mathModule()` is non-null and every component typesets synchronously — the
//     prerendered HTML carries real KaTeX, and the KaTeX stylesheet is still linked from the
//     layout, so it never paints unstyled.
//   - In the browser the components render from `mathModule()` if the chunk is already here, and
//     otherwise show the plain source text and start `loadMath()`; the next update typesets it.
//     On a hydrated page the plain-text moment never shows: Svelte keeps the server-rendered
//     `{@html}` nodes on hydration and only swaps them once the value genuinely changes.
import type { renderContent, renderTitle } from './renderContent';

export interface MathModule {
	renderContent: typeof renderContent;
	renderTitle: typeof renderTitle;
}

let loaded: MathModule | null = null;
let pending: Promise<MathModule> | null = null;

export function loadMath(): Promise<MathModule> {
	pending ??= import('./renderContent').then((m) => (loaded = m));
	return pending;
}

/** The module if it has already arrived, else null — never blocks. */
export function mathModule(): MathModule | null {
	return loaded;
}

/** What to show for a math-bearing string before the typesetter has arrived: the raw source,
 * escaped. A title's `\(x^2\)` reads as exactly that for a fraction of a second, which is honest
 * and never a script. */
export function plainText(source: string | undefined | null): string {
	return String(source ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}
