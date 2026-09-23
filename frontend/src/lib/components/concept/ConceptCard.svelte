<script lang="ts">
	/**
	 * One concept in a list — the hub, search, the homepage tab.
	 *
	 * The title and summary are the RESOLVED page's, not "the concept's": a concept has no title of
	 * its own, only articles that do. `isFallback` is the honest mark that goes with that — the row
	 * a reader is shown may be the university article when they asked for the primary one, and
	 * saying so on the card is cheaper than finding out after the click.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import AudienceBadge from '$lib/components/shared/AudienceBadge.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import TagChip from '$lib/components/shared/TagChip.svelte';
	import type { ConceptListRow } from '$lib/types/concept';

	let {
		concept,
		headingLevel = 3
	}: {
		concept: ConceptListRow;
		/** `h3` where a section heading sits above the list (the homepage tab, `/search`), `h2` on
		 *  the hub, where the cards follow the page's own `h1` with nothing in between — axe's
		 *  `heading-order` rule does not allow a level to be skipped, and it caught exactly that on
		 *  `/concepts`. Same prop, same reason, as `ArticleEditor`'s. */
		headingLevel?: 2 | 3;
	} = $props();
</script>

<article class="concept-card">
	<svelte:element this={`h${headingLevel}`}>
		<a href={resolve('/concepts/[slug]', { slug: concept.slug })}>
			<MathTitle text={concept.title || concept.slug} />
		</a>
	</svelte:element>

	<p class="badges">
		<AudienceBadge audience={concept.audience} />
		<span class="locale">{concept.locale.toUpperCase()}</span>
		{#if concept.articleCount > 1}
			<span class="count">{m.concept_card_articles({ n: concept.articleCount })}</span>
			<!-- "{n} articles" -->
		{/if}
		{#if concept.isFallback}
			<span class="fallback">{m.concept_card_fallback()}</span>
			<!-- "Not written for your readers yet" -->
		{/if}
	</p>

	{#if concept.summary}
		<p class="summary">{concept.summary}</p>
	{/if}

	{#if concept.branchNames.length > 0}
		<p class="branches">
			{#each concept.branchNames as name, index (concept.branchIds[index] ?? name)}
				<span class="branch">{name}</span>
			{/each}
		</p>
	{/if}

	{#if concept.tags.length > 0}
		<p class="tags">
			{#each concept.tags as tag (tag)}
				<TagChip {tag} />
			{/each}
		</p>
	{/if}
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.concept-card {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2,
		h3 {
			margin: 0;
			font-size: var(--font-size-md);
		}
		h2 a,
		h3 a {
			color: var(--text-primary);
		}
		h2 a:hover,
		h3 a:hover {
			color: var(--accent);
		}
	}
	.badges,
	.branches,
	.tags {
		margin: 0;
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
		align-items: center;
	}
	.locale,
	.count,
	.branch {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		border-radius: 999px;
		padding: 1px var(--space-2);
		background: var(--bg-surface-alt);
	}
	.fallback {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
		font-size: var(--font-size-xs);
	}
	.summary {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
