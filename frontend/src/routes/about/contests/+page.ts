// Prerendered: static prose and sample data from `lib/content/showcase/contests.ts`, with no API
// call of any kind. Like the other seven showcase pages (see `about/events/+page.ts`), this is a
// page a first-time visitor can arrive on from a shared link — and this one more than most, because
// it is what somebody sends to a colleague who asked whether running a contest here is legal. It
// should paint from HTML rather than wait for the SPA to boot. `svelte.config.js` lists it by name;
// the integrator adds it to `deploy/fuw/pack.sh`'s prerender guard.
export const prerender = true;
