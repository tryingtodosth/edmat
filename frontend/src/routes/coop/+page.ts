// Prerendered: the project's own page, `/coop` (the old `/about`, moved 2026-11-02). The head and
// the static blocks paint from HTML; the organisation body loads client-side after the SPA boots.
// deploy/fuw/pack.sh refuses a build in which coop.html is missing.
export const prerender = true;
