<script lang="ts">
	// "N of these are new since you last looked" — the counterpart to the per-row fade that
	// `cachedList` (lib/state/cachedList.svelte.ts) computes.
	//
	// It exists because the merge is deliberately quiet: new rows are prepended in place rather than
	// the list blinking and re-sorting, which is right for not losing the reader's place and wrong
	// for telling them anything happened. One line above the list is the whole disclosure.
	//
	// Renders nothing at all when nothing is new, which is the normal case and should cost no space
	// and no attention — the same restraint MaterialCard already applies to a price it does not have.
	// It is also never shown on a first visit: `mergeRows` only counts a row as new when there was a
	// previous list to be new *against*, so an opening visit says nothing rather than announcing
	// every row as an arrival, which would be loudest on the one visit where it means least.
	//
	// NOTE FOR WHOEVER MERGES THIS: a parallel session was building a component at this same path
	// while this was written. Same name on purpose — these are one component, and an add/add
	// conflict here is a visible prompt to reconcile them rather than two copies drifting apart.
	import { m } from '$lib/paraglide/messages.js';

	let { count }: { count: number } = $props();
</script>

{#if count > 0}
	<p class="new-since" role="status">
		{m.common_newSinceLastVisit({ count: String(count) })}
	</p>
{/if}

<style lang="scss">
	.new-since {
		/* Informational, not a warning: something arrived, nothing is wrong. */
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin-bottom: var(--space-2);
	}
</style>
