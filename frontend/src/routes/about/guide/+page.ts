// Prerendered: the manual's hub is static prose from `lib/content/guide/`, with no API call at
// all — the only thing it reads at runtime is the feature-flag store, and that is a hydration-time
// nicety, not data the page needs to paint. See `src/routes/about/+page.ts` for the same reasoning.
// `deploy/fuw/pack.sh` should refuse a build in which `about/guide.html` is missing.
export const prerender = true;
