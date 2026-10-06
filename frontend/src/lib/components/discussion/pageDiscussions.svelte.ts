// One policy request per standing page, shared by every section on it.
//
// The alternative — each `<DiscussableSection>` fetching its own — would fire a dozen requests on a
// manual chapter before a reader had clicked anything, which is the N+1 the backend's
// `DiscussionPolicyView` was shaped to avoid. So the PAGE owns the fetch and the sections read from
// a context.
//
// A context rather than a module-level store on purpose: two pages never render at once, but a
// module store would survive a client-side navigation and hand the next page the previous page's
// policies for a moment — the kind of staleness that shows a reader a thread that belongs to
// another page. A context dies with the component that set it.
import { getContext, setContext } from 'svelte';
import { policiesForPage } from '$lib/services/discussions';
import type { DiscussionPolicy } from '$lib/types/discussion';

const KEY = Symbol('page-discussions');

export interface PageDiscussions {
	readonly page: string;
	/** Keyed by section, `''` for the page's own. Empty until the request lands, and empty forever
	 *  if it fails — a page of prose must render whether or not its discussions load. */
	readonly bySection: Record<string, DiscussionPolicy>;
}

class PageDiscussionsState implements PageDiscussions {
	page = $state('');
	bySection = $state<Record<string, DiscussionPolicy>>({});

	/** Idempotent per page, so the caller's `$effect` can re-run freely — which it does, on every
	 *  unrelated state change in the subtree (`frontend/CLAUDE.md` trap 2). */
	load(page: string, sections: string[]) {
		if (page === this.page) return;
		this.page = page;
		this.bySection = {};
		// Fire and forget, and the failure is swallowed deliberately: there is nothing sensible to
		// show a reader of `/about` about a policy request that did not come back, and the page's
		// own content does not depend on it. The sections then render nothing at all — the same
		// thing they render when the feature is off.
		policiesForPage(page, sections)
			.then((map) => {
				if (this.page === page) this.bySection = map;
			})
			.catch(() => {
				if (this.page === page) this.bySection = {};
			});
	}
}

/**
 * Sets the context and hands the state back. Called once, during the page's or its shell's init —
 * `setContext` may only run then — and the CALLER drives `load()` from an `$effect`, so the page
 * key and section list are read reactively rather than captured at init.
 *
 * That split is not ceremony. `ShowcasePage` is one component behind seven routes; reading its
 * `slug` prop at init would have pinned the first showcase page a reader opened and answered with
 * its policies on every one after it. `svelte-check`'s `state_referenced_locally` warning said so
 * before any reader could.
 */
export function providePageDiscussions(): PageDiscussionsState {
	const state = new PageDiscussionsState();
	setContext(KEY, state);
	return state;
}

/** `undefined` when no ancestor provided one — a section used outside a standing page, which draws
 *  no discussion rather than throwing. */
export function usePageDiscussions(): PageDiscussions | undefined {
	return getContext<PageDiscussions | undefined>(KEY);
}
