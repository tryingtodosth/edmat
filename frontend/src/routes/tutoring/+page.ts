// Prerendered: this page's chrome (header, heading, filters, empty/loading states) is static text
// and paints from the HTML itself; the data it lists is still fetched client-side after hydration,
// so nothing here bakes a stale snapshot in. Measured before this: the SPA fallback shell paints
// NOTHING until the whole module graph has booted — see routes/+page.ts for the same reasoning.
export const prerender = true;
