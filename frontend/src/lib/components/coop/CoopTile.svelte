<script lang="ts">
	// 2donet's DashboardBox: an uppercase small title over a body slot, spanning `span` columns of
	// whatever grid it sits in. The grid is the caller's; this only knows how wide it is.
	import type { Snippet } from 'svelte';

	let { title, span = 1, children }: { title: string; span?: number; children: Snippet } = $props();
</script>

<section class="tile" style="--span: {span}">
	<h3 class="tile__title">{title}</h3>
	<div class="tile__body">{@render children()}</div>
</section>

<style lang="scss">
	.tile {
		grid-column: span var(--span);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: var(--bg-surface-alt);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		min-width: 0;
	}
	.tile__title {
		margin: 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-secondary);
	}
	.tile__body {
		font-size: var(--font-size-sm);
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	@media (max-width: 560px) {
		.tile {
			grid-column: span 1;
		}
	}
</style>
