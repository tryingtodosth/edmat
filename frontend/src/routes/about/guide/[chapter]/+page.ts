// One prerendered page per chapter. The slugs are listed in `svelte.config.js`'s `prerender.entries`
// (under the `guide (H)` comment) rather than here, because that list is also what
// `deploy/fuw/pack.sh` is checked against — one place to read, not two.
//
// A dynamic segment rather than eleven directories: every chapter is the same page with different
// text, so eleven copies of one component would be eleven places to forget a change. An address
// that is not a chapter is not prerendered, falls through to the SPA shell, and the page says so.
export const prerender = true;
