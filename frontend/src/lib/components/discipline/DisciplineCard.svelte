<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Discipline } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import PendingBadge from '$lib/components/shared/PendingBadge.svelte';
	import { isPending } from '$lib/utils/taxonomy';

	let { field, courseCount }: { field: Discipline; courseCount: number } = $props();
</script>

<a class="field-card" href={resolve('/disciplines/[discipline]', { discipline: field.id })}>
	<h3>{field.name}</h3>
	{#if isPending(field)}<PendingBadge />{/if}
	<p>{field.description}</p>
	<span class="field-card__count">{m.discipline_branchCount({ count: courseCount })}</span>
</a>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.field-card {
		@include mix.card-surface;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		color: var(--text-primary);
		&:hover {
			border-color: var(--accent);
		}
	}
	p {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.field-card__count {
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-weight: 600;
	}
</style>
