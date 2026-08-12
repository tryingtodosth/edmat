// Prerendered: the form itself is static markup — only its SUBMIT touches the API, and that
// happens long after hydration. Getting the fields into the initial HTML means someone can start
// typing before the bundle has finished loading. See src/routes/+page.ts.
export const prerender = true;
