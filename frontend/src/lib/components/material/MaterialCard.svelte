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
	import { coverageDepth } from '$lib/utils/coverage';
	import { materialTypesStore } from '$lib/state/materialTypes.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import TagChip from '$lib/components/shared/TagChip.svelte';
	import CoveragePopover from './CoveragePopover.svelte';
	import ClaimListModal from './ClaimListModal.svelte';

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
	let effectiveCoverage = $derived(material.coverage.map((c) => coverageVoteOverlay[c.id] ?? c));
	let openCoverageId = $state<string | null>(null);
	let openCoverage = $derived(effectiveCoverage.find((c) => c.id === openCoverageId) ?? null);

	function handleCoverageVoteChange(updated: MaterialCoverage) {
		coverageVoteOverlay = { ...coverageVoteOverlay, [updated.id]: updated };
	}

	// Sorted by net community vote (highest-agreed-with first) — the whole point of making both
	// groups votable is that a reader sees the most-vetted claims first, not creation order. The
	// full sorted list is derived once and the preview sliced off the front of it, so the "+N more"
	// modal opens in the SAME order the card's own top few established — a list that silently
	// reordered itself on expand would read as a different set of claims rather than more of them.
	let sortedCoverage = $derived(
		[...effectiveCoverage].sort((a, b) => b.voteSummary.netWeight - a.voteSummary.netWeight)
	);
	let topCoverage = $derived(sortedCoverage.slice(0, PREVIEW_COUNT));
	let extraCoverageCount = $derived(Math.max(0, material.coverage.length - PREVIEW_COUNT));

	let sortedRequirements = $derived(
		[...material.requirements].sort((a, b) => b.voteSummary.netWeight - a.voteSummary.netWeight)
	);
	let topRequirements = $derived(sortedRequirements.slice(0, PREVIEW_COUNT));
	let extraRequirementCount = $derived(Math.max(0, material.requirements.length - PREVIEW_COUNT));

	// Which group's full list is open, if any. The count next to each group used to be an inert
	// `<span>` — it named a number ("+27 more") with nothing behind it, which reads as a broken
	// control rather than a deliberate summary.
	let openClaimList = $state<'coverage' | 'requirement' | null>(null);

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
		<span class="material-type">{materialTypesStore.nameFor(material.type)}</span>
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
					class="claim-chip claim-chip--coverage claim-chip--coverage-{coverageDepth(
						coverage.level
					)}"
					title={coverage.subtopicName ?? coverage.topicName}
					onclick={() => (openCoverageId = coverage.id)}
				>
					{coverage.subtopicName ?? coverage.topicName}
				</button>
			{/each}
			{#if extraCoverageCount > 0}
				<button
					type="button"
					class="claim-more"
					aria-label={m.material_moreCountLabel({ count: extraCoverageCount })}
					onclick={() => (openClaimList = 'coverage')}
				>
					{m.material_moreCount({ count: extraCoverageCount })}
				</button>
			{/if}
		</div>
	{/if}

	{#if topRequirements.length > 0}
		<div class="claim-line">
			<span class="claim-line__label">{m.material_requiresLabel()}</span>
			{#each topRequirements as requirement (requirement.id)}
				<span class="claim-chip claim-chip--requirement" title={requirement.label}
					>{requirement.label}</span
				>
			{/each}
			{#if extraRequirementCount > 0}
				<button
					type="button"
					class="claim-more"
					aria-label={m.material_moreCountLabel({ count: extraRequirementCount })}
					onclick={() => (openClaimList = 'requirement')}
				>
					{m.material_moreCount({ count: extraRequirementCount })}
				</button>
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
			     (Material.author is free text — a branch TA/professor's name from the legacy corpus,
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
		{/if}
		<!-- `author` used to hang off an `{:else if}` on `submittedBy` above, so a material with both
		     silently showed only the submitter. They answer genuinely different questions — who WROTE
		     it vs. which account UPLOADED it — and the submission form now collects the author
		     explicitly, so both are routinely present and both are shown. Still plain text, never a
		     link: these are human names (a TA/professor), not platform accounts. -->
		{#if material.author}
			<span class="muted">{m.material_by({ author: material.author })}</span>
		{/if}
		{#if material.sourceUrl}
			<!-- A block-scoped disable/enable pair, not `eslint-disable-next-line`: this rule reports at
			     the `href` ATTRIBUTE's own line, so once Prettier reflows the tag across several lines
			     the single-line form no longer points at the reported line and the error returns. Same
			     fragility, same fix, as CLAUDE.md Section 17N already recorded for this file's own
			     download link. `nofollow` because this URL is user-submitted. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -- a user-declared external URL, not an app route resolve() can express -->
			<a
				class="source-link"
				href={material.sourceUrl}
				target="_blank"
				rel="noopener noreferrer nofollow"
			>
				{m.material_source()}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
		<!-- A material is a hosted file or a link, never neither. The two get the same weight — both
		     are "the thing itself" — but not the same word or the same attributes: `download` on a
		     link somebody else hosts would be a lie about what clicking it does, and `nofollow`
		     belongs on a user-submitted URL rather than on our own media server. -->
		{#if material.fileUrl}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- external URLs (our own media
			     server, or a user-submitted link), neither of which `resolve()` can express. A block
			     pair rather than a next-line directive: the rule reports on the `href` line, and
			     Prettier moves attributes across lines, so a single-line disable stops covering it. -->
			<a
				class="download"
				href={material.fileUrl}
				target="_blank"
				rel="noopener noreferrer"
				download
			>
				{m.material_download()}
			</a>
		{:else if material.url}
			<a class="download" href={material.url} target="_blank" rel="noopener noreferrer nofollow">
				{m.material_open()}
			</a>
		{/if}
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
</article>

<!-- Hidden rather than unmounted while a single claim's popover is open, so closing that popover
     returns to the list it was opened from instead of dumping the reader back to the card — the
     drill-down and its way back, not two unrelated modals. Never both at once: stacking two
     backdrops would leave Escape ambiguous about which one it closes. -->
{#if openClaimList && !openCoverage}
	<ClaimListModal
		title={openClaimList === 'coverage' ? m.material_coversHeading() : m.material_requiresHeading()}
		coverage={openClaimList === 'coverage' ? sortedCoverage : undefined}
		requirements={openClaimList === 'requirement' ? sortedRequirements : undefined}
		onSelectCoverage={(id) => (openCoverageId = id)}
		onClose={() => (openClaimList = null)}
	/>
{/if}

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
		// A coverage/requirement label is real, unbounded-length text (a topic/subtopic name or a
		// free-text "skill tag"), not the short, fixed-vocabulary badges (type/difficulty/source)
		// the shared mixin's own `white-space: nowrap` is otherwise right for — same truncation
		// fix TagChip.svelte's own `.tag-chip__trigger` already applies, for the identical reason.
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.claim-chip--coverage {
		@include mix.focus-ring;
		// Base/`--light`-depth treatment: pale info background, no border. `--moderate` and `--deep`
		// below override this to stay visually distinct from each other — the two used to share
		// this exact pale-pill look, which is the "look identical" bug CoverageBadge.svelte's own
		// depth variants fix the same way (this card renders coverage claims as its own chips,
		// not <CoverageBadge>, so the fix is duplicated here rather than shared).
		color: var(--status-info);
		background: var(--status-info-bg);
		border: 1px solid transparent;
		cursor: pointer;
		font: inherit;
		&:hover {
			background: var(--accent-soft);
			color: var(--accent);
		}
	}
	.claim-chip--coverage-moderate {
		border-color: var(--status-info);
	}
	.claim-chip--coverage-deep {
		// Filled, matching CoverageBadge's own `--deep` treatment: `--accent` background clears
		// 5.8:1 against `--accent-contrast` text in the light theme (AA needs 4.5:1 for this
		// font-size-xs text).
		color: var(--accent-contrast);
		background: var(--accent);
		border-color: var(--accent);
		font-weight: 600;
		&:hover {
			background: var(--accent);
			color: var(--accent-contrast);
			opacity: 0.9;
		}
	}
	.claim-chip--requirement {
		color: var(--accent);
		background: var(--accent-soft);
	}
	.claim-more {
		@include mix.focus-ring;
		color: var(--text-secondary);
		font-style: italic;
		background: none;
		border: none;
		padding: 0;
		font-size: inherit;
		font-family: inherit;
		cursor: pointer;
		text-decoration: underline dotted;
		text-underline-offset: 2px;
		&:hover {
			color: var(--accent);
		}
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
		// A ~44px effective tap target (WCAG 2.5.5-ish minimum), not the previous
		// `padding: var(--space-1) var(--space-3)` + 12px text combo that measured ~22px tall —
		// too small to reliably tap on a phone. `min-height` (not just bigger padding) is what
		// actually guarantees the floor regardless of font metrics; the card's own footer already
		// centers this link vertically (`.material-card__footer { align-items: center }`), so
		// growing just this control doesn't skew the row's layout.
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
	}
	// A plain link, deliberately not styled as a button like `.download` beside it — following a
	// provenance link is a secondary, informational action, and giving it equal visual weight to
	// "get the file" would misrepresent which one the reader is actually here for.
	.source-link {
		@include mix.focus-ring;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		text-decoration: underline;
	}
</style>
