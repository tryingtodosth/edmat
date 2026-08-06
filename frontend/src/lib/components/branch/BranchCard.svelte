<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Branch } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import PendingBadge from '$lib/components/shared/PendingBadge.svelte';
	import { isPending } from '$lib/utils/taxonomy';

	// Off inside an "Others" section, where the heading has already said it — see DisciplineCard.
	let {
		branch,
		exerciseCount,
		showPending = true
	}: { branch: Branch; exerciseCount: number; showPending?: boolean } = $props();
</script>

<a class="branch-card" href={resolve('/branches/[branch]', { branch: branch.id })}>
	<h3>{branch.name}</h3>
	{#if showPending && isPending(branch)}<PendingBadge />{/if}
	<p class="branch-card__description">{branch.description}</p>
	<span class="branch-card__count">{m.branch_exerciseCount({ count: exerciseCount })}</span>
</a>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.branch-card {
		@include mix.card-surface;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4);
		color: var(--text-primary);
		&:hover {
			border-color: var(--accent);
		}
	}
	.branch-card__description {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		flex: 1;
	}
	.branch-card__count {
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-weight: 600;
	}
</style>
