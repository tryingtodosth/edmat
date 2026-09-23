<script lang="ts">
	/**
	 * The articles on one page, as the pool of peers they are.
	 *
	 * Several people may write their own article for the same (audience, locale) — the `SolutionEntry`
	 * shape, and for the same reason: two good explanations of "derivative" for the same readers are
	 * two explanations, not an argument. Pinned first (staff and branch governors), then newest
	 * published. "Write your own article" and "Improve this one" are two different actions, and this
	 * is where the first of them lives.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import type { ConceptArticleSummary } from '$lib/types/concept';

	let {
		slug,
		articles,
		currentId,
		audience,
		locale,
		canPin = false,
		canWrite = true,
		onpin = undefined
	}: {
		slug: string;
		articles: ConceptArticleSummary[];
		/** The one being read in full. */
		currentId: string | null;
		audience: string;
		locale: string;
		canPin?: boolean;
		canWrite?: boolean;
		onpin?: (article: ConceptArticleSummary, pinned: boolean) => void;
	} = $props();

	const base = $derived(resolve('/concepts/[slug]', { slug }));
	const writeHref = $derived(
		`${resolve('/concepts/[slug]/write', { slug })}?audience=${encodeURIComponent(audience)}&lang=${encodeURIComponent(locale)}`
	);
	// Both hrefs ARE resolved — `no-navigation-without-resolve` cannot see through the query
	// string appended to the resolved path, the same disable every other "resolve() + ?query"
	// link in this app carries (TagChip, the profile page's "send a message").
</script>

<section class="pool">
	{#if articles.length > 1}
		<h2>{m.concept_pool_heading({ n: articles.length })}</h2>
		<!-- "{n} articles for these readers" -->
		<ul>
			{#each articles as article (article.id)}
				<li class:here={article.id === currentId}>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built on resolve('/concepts/[slug]'), query params only -->
					<a href={`${base}?article=${encodeURIComponent(article.id)}`}>
						<MathTitle text={article.title} />
					</a>
					{#if article.pinned}
						<span class="pin">{m.concept_pool_pinned()}</span>
						<!-- "Pinned" -->
					{/if}
					{#if article.createdByDisplayName}
						<span class="who">{m.concept_by({ name: article.createdByDisplayName })}</span>
						<!-- "by {name}" -->
					{/if}
					{#if article.headPublishedAt}
						<span class="when">{formatDate(article.headPublishedAt)}</span>
					{/if}
					{#if canPin}
						<button type="button" onclick={() => onpin?.(article, !article.pinned)}>
							{article.pinned ? m.concept_pool_unpin() : m.concept_pool_pin()}
							<!-- "Unpin" / "Pin" -->
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if canWrite}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `writeHref` is resolve('/concepts/[slug]/write') plus query params -->
		<a class="write" href={writeHref}>
			{m.concept_pool_writeYourOwn()}
			<!-- "Write your own article for these readers" -->
		</a>
	{/if}
</section>

<style lang="scss">
	.pool {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	li {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-sm);
		padding: var(--space-1) var(--space-2);
		border-left: 2px solid transparent;
	}
	li.here {
		border-left-color: var(--accent);
		background: var(--bg-surface-alt);
	}
	a {
		color: var(--accent);
	}
	.pin,
	.who,
	.when {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	button {
		min-height: 32px;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: var(--font-size-xs);
		cursor: pointer;
	}
	.write {
		align-self: flex-start;
		font-size: var(--font-size-sm);
	}
</style>
