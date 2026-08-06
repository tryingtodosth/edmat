<script lang="ts">
	// "Three of these were not here last time." Shown above a list that merged fresh rows into the
	// saved copy the reader already had (`cachedList.svelte.ts`).
	//
	// It exists because the merge deliberately puts new rows at the TOP rather than re-sorting: that
	// answers "what appeared since I last looked", but only if something says so — otherwise the
	// order looks arbitrary, since it matches neither the name nor the date the list is nominally
	// sorted by.
	//
	// The count is rendered after a colon rather than inside the sentence on purpose. "{n} new
	// items" needs three different endings in Polish (1 nowy / 2-4 nowe / 5+ nowych), and a single
	// interpolated form would be wrong for most values; a label plus a number is correct for every
	// count in both locales.
	import { m } from '$lib/paraglide/messages.js';

	let { count }: { count: number } = $props();
</script>

{#if count > 0}
	<p class="new-since" role="status">
		{m.list_newSince()}: <strong>{count}</strong>
	</p>
{/if}

<style lang="scss">
	.new-since {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		padding: var(--space-2) var(--space-3);
		border-left: 3px solid var(--accent);
		background: var(--surface-2, transparent);
		border-radius: var(--radius-sm, 4px);
	}
	strong {
		color: var(--text-primary);
	}
</style>
