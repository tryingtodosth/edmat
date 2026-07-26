<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Material, MaterialCoverage, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { proposeCoverage, DuplicateCoverageError } from '$lib/services/materials';
	import { authStore } from '$lib/state/auth.svelte';
	import { MATERIAL_TYPE_LABELS } from '$lib/utils/labels';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import TagChip from '$lib/components/shared/TagChip.svelte';
	import CoverageBadge from './CoverageBadge.svelte';
	import CoveragePopover from './CoveragePopover.svelte';
	import AddCoverageForm from './AddCoverageForm.svelte';

	// linkTitle: true everywhere this card is used as a feed/grid item (the course page's own
	// Materials tab — its only caller before Phase 4); false on the material's OWN detail page
	// (materials/[id]/+page.svelte, this card's new second caller), where linking the title back to
	// the very page it's already on would be a pointless, confusing self-link.
	let {
		material,
		topics = [],
		linkTitle = true
	}: { material: Material; topics?: Topic[]; linkTitle?: boolean } = $props();

	// Local, session-only overlay so a freshly-proposed coverage row appears immediately without
	// re-fetching the whole material — same "optimistic append" shape this app's own
	// exercise-detail page already uses for a just-submitted review/comment.
	let coverageOverlay = $state<MaterialCoverage[]>([]);
	let allCoverage = $derived([...material.coverage, ...coverageOverlay]);

	let openCoverageId = $state<string | null>(null);
	let openCoverage = $derived(allCoverage.find((c) => c.id === openCoverageId) ?? null);

	let addingCoverage = $state(false);
	let addError = $state<string | null>(null);

	function slugify(name: string): string {
		return name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '');
	}

	async function handleProposeCoverage(input: {
		topicId: string;
		subtopicName: string;
		level: number;
	}) {
		addError = null;
		try {
			const coverage = await proposeCoverage(material.id, {
				topicId: input.topicId,
				level: input.level,
				...(input.subtopicName
					? { subtopicSlug: slugify(input.subtopicName), subtopicName: input.subtopicName }
					: {})
			});
			coverageOverlay = [...coverageOverlay, coverage];
			addingCoverage = false;
		} catch (e) {
			addError =
				e instanceof DuplicateCoverageError ? m.coverage_addDuplicate() : m.common_error_generic();
		}
	}
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
	<p>{material.description}</p>

	{#if allCoverage.length > 0 || authStore.isAuthenticated}
		<div class="material-card__coverage">
			{#each allCoverage as coverage (coverage.id)}
				<CoverageBadge {coverage} onclick={() => (openCoverageId = coverage.id)} />
			{/each}
			{#if authStore.isAuthenticated && topics.length > 0}
				<button
					type="button"
					class="add-coverage-trigger"
					onclick={() => ((addingCoverage = true), (addError = null))}
				>
					+ {m.coverage_addTrigger()}
				</button>
			{/if}
		</div>
	{/if}

	{#if material.tags.length > 0}
		<div class="material-card__tags">
			{#each material.tags as tag (tag)}
				<TagChip {tag} />
			{/each}
		</div>
	{/if}

	<div class="material-card__footer">
		<span class="muted">{m.material_by({ author: material.author })}</span>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external file URL (the Django media server), not an app route resolve() can express -->
		<a class="download" href={material.fileUrl} target="_blank" rel="noopener noreferrer" download>
			{m.material_download()}
		</a>
	</div>
</article>

{#if openCoverage}
	<CoveragePopover coverage={openCoverage} onClose={() => (openCoverageId = null)} />
{/if}

{#if addingCoverage}
	<ModalShell title={m.coverage_addTrigger()} onClose={() => (addingCoverage = false)}>
		{#if addError}
			<p class="add-error">{addError}</p>
		{/if}
		<AddCoverageForm
			{topics}
			onSubmit={handleProposeCoverage}
			onCancel={() => (addingCoverage = false)}
		/>
	</ModalShell>
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
	p {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		flex: 1;
	}
	.material-card__coverage {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
	}
	.material-card__tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.add-coverage-trigger {
		@include mix.focus-ring;
		background: none;
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		padding: 2px var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		cursor: pointer;
		&:hover {
			color: var(--accent);
			border-color: var(--accent);
		}
	}
	.add-error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
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
	.download {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
</style>
