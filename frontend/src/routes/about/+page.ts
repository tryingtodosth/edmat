// Prerendered: the landing page is static prose (lib/content/about.ts) with no API call at all, and
// it is exactly the page a first-time visitor arrives on from a shared link — so it should paint
// from HTML rather than wait for the SPA to boot. See src/routes/+page.ts for the reasoning.
// deploy/fuw/pack.sh refuses a build in which about.html is missing.
export const prerender = true;
