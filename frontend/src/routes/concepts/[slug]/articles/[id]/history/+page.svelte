<script lang="ts">
	/**
	 * An article's history, and one revision read beside it.
	 *
	 * This is also where a revision is DECIDED on, because the deciding circle here is wider than
	 * staff — a governor of one of the concept's branches, and the article's own author for
	 * revisions of their article — so most decisions never touch the moderation page at all
	 * (CONCEPTS-BRIEF.md §0). `RevisionDecision` renders nothing for somebody who may not.
	 *
	 * Selection is client-side: one list, one reader beside it. A URL per revision would be a page
	 * with no content of its own, and the history is the thing being read.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDateTime } from '$lib/utils/datetime';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import RevisionDecision from '$lib/components/concept/RevisionDecision.svelte';
	import RevisionList from '$lib/components/concept/RevisionList.svelte';
	import RevisionView from '$lib/components/concept/RevisionView.svelte';
	import { CONCEPTS_FLAG, REVISION_STATUS_LABELS } from '$lib/components/concept/labels';
	import { getArticle, getRevisions } from '$lib/services/concepts';
	import { authStore } from '$lib/state/auth.svelte';
	import type { ConceptArticle, ConceptRevision } from '$lib/types/concept';

	let article = $state<ConceptArticle | null>(null);
	let revisions = $state<ConceptRevision[]>([]);
	let selected = $state<ConceptRevision | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	/** A decision made here keeps the section mounted so its confirmation is seen: deciding clears
	 *  `canDecide`, which would otherwise unmount it in the same tick that sets its notice. */
	let decidedHere = $state(false);

	const slug = $derived(page.params.slug!);

	/** What the selected revision changed against — what it was written against where that is
	 *  still readable, else the head. Both come from the list, which is the server's own per-row
	 *  visibility answer: a basis missing from it is one this reader may not see. */
	const before = $derived(
		selected
			? (revisions.find((row) => row.id === selected?.basedOnId) ??
					revisions.find((row) => row.status === 'published' && row.id !== selected?.id) ??
					null)
			: null
	);

	// The id-changed guard, keyed on the article and the session (traps 2 and 3).
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const articleId = page.params.id!;
		const key = `${articleId}|${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load(articleId);
	});

	async function load(articleId: string) {
		loading = true;
		notFound = false;
		decidedHere = false;
		const found = await getArticle(articleId);
		if (!found) {
			notFound = true;
			article = null;
			loading = false;
			return;
		}
		article = found;
		revisions = await getRevisions(articleId).catch(() => []);
		// Whatever is waiting for a decision first — that is why most people open this page — then
		// the published one, then simply the newest.
		selected =
			revisions.find((row) => row.status === 'pending') ??
			revisions.find((row) => row.status === 'published') ??
			revisions[0] ??
			null;
		loading = false;
	}

	function replace(updated: ConceptRevision) {
		revisions = revisions.map((row) => (row.id === updated.id ? updated : row));
		selected = updated;
		decidedHere = true;
	}
</script>

<!-- "History"; the description is "Every revision of a concept article, and what each one
     changed." -->
<PageHead title={m.concept_history_heading()} description={m.concept_seo_history()} />

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

			<header class="head">
				<h1>{m.concept_history_heading()}</h1>
				<!-- "History" -->
				<p class="subtitle"><MathTitle text={article.title} /></p>
			</header>

			<div class="layout">
				<RevisionList
					{revisions}
					currentId={selected?.id ?? null}
					onselect={(revision) => {
						selected = revision;
						decidedHere = false;
					}}
				/>

				<div class="reader">
					{#if !selected}
						<p class="hint">{m.concept_revisions_empty()}</p>
						<!-- "No revisions yet." -->
					{:else}
						<header class="reader__head">
							<h2><MathTitle text={selected.title} /></h2>
							<p class="meta">
								<span class="badge">{REVISION_STATUS_LABELS[selected.status]()}</span>
								<span>{m.concept_revisions_number({ number: selected.number })}</span>
								<!-- "Revision {number}" -->
								{#if selected.createdByDisplayName}
									<span>{m.concept_by({ name: selected.createdByDisplayName })}</span>
									<!-- "by {name}" -->
								{/if}
								<span>{formatDateTime(selected.createdAt)}</span>
							</p>
							{#if selected.changeNote}
								<p class="note">{selected.changeNote}</p>
							{/if}
							{#if selected.basedOnId && !selected.basedOnIsCurrent}
								<p class="stale-note">{m.concept_history_notCurrent()}</p>
								<!-- "This was written against an older revision than the one published now." -->
							{/if}
							{#if selected.reviewedAt}
								<p class="note">
									{m.concept_history_decidedBy({ name: selected.reviewedByDisplayName })}
									<!-- "Decided by {name}" -->
								</p>
								{#if selected.reviewNote}
									<p class="note">{selected.reviewNote}</p>
								{/if}
							{/if}
						</header>

						<RevisionView revision={selected} {before} />

						{#if selected.canDecide || selected.canWithdraw || decidedHere}
							<RevisionDecision revision={selected} ondecided={replace} />
						{/if}

						{#if authStore.isAuthenticated && selected.status !== 'draft'}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- an internal route built from resolve('/concepts/[slug]/articles/[id]/edit') plus a query string the rule cannot statically see through -->
							<a
								class="action"
								href={`${resolve('/concepts/[slug]/articles/[id]/edit', {
									slug,
									id: article.id
								})}?revision=${encodeURIComponent(selected.id)}`}
							>
								{m.concept_history_startFrom({ number: selected.number })}
								<!-- "Start a new revision from this one" -->
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../../../../lib/styles/mixins' as mix;

	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);

		a {
			color: var(--accent);
		}
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		h1 {
			margin: 0;
		}
	}
	.subtitle {
		margin: 0;
		color: var(--text-secondary);
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(240px, 1fr) minmax(0, 2fr);
		gap: var(--space-3);
		align-items: start;

		@media (max-width: 720px) {
			grid-template-columns: 1fr;
		}
	}
	.reader {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.reader__head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		h2 {
			margin: 0;
		}
	}
	.meta {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.badge {
		border-radius: 999px;
		padding: 1px var(--space-2);
		background: var(--bg-surface-alt);
	}
	.note {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.stale-note {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
		margin: 0;
		align-self: flex-start;
		white-space: normal;
	}
	.action {
		align-self: flex-start;
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
