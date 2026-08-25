<script lang="ts">
	// The full list behind MaterialCard's "+N more" count. The card deliberately shows only the top
	// few claims of each group (a material with 30+ claims used to flood every card in a grid), but
	// it named a number the reader then had no way to act on. This is the read-and-drill-down
	// version, reachable without leaving the grid; voting stays off it on purpose — the card is a
	// summary surface, and a second vote widget here would be a second place for one claim's tally
	// to drift. Both groups are the same kind of row now (a claim with a popover behind it), so one
	// list serves both; the caller passes whichever group its own button was counting.
	import type { MaterialCoverage } from '$lib/types';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import CoverageBadge from './CoverageBadge.svelte';

	let {
		title,
		claims,
		onSelect,
		onClose
	}: {
		title: string;
		claims: MaterialCoverage[];
		onSelect: (id: string) => void;
		onClose: () => void;
	} = $props();
</script>

<ModalShell {title} {onClose}>
	<div class="claim-list">
		{#each claims as item (item.id)}
			<CoverageBadge coverage={item} onclick={() => onSelect(item.id)} />
		{/each}
	</div>
</ModalShell>

<style lang="scss">
	.claim-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
</style>
