<script lang="ts">
	// "What it covers" / "What's required" for anything that can carry claims — a user-run course,
	// an exercise (a material renders its own groups on its detail page, from the claims the material
	// payload already carries). Built from the same badge, popover, add form and ordering rule; the
	// owner only decides which endpoint the claims are read from and proposed to.
	import { onMount } from 'svelte';
	import type { ClaimKind, ClaimOwnerKind, MaterialCoverage, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { claimsOfKind } from '$lib/utils/coverage';
	import { DuplicateCoverageError, getClaims, proposeClaim } from '$lib/services/materials';
	import { authStore } from '$lib/state/auth.svelte';
	import CoverageBadge from '$lib/components/material/CoverageBadge.svelte';
	import CoveragePopover from '$lib/components/material/CoveragePopover.svelte';
	import AddCoverageForm from '$lib/components/material/AddCoverageForm.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';

	let {
		ownerKind,
		ownerId,
		topics,
		coversHint,
		requiresHint
	}: {
		ownerKind: ClaimOwnerKind;
		ownerId: string;
		/** The topics a claim may be about — the owner's own branch(es). */
		topics: Topic[];
		coversHint: string;
		requiresHint: string;
	} = $props();

	let claims = $state<MaterialCoverage[]>([]);
	let loaded = $state(false);
	let openId = $state<string | null>(null);
	let addingKind = $state<ClaimKind | null>(null);
	let addError = $state<string | null>(null);

	let covers = $derived(claimsOfKind(claims, 'covers'));
	let requires = $derived(claimsOfKind(claims, 'requires'));
	let open = $derived(claims.find((c) => c.id === openId) ?? null);

	// In onMount, not at top level: the claims call is public but the page is auth-aware, and a
	// top-level call would also run during SSR (frontend/CLAUDE.md, trap 5).
	onMount(async () => {
		claims = await getClaims(ownerKind, ownerId);
		loaded = true;
	});

	function slugify(name: string): string {
		return name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '');
	}

	async function propose(input: {
		kind: ClaimKind;
		topicId: string;
		subtopicName: string;
		level: number;
	}) {
		addError = null;
		try {
			const claim = await proposeClaim(ownerKind, ownerId, {
				kind: input.kind,
				topicId: input.topicId,
				level: input.level,
				...(input.subtopicName
					? { subtopicSlug: slugify(input.subtopicName), subtopicName: input.subtopicName }
					: {})
			});
			claims = [...claims, claim];
			addingKind = null;
		} catch (e) {
			addError =
				e instanceof DuplicateCoverageError ? m.coverage_addDuplicate() : m.common_error_generic();
		}
	}

	function applyUpdate(updated: MaterialCoverage) {
		claims = claims.map((c) => (c.id === updated.id ? updated : c));
	}
</script>

{#snippet group(kind: ClaimKind, rows: MaterialCoverage[])}
	<section class="claim-group" data-kind={kind}>
		<div class="claim-group__heading">
			<h2>{kind === 'covers' ? m.material_coversHeading() : m.material_requiresHeading()}</h2>
			{#if authStore.isAuthenticated && topics.length > 0}
				<button
					type="button"
					class="add-trigger"
					onclick={() => ((addingKind = kind), (addError = null))}
				>
					+ {kind === 'covers' ? m.coverage_addTrigger() : m.coverage_addRequirementTrigger()}
				</button>
			{/if}
		</div>
		<p class="group-hint">{kind === 'covers' ? coversHint : requiresHint}</p>
		{#if !loaded}
			<p class="status">{m.common_loading()}</p>
		{:else if rows.length === 0}
			<p class="status">
				{kind === 'covers' ? m.material_coversEmpty() : m.material_requiresEmpty()}
			</p>
		{:else}
			<div class="claim-group__badges">
				{#each rows as claim (claim.id)}
					<CoverageBadge coverage={claim} onclick={() => (openId = claim.id)} />
				{/each}
			</div>
		{/if}
	</section>
{/snippet}

{@render group('covers', covers)}
{@render group('requires', requires)}

{#if open}
	<CoveragePopover coverage={open} onClose={() => (openId = null)} onVoteChange={applyUpdate} />
{/if}

{#if addingKind}
	<ModalShell
		title={addingKind === 'requires' ? m.coverage_addRequirementTrigger() : m.coverage_addTrigger()}
		onClose={() => (addingKind = null)}
	>
		{#if addError}
			<p class="add-error">{addError}</p>
		{/if}
		<AddCoverageForm
			kind={addingKind}
			{topics}
			onSubmit={propose}
			onCancel={() => (addingKind = null)}
		/>
	</ModalShell>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.claim-group {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.claim-group__heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.claim-group__heading h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.claim-group__badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.group-hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		margin-top: calc(-1 * var(--space-1));
	}
	.status {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.add-trigger {
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
</style>
