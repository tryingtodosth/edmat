<script lang="ts">
	// The full list behind MaterialCard's "+N more" count. That count was previously a dead `<span>`:
	// the card deliberately shows only the top few claims of each group (see MaterialCard's own note
	// on why — a material with 30+ coverage claims used to flood every card in a grid), but it named
	// a number the reader then had no way whatsoever to act on from the list view. The full, sortable,
	// votable treatment still lives on the material's own detail page; this is the read-and-drill-down
	// version of it, reachable without leaving the grid.
	//
	// One component for both groups rather than two near-identical ones, since the only real
	// difference is what a row IS: a coverage claim is its own discussable, votable object (so rows
	// reuse CoverageBadge — the exact badge the detail page already renders the full list with, and
	// clicking one opens the same CoveragePopover a card chip does), while a requirement is a plain
	// free-text label with no per-claim page behind it, so its rows are text. Voting stays off this
	// modal entirely, on purpose: the card is a summary surface, and duplicating the vote widget here
	// would be a second place for the same claim's tally to drift out of step.
	import type { MaterialCoverage, MaterialRequirement } from '$lib/types';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import CoverageBadge from './CoverageBadge.svelte';

	let {
		title,
		coverage,
		requirements,
		onSelectCoverage,
		onClose
	}: {
		title: string;
		// Exactly one of these is passed per render — which one is what the caller's own "+N more"
		// button was counting.
		coverage?: MaterialCoverage[];
		requirements?: MaterialRequirement[];
		onSelectCoverage?: (id: string) => void;
		onClose: () => void;
	} = $props();
</script>

<ModalShell {title} {onClose}>
	{#if coverage}
		<div class="claim-list claim-list--badges">
			{#each coverage as item (item.id)}
				<CoverageBadge coverage={item} onclick={() => onSelectCoverage?.(item.id)} />
			{/each}
		</div>
	{:else if requirements}
		<ul class="claim-list claim-list--rows">
			{#each requirements as item (item.id)}
				<li class="claim-row">{item.label}</li>
			{/each}
		</ul>
	{/if}
</ModalShell>

<style lang="scss">
	.claim-list--badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.claim-list--rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.claim-row {
		font-size: var(--font-size-sm);
		color: var(--text-primary);
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--border-color);
		&:last-child {
			border-bottom: none;
		}
	}
</style>
