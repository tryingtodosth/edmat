<script lang="ts">
	/**
	 * One discussion for a whole standing page, at the location whose section is `''`.
	 *
	 * For a page that wants a single thread at the bottom rather than one per section — the manual's
	 * hub and its chapters, which are step lists where a thread per step would be noise. It fetches
	 * its own policy instead of reading the page context, which is the right trade at one thread per
	 * page: it is the same single request the context would have made, and it can be REACTIVE on the
	 * page key. That matters for `/about/guide/[chapter]`, where `slug` is `$derived` and SvelteKit
	 * reuses this component across chapters — a context provided once at init would keep answering
	 * with the first chapter's policy for every chapter after it.
	 *
	 * The `''` section is both the page's own thread and the ceiling over its sections
	 * (`backend/community/discussions.py: effective_policy`). That is deliberate rather than a
	 * collision: a moderator narrowing the page narrows its own thread too, which is what anybody
	 * would expect of "close discussion on this chapter".
	 */
	import { policiesForPage } from '$lib/services/discussions';
	import type { DiscussionPolicy } from '$lib/types/discussion';
	import SectionDiscussion from './SectionDiscussion.svelte';

	let {
		page,
		/** The page's own heading, for the collapsed line's accessible name. */
		title
	}: {
		page: string;
		title: string;
	} = $props();

	let policy = $state<DiscussionPolicy | undefined>();
	// Guarded against re-firing with no navigation, the trap `frontend/CLAUDE.md` lists second: an
	// `$effect` reading a derived prop re-runs on every unrelated state change in this subtree, and
	// without the guard that is one request per keystroke in the composer below it.
	let loadedFor = $state('');

	$effect(() => {
		const wanted = page;
		if (wanted === loadedFor) return;
		loadedFor = wanted;
		policy = undefined;
		policiesForPage(wanted, [])
			.then((map) => {
				// Only accept the answer if the page has not changed underneath it — a reader
				// clicking quickly through chapters can have two of these in flight.
				if (loadedFor === wanted) policy = map[''];
			})
			.catch(() => {
				if (loadedFor === wanted) policy = undefined;
			});
	});
</script>

{#if policy}
	<SectionDiscussion {policy} sectionTitle={title} />
{/if}
