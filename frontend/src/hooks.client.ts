import type { HandleClientError } from '@sveltejs/kit';

// SvelteKit's client hook for an error thrown during a `load` or a render — the ones `window`'s
// `error` event sees only partly. It hands the error to the browser error reporter
// (`lib/errors/reporter.ts`, LINKING-AND-ERRORS.md §3.3), loaded on demand so that it costs the
// entry bundle one dynamic import. A 404 is a missing page, not a bug, and is not reported.
// Returning nothing keeps SvelteKit's own error object for the error page.
export const handleError: HandleClientError = ({ error, event, status }) => {
	if (status === 404) return;
	import('$lib/errors/reporter')
		.then((reporter) => reporter.report('sveltekit', error, undefined, event.route.id))
		.catch(() => {});
};
