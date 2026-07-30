<script lang="ts">
	// The public browse/grid card — deliberately a compact SUMMARY only, matching ServiceCard's own
	// "one card component, reused at a different weight/context" economy: every real interactive
	// flow this card used to cram inline (proposing coverage, editing requirements, voting) now lives
	// on the material's own detail page instead (routes/materials/[id]/+page.svelte), the same way
	// ServiceCard has no inline review/comment/watchlist UI of its own either.
	//
	// A real, reported bug this rewrite fixes: a material with dozens of coverage claims (the real
	// corpus has materials with 30+, CLAUDE.md's own materials-overhaul note) used to render every
	// single one as its own clickable badge inline on this card — several wrapped lines of coverage
	// chips before a reader ever reached the description, price, or download link, on EVERY card in
	// a grid of them. This card now shows only the top few (by net community vote) of each of the
	// two votable groups — "Covers" and "Requires" — with a plain "+N more" count, never the full
	// list; the full, sortable, votable list lives on the detail page.
	import { resolve } from '$app/paths';
	import type { Material, MaterialCoverage } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { MATERIAL_TYPE_LABELS } from '$lib/utils/labels';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import TagChip from '$lib/components/shared/TagChip.svelte';
	import CoveragePopover from './CoveragePopover.svelte';

	// linkTitle: true everywhere this card is used as a feed/grid item; false on the material's OWN
	// detail page, where linking the title back to the very page it's already on would be a
	// pointless, confusing self-link.
	let { material, linkTitle = true }: { material: Material; linkTitle?: boolean } = $props();

	const PREVIEW_COUNT = 3;

	// A real, found gap: the compact coverage chips this rewrite introduced were plain, non-
	// interactive `<span>`s — a reader could no longer open a claim's own discussion/vote popover
	// from the list view at all, only from the detail page. Fixed by reusing CoveragePopover
	// directly (the exact same modal the detail page already opens), rather than inventing a
	// second, lighter interaction for what's still the same underlying claim.
	//
	// A local vote-update overlay, not a direct mutation of the `material` prop — MaterialCard
	// renders a plain, possibly-shared `material` object (a grid/feed item, not this component's own
	// owned state), so a vote cast inside the popover updates THIS overlay instead, the same
	// "overlay, don't mutate a shared prop" shape `removedTags` below already establishes for tags.
	let coverageVoteOverlay = $state<Record<string, MaterialCoverage>>({});
	let effectiveCoverage = $derived(
		material.coverage.map((c) => coverageVoteOverlay[c.id] ?? c)
	);
	let openCoverageId = $state<string | null>(null);
	let openCoverage = $derived(effectiveCoverage.find((c) => c.id === openCoverageId) ?? null);

	function handleCoverageVoteChange(updated: MaterialCoverage) {
		coverageVoteOverlay = { ...coverageVoteOverlay, [updated.id]: updated };
	}

	// Sorted by net community vote (highest-agreed-with first) — the whole point of making both
	// groups votable is that a reader sees the most-vetted claims first, not creation order.
	let topCoverage = $derived(
		[...effectiveCoverage]
			.sort((a, b) => b.voteSummary.netWeight - a.voteSummary.netWeight)
			.slice(0, PREVIEW_COUNT)
	);
	let extraCoverageCount = $derived(Math.max(0, material.coverage.length - PREVIEW_COUNT));

	let topRequirements = $derived(
		[...material.requirements]
			.sort((a, b) => b.voteSummary.netWeight - a.voteSummary.netWeight)
			.slice(0, PREVIEW_COUNT)
	);
	let extraRequirementCount = $derived(Math.max(0, material.requirements.length - PREVIEW_COUNT));

	// Local, session-only overlay — the same subtract-shaped sibling to `coverageOverlay`'s own
	// pre-existing add-shaped pattern this card already used elsewhere in this app (MaterialCard is
	// a plain, possibly-shared `material` prop, not owned state, so there's no single source to
	// mutate directly the way an owned-state page can).
	let removedTags = $state<Set<string>>(new Set());
	let visibleTags = $derived(material.tags.filter((t) => !removedTags.has(t)));
</script>

