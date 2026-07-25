<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Field } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';

	let { field, courseCount }: { field: Field; courseCount: number } = $props();
</script>

<a class="field-card" href={resolve('/fields/[field]', { field: field.id })}>
	<h3>{field.name}</h3>
	<p>{field.description}</p>
	<span class="field-card__count">{m.field_courseCount({ count: courseCount })}</span>
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
