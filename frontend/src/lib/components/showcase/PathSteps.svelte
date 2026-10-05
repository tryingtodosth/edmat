<script lang="ts">
	/**
	 * A prerequisite path: concepts the reader should know first, nearest hop first, each with how
	 * many steps back it is from where they started.
	 *
	 * A twin rather than step D's own component, for one reason: on a real concept page every title
	 * is resolved per reader (their audience band, their languages) by an endpoint, and there is
	 * nothing here to resolve. The ordering is the real one — by distance, then by title — so the
	 * sample reads in the order the closure returns.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import type { ShowcasePathStep } from '$lib/content/showcase/concepts';

	let { steps, start }: { steps: ShowcasePathStep[]; start: string } = $props();
</script>

<div class="path">
	<ol>
		{#each steps as step (step.title)}
			<li>
				<span class="path__distance" title={m.showcase_pathDistance({ n: step.distance })}>
					{step.distance}
				</span>
				<span class="path__title"><MathTitle text={step.title} /></span>
				{#if step.note}
					<span class="path__note">{step.note}</span>
				{/if}
			</li>
		{/each}
	</ol>
	<p class="path__legend">{m.showcase_pathLegend({ start })}</p>
	<!-- "The number on each row is how many steps back from {start} that concept is." -->
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.path {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
	}
	.path__distance {
		@include mix.status-pill(var(--accent), var(--accent-soft));
		font-size: var(--font-size-xs);
		font-weight: 700;
		min-width: 2rem;
		text-align: center;
		flex: 0 0 auto;
	}
	.path__title {
		flex: 1 1 12rem;
	}
	.path__note {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.path__legend {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
