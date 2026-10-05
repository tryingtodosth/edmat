// Prerendered: static prose and sample data from `lib/content/showcase/flashcards.ts`,
// with no API call of any kind. Like `/about` itself (see its `+page.ts`), this is a page a
// first-time visitor can arrive on from a shared link, so it should paint from HTML rather than
// wait for the SPA to boot. `svelte.config.js` lists it by name; the integrator adds it to
// `deploy/fuw/pack.sh`'s prerender guard.
// The samples carry real LaTeX, so the root layout's server-side `loadMath()` is what makes
// the prerendered file ship typeset KaTeX rather than raw source.
export const prerender = true;
