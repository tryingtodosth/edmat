<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Audience, Discipline } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import PendingBadge from '$lib/components/shared/PendingBadge.svelte';
	import NodeCountsLine from '$lib/components/shared/NodeCountsLine.svelte';
	import { isPending } from '$lib/utils/taxonomy';

	// `showPending` is off when the card already sits inside an "Others" section — that heading and
	// its hint have just said the same thing, and saying it twice in one glance is noise. It stays
	// on everywhere else, which is every context where the grouping is not there to carry it.
	//
	// `folded`: the card sits under "For other groups" — nothing in it for the reader's lens. It is
	// drawn quieter and its counts say which groups it IS for (NodeCountsLine).
	let {
		discipline,
		branchCount,
		bands,
		folded = false,
		showPending = true
	}: {
		discipline: Discipline;
		branchCount: number;
		bands: Audience[];
		folded?: boolean;
		showPending?: boolean;
	} = $props();
</script>

<a
	class="discipline-card"
	class:discipline-card--folded={folded}
	data-testid="discipline-card"
	href={resolve('/disciplines/[discipline]', { discipline: discipline.id })}
>
	<h3>{discipline.name}</h3>
	{#if showPending && isPending(discipline)}<PendingBadge />{/if}
	<p>{discipline.description}</p>
	<NodeCountsLine counts={discipline.counts} {bands} {folded} />
	<span class="discipline-card__branches">{m.discipline_branchCount({ count: branchCount })}</span>
	<!-- "Branches: {count}" -->
</a>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.discipline-card {
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
	// Quieter, never translucent (frontend/CLAUDE.md: no opacity on content) — a dashed edge and a
	// secondary-coloured title, the same "not for you right now" shape a closed row gets.
	.discipline-card--folded {
		border-style: dashed;
		h3 {
			color: var(--text-secondary);
		}
	}
	p {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.discipline-card__branches {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
