<script lang="ts">
	/**
	 * The collapsed discussion line under one management row — a task card, a plan row, a need
	 * row, a poll — fed by the panel's `RowDiscussions` rather than fetching its own policy.
	 *
	 * A wrapper rather than `SectionDiscussion` dropped into five places, because the five hosts
	 * are laid out five ways (a grid, a wrapping flex row, a card) and the one thing this has to do
	 * in each is take a full line of its own. Draws nothing while the policy has not arrived and
	 * nothing when the location is off — `SectionDiscussion` already keeps house rule 3 for the
	 * second case, and the first is why `policy` is optional.
	 */
	import SectionDiscussion from './SectionDiscussion.svelte';
	import type { DiscussionPolicy } from '$lib/types/discussion';

	let {
		policy,
		/** The row's own heading, for the collapsed line's accessible name. */
		title
	}: {
		policy: DiscussionPolicy | undefined;
		title: string;
	} = $props();
</script>

{#if policy}
	<div class="row-discussion">
		<SectionDiscussion {policy} sectionTitle={title} />
	</div>
{/if}

<style lang="scss">
	// A full line of its own in every host: a grid row spans every column, a wrapping flex row
	// gets a child that forces the wrap.
	.row-discussion {
		grid-column: 1 / -1;
		flex-basis: 100%;
		width: 100%;
		min-width: 0;
	}
</style>
