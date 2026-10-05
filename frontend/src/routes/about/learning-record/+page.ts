// Prerendered: static prose and sample data from `lib/content/showcase/learningRecord.ts`,
// with no API call of any kind. Like `/about` itself (see its `+page.ts`), this is a page a
// first-time visitor can arrive on from a shared link, so it should paint from HTML rather than
// wait for the SPA to boot. `svelte.config.js` lists it by name; the integrator adds it to
// `deploy/fuw/pack.sh`'s prerender guard.
export const prerender = true;
