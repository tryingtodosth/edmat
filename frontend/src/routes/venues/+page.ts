// Prerendered: the heading, the intro and the empty/loading states are static text and paint from
// the HTML itself; the list of buildings is still fetched client-side after hydration (in
// `onMount`), so nothing here bakes a stale snapshot in. The `[slug]` pages below are NOT
// prerendered — there is no list of slugs at build time.
export const prerender = true;
