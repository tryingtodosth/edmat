<script lang="ts">
	// "Waiting for review" — for a taxonomy node somebody has proposed but no moderator has agreed
	// to yet.
	//
	// The "Others" grouping on a browse page says this for a whole section, which is the right place
	// to say it when you are scanning a list. This says it about ONE node, for every other place a
	// node's name turns up on its own — a card seen out of that context, a branch page's own header
	// — where the grouping is not there to carry the meaning. Without it, a suggestion is
	// indistinguishable from settled vocabulary the moment you click into it.
	import { m } from '$lib/paraglide/messages.js';

	let { compact = false }: { compact?: boolean } = $props();
</script>

<span class="pending-badge" class:pending-badge--compact={compact}>
	{m.taxonomy_propose_pending()}
</span>

<style lang="scss">
	.pending-badge {
		display: inline-block;
		align-self: flex-start;
		padding: 0.1rem 0.45rem;
		border: 1px dashed var(--border);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		font-weight: 600;
		/* Muted rather than a warning colour: nothing is wrong, it just is not settled yet. */
		color: var(--text-muted);
		background: var(--surface-2);
		white-space: nowrap;
	}
	.pending-badge--compact {
		padding: 0 0.3rem;
		font-weight: 500;
	}
</style>
