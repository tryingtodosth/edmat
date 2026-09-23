<script lang="ts">
	/**
	 * Writing your own article for a concept.
	 *
	 * Not an edit of somebody else's: articles for one (audience, locale) are peers, the way hints
	 * and solutions are a pool on an exercise (CONCEPTS-BRIEF.md §0). `?audience=` and `?lang=`
	 * carry the page this was started from — `PageSwitcher`'s "write the missing one" and
	 * `ArticlePool`'s "write your own" both arrive here with them set.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ArticleEditor from '$lib/components/concept/ArticleEditor.svelte';
	import { CONCEPTS_FLAG } from '$lib/components/concept/labels';
	import { getConcept } from '$lib/services/concepts';
	import { authStore } from '$lib/state/auth.svelte';
	import type { Audience } from '$lib/types/audience';
	import type { Concept } from '$lib/types/concept';

	let concept = $state<Concept | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	let audience = $state<Audience | ''>('');
	let locale = $state('');

	// The id-changed guard, keyed on the slug, the query string and the session (traps 2 and 3).
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const slug = page.params.slug!;
		const key = `${slug}|${page.url.search}|${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		const params = new URLSearchParams(page.url.search);
		audience = (params.get('audience') ?? '') as Audience | '';
		locale = params.get('lang') ?? '';
		void load(slug);
	});

	async function load(slug: string) {
		loading = true;
		notFound = false;
		const found = await getConcept(slug);
		if (!found) {
			notFound = true;
			concept = null;
		} else {
			concept = found;
		}
		loading = false;
	}
</script>

<!-- "Write an article"; the description is "Write your own article for one of this concept's
     audiences." -->
<PageHead title={m.concept_write_heading()} description={m.concept_seo_write()} />

<FeatureGate feature={CONCEPTS_FLAG}>
	<div class="page">
		{#if loading}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if notFound || !concept}
			<p class="hint">{m.concept_detail_notFound()}</p>
			<!-- "There is no such concept." -->
		{:else}
			<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
				<a href={resolve('/concepts')}>{m.concept_hub_heading()}</a>
				›
				<a href={resolve('/concepts/[slug]', { slug: concept.slug })}>
					{concept.page?.article?.title || concept.slug}
				</a>
			</nav>

			<h1>{m.concept_write_heading()}</h1>
			<!-- "Write an article" -->

			{#if authStore.restoring}
				<!-- A session being restored is not a guest: telling somebody to sign in while their
				     own profile is still on its way is wrong, and `authStore.restoring` is what
				     says which of the two this is (`/submit`'s precedent). -->
				<p class="hint">{m.common_loading()}</p>
				<!-- "Loading…" -->
			{:else if !authStore.isAuthenticated}
				<p class="hint">{m.concept_write_signIn()}</p>
				<!-- "Sign in to write an article." -->
			{:else}
				<ArticleEditor
					mode="write"
					slug={concept.slug}
					{audience}
					{locale}
					willPublish={concept.willPublish}
					onsaved={(outcome) => {
						if (outcome.status !== 'draft') {
							void goto(resolve('/concepts/[slug]', { slug: outcome.slug }));
						}
					}}
				/>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 820px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		h1 {
			margin: 0;
		}
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);

		a {
			color: var(--accent);
		}
	}
	.hint {
		margin: 0;
		color: var(--text-secondary);
	}
</style>
