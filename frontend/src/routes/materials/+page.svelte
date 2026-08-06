<script lang="ts">
	// The materials search/filter/sort overhaul's own cross-branch browse hub — before this route
	// existed, materials could only be seen scoped inside one branch's own Materials tab, and the
	// backend's real GET /api/materials/ (type/topic/tag/min_level/q/sort, plus the personalized
	// GET /api/materials/recommended/) had no frontend page consuming it at all. Two real sections:
	// a personalized "Recommended" strip (RecommendedMaterials.svelte) above a full, filterable,
	// sortable grid across every branch at once — both respecting the same shared
	// simple/advanced `materialsUiStore` mode every other materials surface in this app now reads.
	import type { Discipline, Material, MaterialBrowseFilters } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getDisciplines } from '$lib/services/taxonomy';
	import { browseMaterials } from '$lib/services/materials';
	import MaterialFilterBar from '$lib/components/material/MaterialFilterBar.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import RecommendedMaterials from '$lib/components/material/RecommendedMaterials.svelte';

	let fields = $state<Discipline[]>([]);
	let materials = $state<Material[]>([]);
	let filters = $state<MaterialBrowseFilters>({});
	let loading = $state(true);

	$effect(() => {
		getDisciplines().then((f) => (fields = f));
	});

	// Every filter field is read synchronously here so Svelte's own effect tracking picks each one
	// up individually — the same shape routes/branches/[branch]/+page.svelte's own exercise-filter
	// effect already uses.
	$effect(() => {
		const query = filters.query;
		const type = filters.type;
		const tag = filters.tag;
		const disciplineId = filters.disciplineId;
		const branchId = filters.branchId;
		const topicId = filters.topicId;
		const minLevel = filters.minLevel;
		const sort = filters.sort;
		loading = true;
		browseMaterials({ query, type, tag, disciplineId, branchId, topicId, minLevel, sort }).then(
			(list) => {
				materials = list;
				loading = false;
			}
		);
	});
</script>

<svelte:head>
	<title>{m.materialsHub_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<header>
		<h1>{m.materialsHub_heading()}</h1>
		<p>{m.materialsHub_subtitle()}</p>
	</header>

	<RecommendedMaterials />

	<div class="layout">
		<MaterialFilterBar bind:filters resultCount={materials.length} scope="global" {fields} />
		<div class="grid">
			{#if loading}
				<p class="loading">{m.common_loading()}</p>
			{:else if materials.length === 0}
				<p class="empty">{m.home_noResults()}</p>
			{:else}
				{#each materials as material (material.id)}
					<MaterialCard {material} />
				{/each}
			{/if}
		</div>
	</div>
</div>

<style lang="scss">
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	header p {
		color: var(--text-secondary);
		margin-top: var(--space-2);
	}
	.layout {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: var(--space-4);
		align-items: start;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-3);
	}
	.loading,
	.empty {
		color: var(--text-secondary);
	}

	@media (max-width: 780px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}
</style>