<article class="material-card">
	<div class="material-card__heading">
		{#if linkTitle}
			<a class="material-card__title-link" href={resolve('/materials/[id]', { id: material.id })}>
				<h3><MathTitle text={material.title} /></h3>
			</a>
		{:else}
			<h3><MathTitle text={material.title} /></h3>
		{/if}
		<span class="material-type">{MATERIAL_TYPE_LABELS[material.type]()}</span>
	</div>

	{#if material.reviewCount > 0}
		<p class="rating-summary">
			{m.review_average({
				average: material.averageRating ?? 0,
				count: material.reviewCount
			})}
		</p>
	{/if}

	<p class="description">{material.description}</p>

	{#if topCoverage.length > 0}
		<div class="claim-line">
			<span class="claim-line__label">{m.material_coversLabel()}</span>
			{#each topCoverage as coverage (coverage.id)}
				<button
					type="button"
					class="claim-chip claim-chip--coverage"
					onclick={() => (openCoverageId = coverage.id)}
				>
					{coverage.subtopicName ?? coverage.topicName}
				</button>
			{/each}
			{#if extraCoverageCount > 0}
				<span class="claim-more">{m.material_moreCount({ count: extraCoverageCount })}</span>
			{/if}
		</div>
	{/if}

	{#if topRequirements.length > 0}
		<div class="claim-line">
			<span class="claim-line__label">{m.material_requiresLabel()}</span>
			{#each topRequirements as requirement (requirement.id)}
				<span class="claim-chip claim-chip--requirement">{requirement.label}</span>
			{/each}
			{#if extraRequirementCount > 0}
				<span class="claim-more">{m.material_moreCount({ count: extraRequirementCount })}</span>
			{/if}
		</div>
	{/if}

	{#if visibleTags.length > 0}
		<div class="material-card__tags">
			{#each visibleTags as tag (tag)}
				<TagChip
					{tag}
					appliedTo={{
						kind: 'material',
						objectId: material.id,
						onRemoved: () => (removedTags = new Set([...removedTags, tag]))
					}}
				/>
			{/each}
		</div>
	{/if}

	{#if material.priceAmount !== undefined || material.estimatedMinutes !== undefined}
		<div class="material-card__meta">
			{#if material.priceAmount !== undefined}
				<span class="meta-pill price"
					>{m.material_price({
						amount: material.priceAmount.toFixed(2),
						currency: material.priceCurrency
					})}</span
				>
			{/if}
			{#if material.estimatedMinutes !== undefined}
				<span class="meta-pill time"
					>{m.material_estimatedMinutes({ minutes: material.estimatedMinutes })}</span
				>
			{/if}
		</div>
	{/if}

	<div class="material-card__footer">
		{#if material.submittedByUserId}
			<!-- A real, found gap: a community-submitted material had NO clickable attribution at all
			     (Material.author is free text — a course TA/professor's name from the legacy corpus,
			     almost never a real account, so it stays plain text below) until `submitted_by` was
			     added. Same "link the author's name to their public profile" convention the exercise
			     detail page's own `submitted-by` link already establishes. -->
			<span class="submitted-by">
				{m.material_submittedByPrefix()}
				<a
					class="submitted-by-link"
					href={resolve('/users/[id]', { id: material.submittedByUserId })}
				>
					{material.submittedByDisplayName ?? material.submittedByUserId}
				</a>
			</span>
		{:else if material.author}
			<span class="muted">{m.material_by({ author: material.author })}</span>
		{/if}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external file URL (the Django media server), not an app route resolve() can express -->
		<a class="download" href={material.fileUrl} target="_blank" rel="noopener noreferrer" download>
			{m.material_download()}
		</a>
	</div>
</article>

{#if openCoverage}
	<CoveragePopover
		coverage={openCoverage}
		onClose={() => (openCoverageId = null)}
		onVoteChange={handleCoverageVoteChange}
	/>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.material-card {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.material-card__heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.material-card__title-link {
		color: var(--text-primary);
		min-width: 0;
		&:hover h3 {
			color: var(--accent);
		}
	}
	.material-type {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		flex-shrink: 0;
	}
	.rating-summary {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.description {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		flex: 1;
	}
	.claim-line {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
		font-size: var(--font-size-xs);
	}
	.claim-line__label {
		color: var(--text-secondary);
		font-weight: 600;
	}
	.claim-chip {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
	.claim-chip--coverage {
		@include mix.focus-ring;
		color: var(--status-info);
		background: var(--status-info-bg);
		border: none;
		cursor: pointer;
		font: inherit;
		&:hover {
			background: var(--accent-soft);
			color: var(--accent);
		}
	}
	.claim-chip--requirement {
		color: var(--accent);
		background: var(--accent-soft);
	}
	.claim-more {
		color: var(--text-secondary);
		font-style: italic;
	}
	.material-card__tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.material-card__meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.meta-pill {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		font-weight: 600;
	}
	.material-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.muted {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.submitted-by {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.submitted-by-link {
		font-weight: 600;
		color: var(--text-secondary);
		text-decoration: underline;
		&:hover {
			color: var(--accent);
		}
	}
	.download {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
</style>
