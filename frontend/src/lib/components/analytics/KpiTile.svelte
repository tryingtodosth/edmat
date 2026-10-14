<script lang="ts">
	/** One headline number with its previous-period comparison. The comparison is plain text
	 *  ("up 12 % vs previous 30 days"), neutral in colour: whether up is good depends on the number
	 *  (more 5xx is bad, more registrations is not), and a tile should not pretend to know. */
	import type { Snippet } from 'svelte';
	interface Props {
		label: string;
		value: Snippet;
		comparison?: string;
		hint?: string;
	}
	let { label, value, comparison, hint }: Props = $props();
</script>

<div class="tile" title={hint}>
	<div class="label">{label}</div>
	<div class="value">{@render value()}</div>
	{#if comparison}<div class="cmp">{comparison}</div>{/if}
</div>

<style lang="scss">
	.tile {
		background: var(--bg-surface-alt);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		min-width: 0;
	}
	.label {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.value {
		font-size: var(--font-size-xl);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		margin: var(--space-1) 0;
	}
	.cmp {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
