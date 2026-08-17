// Prerendered at build time — see the sibling +page.ts files on /levels, /privacy, /login and
// /register, and svelte.config.js's own note about why the rest of the app is not.
//
// This is the page PageSpeed actually measures, and until now it was the same 391-byte empty
// shell every other URL got: nothing could paint until 43 module chunks had downloaded and run,
// so FCP and LCP were both gated on hydration. The hero <h1> that is the LCP element here is
// static text, so prerendering moves it into the initial HTML response and LCP collapses to
// roughly the cost of delivering that HTML.
//
// The page's own data (the five tabs) still loads client-side in onMount exactly as before —
// prerendering does not and cannot bake API data in, and deliberately so: a build-time snapshot
// of "top rated exercises" would be stale the moment it shipped. What prerendering fixes is the
// shell around it, which is the part that was blank.
export const prerender = true;
