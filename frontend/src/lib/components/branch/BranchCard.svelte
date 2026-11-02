<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Audience, Branch } from '$lib/types';
	import PendingBadge from '$lib/components/shared/PendingBadge.svelte';
	import NodeCountsLine from '$lib/components/shared/NodeCountsLine.svelte';
	import { isPending } from '$lib/utils/taxonomy';

	// Off inside an "Others" section, where the heading has already said it — see DisciplineCard,
	// which also explains `folded`.
	let {
		branch,
		bands,
		folded = false,
		showPending = true
	}: { branch: Branch; bands: Audience[]; folded?: boolean; showPending?: boolean } = $props();
</script>

<a
	class="branch-card"
	class:branch-card--folded={folded}
	data-testid="branch-card"
	href={resolve('/branches/[branch]', { branch: branch.id })}
>
	<h3>{branch.name}</h3>
	{#if showPending && isPending(branch)}<PendingBadge />{/if}
	<p class="branch-card__description">{branch.description}</p>
	<NodeCountsLine counts={branch.counts} {bands} {folded} />
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
	.branch-card--folded {
		border-style: dashed;
		h3 {
			color: var(--text-secondary);
		}
	}
	.branch-card__description {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		flex: 1;
	}
</style>
