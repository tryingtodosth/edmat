<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type {
		Branch,
		Discipline,
		Material,
		MaterialBrowseFilters,
		ResolvedExercise,
		Topic
	} from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getBranchById, getDisciplineById, getTopicsForBranch } from '$lib/services/taxonomy';
	import { getExercisesForBranch, type ExerciseFilters } from '$lib/services/exercises';
	import { getMaterialsForBranch } from '$lib/services/materials';
	import FiltersSidebar from '$lib/components/branch/FiltersSidebar.svelte';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import MaterialFilterBar from '$lib/components/material/MaterialFilterBar.svelte';
	import PendingBadge from '$lib/components/shared/PendingBadge.svelte';
	import { isPending } from '$lib/utils/taxonomy';

	let branch = $state<Branch | undefined>(undefined);
	let field = $state<Discipline | undefined>(undefined);
	let topics = $state<Topic[]>([]);
	let materials = $state<Material[]>([]);
	let exercises = $state<ResolvedExercise[]>([]);
	let tab = $state<'exercises' | 'materials'>('exercises');
	let filters = $state<ExerciseFilters>({});
	let materialFilters = $state<MaterialBrowseFilters>({});
	let loading = $state(true);
	let notFound = $state(false);

	async function loadCourse(branchId: string) {
		loading = true;
		notFound = false;
		filters = {};
		materialFilters = {};
		const c = await getBranchById(branchId);
		if (!c) {
			notFound = true;
			loading = false;
			return;
		}
		branch = c;
		const [f, t] = await Promise.all([
			getDisciplineById(c.disciplineId),
			getTopicsForBranch(branchId)
		]);
		field = f;
		topics = t;
		materials = await getMaterialsForBranch(branchId);
		loading = false;
	}

	// See routes/exercises/[id]/+page.svelte's own note on why this guard exists — without it, a
	// spuriously-refiring $effect would silently reset `filters` back to {} on this page, wiping
	// out whatever the visitor had just picked in FiltersSidebar.
	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.branch!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadCourse(id);
	});

	// Every filter change re-runs the service call, same shape a real fetch() will have later —
	// each filter field is read synchronously here so Svelte's effect tracking picks it up.
	$effect(() => {
		if (!branch) return;
		const topicId = filters.topicId;
		const difficulty = filters.difficulty;
		const sourceType = filters.sourceType;
		const query = filters.query;
		getExercisesForBranch(branch.id, getLocale(), { topicId, difficulty, sourceType, query }).then(
			(list) => {
				exercises = list;
			}
		);
	});

	// Same shape, for the Materials tab's own filter bar — branch-scoped `getMaterialsForBranch`
	// now forwards every real structured param the search/filter/sort overhaul added (type,
	// topic/subtopic coverage depth, tag, free text, sort) to the backend's own
	// `_filter_materials`/`_sort_materials` (materials/views.py), the exact same ones the
	// cross-branch /materials hub already uses.
	$effect(() => {
		if (!branch) return;
		const query = materialFilters.query;
		const type = materialFilters.type;
		const tag = materialFilters.tag;
		const topicId = materialFilters.topicId;
		const minLevel = materialFilters.minLevel;
		const sort = materialFilters.sort;
		getMaterialsForBranch(branch.id, { query, type, tag, topicId, minLevel, sort }).then((list) => {
			materials = list;
		});
	});
</script>

<svelte:head>
	<title>{branch?.name ?? m.common_appName()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else if notFound}
		<p class="empty">{m.branch_notFound()}</p>
	{:else if branch}
		<!-- "Breadcrumb" -->
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/disciplines')}>{m.common_home()}</a> ›
			{#if field}
				<a href={resolve('/disciplines/[discipline]', { discipline: field.id })}>{field.name}</a>
			{/if}
		</nav>

		<header>
			<!-- Same reasoning as the discipline page: the "Others" grouping is one page back, and
			     nothing here would otherwise say this branch is still only a suggestion. -->
			<h1>
				{branch.name}
				{#if isPending(branch)}<PendingBadge />{/if}
			</h1>
			<p>{branch.description}</p>
		</header>

		<div class="tabs" role="tablist">
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'exercises'}
				class:active={tab === 'exercises'}
				onclick={() => (tab = 'exercises')}
			>
				{m.branch_tab_exercises()}
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'materials'}
				class:active={tab === 'materials'}
				onclick={() => (tab = 'materials')}
			>
				{m.branch_tab_materials()}
			</button>
		</div>

		{#if tab === 'exercises'}
			<div class="layout">
				<FiltersSidebar {topics} bind:filters resultCount={exercises.length} />
				<div class="grid">
					{#each exercises as exercise (exercise.id)}
						<ExerciseCard {exercise} />
					{/each}
					{#if exercises.length === 0}
						<p class="empty">{m.home_noResults()}</p>
					{/if}
				</div>
			</div>
		{:else}
			<div class="layout">
				<MaterialFilterBar
					bind:filters={materialFilters}
					resultCount={materials.length}
					scope="branch"
					{topics}
				/>
				<div class="grid grid--materials">
					{#if materials.length === 0}
						<p class="empty">{m.material_noMaterials()}</p>
					{:else}
						{#each materials as material (material.id)}
							<MaterialCard {material} />
						{/each}
					{/if}
				</div>
			</div>
		{/if}
	{/if}
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
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	header p {
		color: var(--text-secondary);
		margin-top: var(--space-2);
	}
	.tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 1px solid var(--border-color);
	}
	.tabs button {
		background: none;
		border: none;
		padding: var(--space-2) var(--space-1);
		font-weight: 600;
		color: var(--text-secondary);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tabs button.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
	.layout {
		display: grid;
		grid-template-columns: 240px 1fr;
		gap: var(--space-4);
		align-items: start;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.grid--materials {
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
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
