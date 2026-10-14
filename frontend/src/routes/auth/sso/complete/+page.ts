// Never prerendered: this page exists only as the end of a provider round trip, reads its code or
// ticket from the address, and has nothing to paint before that. The SPA fallback serves it.
export const prerender = false;
