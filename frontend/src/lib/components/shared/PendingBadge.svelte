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
	@use '../../styles/mixins' as mix;

	.pending-badge {
		display: inline-block;
		align-self: flex-start;
		/* The "not settled yet, nothing is wrong" voice, now the site-wide `pending-pill` mixin
		   (2026-10-07 colour pass) — this badge's own reasoning, promoted: the neutral pair with a
		   dashed border in the same neutral. An earlier draft here invented `--surface-2`/
		   `--text-muted`, which did not exist, so the badge rendered as bare bold text; the mixin is
		   the single source now, so that cannot happen twice. */
		@include mix.pending-pill;
		padding: 0.1rem 0.45rem;
		white-space: nowrap;
	}
	.pending-badge--compact {
		padding: 0 0.3rem;
		font-weight: 500;
	}
</style>
