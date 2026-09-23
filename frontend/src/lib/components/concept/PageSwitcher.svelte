<script lang="ts">
	/**
	 * Which page of a concept you are reading, and which others exist.
	 *
	 * A "page" is one (audience, locale) — the primary-school article and the university article of
	 * "quantum mechanics" are two pages of one concept. A concept page never 404s while any article
	 * is published, so a reader is quite often being shown a page that is not theirs; the whole
	 * point of this strip is that it SAYS SO, in words, and offers to write the missing one
	 * (CONCEPTS-BRIEF.md §0, "reading a missing article").
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { audienceFilterStore } from '$lib/state/audienceFilter.svelte';
	import { AUDIENCE_LABELS } from '$lib/utils/labels';
	import type { ConceptPage, ConceptPageRef } from '$lib/types/concept';

	let {
		slug,
		pages,
		current
	}: {
		slug: string;
		pages: ConceptPageRef[];
		/** Null when nothing under this concept is readable yet. */
		current: ConceptPage | null;
	} = $props();

	function pageHref(audience: string, locale: string): string {
		return `${resolve('/concepts/[slug]', { slug })}?audience=${encodeURIComponent(audience)}&lang=${encodeURIComponent(locale)}`;
	}
	function writeHref(audience: string, locale: string): string {
		return `${resolve('/concepts/[slug]/write', { slug })}?audience=${encodeURIComponent(audience)}&lang=${encodeURIComponent(locale)}`;
	}

	const isCurrent = (page: ConceptPageRef) =>
		current !== null && page.audience === current.audience && page.locale === current.locale;

	/** The reader's own band, when they have narrowed to exactly one — the only case where
	 *  "write the missing article for YOUR readers" is a sentence that means something. */
	const myBand = $derived(
		audienceFilterStore.bands.length === 1 ? audienceFilterStore.bands[0] : null
	);
	const missingMyBand = $derived(
		myBand !== null && current !== null && !pages.some((p) => p.audience === myBand)
	);
</script>

<nav class="switcher" aria-label={m.concept_pages_label()}>
	<!-- "Versions of this concept" -->
	{#if pages.length > 0}
		<ul class="chips">
			{#each pages as page (`${page.audience}:${page.locale}`)}
				<li>
					<!-- eslint-disable svelte/no-navigation-without-resolve -- `pageHref` is resolve('/concepts/[slug]') plus a query string the rule cannot statically see through -->
					<a
						class="chip"
						class:chip--current={isCurrent(page)}
						aria-current={isCurrent(page) ? 'page' : undefined}
						href={pageHref(page.audience, page.locale)}
					>
						<span>{AUDIENCE_LABELS[page.audience]()}</span>
						<span class="chip__locale">{page.locale.toUpperCase()}</span>
						{#if page.articleCount > 1}
							<span class="chip__count">{m.concept_pages_count({ n: page.articleCount })}</span>
							<!-- "{n} articles" -->
						{/if}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</li>
			{/each}
		</ul>
	{/if}

	{#if current && (!current.audienceExact || !current.localeExact)}
		<p class="fallback" role="status">
			{#if !current.audienceExact && !current.localeExact}
				{m.concept_pages_fallbackBoth({
					audience: AUDIENCE_LABELS[current.audience](),
					locale: current.locale.toUpperCase()
				})}
				<!-- "Nothing is written for your readers in your language yet — this is the {audience} article in {locale}." -->
			{:else if !current.audienceExact}
				{m.concept_pages_fallbackAudience({ audience: AUDIENCE_LABELS[current.audience]() })}
				<!-- "Nothing is written for your readers yet — this is the {audience} article." -->
			{:else}
				{m.concept_pages_fallbackLocale({ locale: current.locale.toUpperCase() })}
				<!-- "This article is not in your language yet — this is the {locale} one." -->
			{/if}
		</p>
	{/if}

	{#if missingMyBand && myBand}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `writeHref` is resolve('/concepts/[slug]/write') plus query params -->
		<a class="write" href={writeHref(myBand, current?.locale ?? '')}>
			{m.concept_pages_writeForBand({ audience: AUDIENCE_LABELS[myBand]() })}
			<!-- "Write the {audience} article" -->
		</a>
	{/if}
</nav>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.switcher {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.chip {
		@include mix.focus-ring;
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-1);
		padding: 3px var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		font-size: var(--font-size-xs);
		color: var(--text-primary);
	}
	.chip--current {
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 600;
	}
	.chip__locale,
	.chip__count {
		color: var(--text-secondary);
	}
	.chip--current .chip__locale,
	.chip--current .chip__count {
		color: inherit;
	}
	.fallback {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
		margin: 0;
		align-self: flex-start;
		white-space: normal;
	}
	.write {
		align-self: flex-start;
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
</style>
