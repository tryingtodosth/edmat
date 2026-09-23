// Prerendered: this page's chrome (header, heading, search box, letter strip, filters, empty and
// loading states) is static text and paints from the HTML itself; the concepts it lists are still
// fetched client-side after hydration, so nothing here bakes a stale snapshot in. See
// src/routes/+page.ts for the measurement behind this.
//
// The filters live in the URL's query string, which a prerendered page may NOT read while it is
// being rendered (`url.searchParams` throws there — that is what keeps /search off this list). The
// page therefore reads them inside an `$effect`, which never runs on the server.
export const prerender = true;
