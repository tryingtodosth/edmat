<script lang="ts">
	/**
	 * Improving an article — anybody's, including your own.
	 *
	 * Three things this page resolves before the editor opens, because each changes what is on
	 * screen:
	 *
	 * 1. **An unfinished revision of your own** (`article.myOpen`, status `draft`) is opened rather
	 *    than a new one started. One open draft per (article, author) is a rule the server enforces
	 *    with 409 `draft_exists`; a page that ignored it would send people into a form whose save
	 *    is refused.
	 * 2. **`?revision=`** prefills from a historical revision — "put back what it said in revision
	 *    3" — while still being written AGAINST the current head. Restoring is an edit like any
	 *    other, not a rollback endpoint.
	 * 3. **The head** is what the new revision is based on. A submit whose basis is no longer the
	 *    head is refused with 409 `stale`, and the editor has a whole dialogue for that.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ArticleEditor from '$lib/components/concept/ArticleEditor.svelte';
	import { CONCEPTS_FLAG } from '$lib/components/concept/labels';
	import { getArticle, getRevision } from '$lib/services/concepts';
	import { authStore } from '$lib/state/auth.svelte';
	import type { ConceptArticle, ConceptRevision } from '$lib/types/concept';

	let article = $state<ConceptArticle | null>(null);
	let initial = $state<ConceptRevision | null>(null);
	let draftId = $state('');
	let loading = $state(true);
	let notFound = $state(false);
	/** Set when `?revision=` named a historical revision and it is what the form holds. */
	let restoredFrom = $state(0);

	const slug = $derived(page.params.slug!);

	// The id-changed guard, keyed on the article, the query string and the session (traps 2 and 3).
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const articleId = page.params.id!;
		const key = `${articleId}|${page.url.search}|${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load(articleId, new URLSearchParams(page.url.search).get('revision'));
	});

	async function load(articleId: string, revisionId: string | null) {
		loading = true;
		notFound = false;
		initial = null;
		draftId = '';
		restoredFrom = 0;

		const found = await getArticle(articleId);
		if (!found) {
			notFound = true;
			article = null;
			loading = false;
			return;
		}
		article = found;

		// The caller's own unfinished draft wins over everything: continuing it is the only save
		// the server will accept from them here.
		if (found.myOpen && found.myOpen.status === 'draft') {
			const draft = await getRevision(found.myOpen.id);
			if (draft) {
				initial = draft;
				draftId = draft.id;
			}
		}

		if (!draftId && revisionId) {
			const historical = await getRevision(revisionId);
			if (historical) {
				initial = historical;
				restoredFrom = historical.number;
			}
		}

		if (!initial) initial = found.head;
		loading = false;
	}
</script>

<!-- "Improve this article"; the description is "Write a revision of a concept article." -->
<PageHead title={m.concept_editor_heading_edit()} description={m.concept_seo_edit()} />

<FeatureGate feature={CONCEPTS_FLAG}>
	<div class="page">
		{#if loading}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if notFound || !article}
			<p class="hint">{m.concept_detail_articleNotFound()}</p>
			<!-- "There is no such article." -->
		{:else}
			<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
				<a href={resolve('/concepts')}>{m.concept_hub_heading()}</a>
				›
				<a href={resolve('/concepts/[slug]', { slug })}>{article.title || slug}</a>
			</nav>

			<h1>{m.concept_editor_heading_edit()}</h1>
			<!-- "Improve this article" -->

			{#if authStore.restoring}
				<!-- Still restoring a session is not the same as being a guest (`/submit`'s
				     precedent) — see the write page's own note. -->
				<p class="hint">{m.common_loading()}</p>
				<!-- "Loading…" -->
			{:else if !authStore.isAuthenticated}
				<p class="hint">{m.concept_edit_signIn()}</p>
				<!-- "Sign in to improve this article." -->
			{:else}
				{#if draftId}
					<p class="notice">{m.concept_edit_continuingDraft()}</p>
					<!-- "Carrying on with the draft you already had here." -->
				{:else if restoredFrom}
					<p class="notice">{m.concept_edit_restoredFrom({ number: restoredFrom })}</p>
					<!-- "Starting from revision {number}, on top of what is published now." -->
				{/if}

				<ArticleEditor
					mode="edit"
					{slug}
					articleId={article.id}
					{initial}
					{draftId}
					basedOnId={article.head?.id ?? ''}
					audience={article.audience}
					locale={article.locale}
					willPublish={article.willPublish}
					onsaved={(outcome) => {
						if (outcome.status !== 'draft') {
							void goto(resolve('/concepts/[slug]', { slug: outcome.slug }));
						}
					}}
					onopendraft={(draft) => {
						// The server just told us which draft is in the way; opening it is the whole
						// of what there is to do about it.
						draftId = draft.id;
						loadedFor = null;
					}}
				/>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../../../../lib/styles/mixins' as mix;

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
	.notice {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
		margin: 0;
		align-self: flex-start;
		white-space: normal;
	}
</style>
