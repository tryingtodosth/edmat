<script lang="ts">
	/**
	 * A section of a standing page with its own quiet discussion underneath.
	 *
	 * Wraps the section rather than being dropped beside it, so that the heading the collapsed line
	 * names is the heading right above it and the two cannot drift apart. The policy comes from the
	 * page's context (`pageDiscussions.svelte.ts`), so adding one of these to a page costs no extra
	 * request — but the page must list the section's key, which is the same division the backend
	 * module settles on: the frontend declares what it draws.
	 *
	 * Renders its children unchanged and adds nothing when there is no policy for this key, when
	 * the location is off, or when the request has not landed yet. A page of prose reads the same
	 * either way.
	 */
	import type { Snippet } from 'svelte';
	import SectionDiscussion from './SectionDiscussion.svelte';
	import { usePageDiscussions } from './pageDiscussions.svelte';

	let {
		sectionKey,
		/** The section's own heading, for the collapsed line's accessible name. */
		title,
		children
	}: {
		sectionKey: string;
		title: string;
		children: Snippet;
	} = $props();

	const discussions = usePageDiscussions();
	const policy = $derived(discussions?.bySection[sectionKey]);
</script>

{@render children()}
{#if policy}
	<SectionDiscussion {policy} sectionTitle={title} />
{/if}
