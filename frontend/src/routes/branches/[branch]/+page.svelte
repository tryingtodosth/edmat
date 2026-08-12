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

	// Dumb client-side pagination: the branch page can render hundreds of ExerciseCards in one go,
	// which is the actual cost — not a real "page" concept, just how many of the already-fetched
	// `exercises` are mounted into the DOM at once. No URL state, no virtualization.
	const EXERCISES_PAGE_SIZE = 30;
	let visibleExerciseCount = $state(EXERCISES_PAGE_SIZE);
	let visibleExercises = $derived(exercises.slice(0, visibleExerciseCount));

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
	//
	// A debounce alone does not make this safe. Two requests can still be in flight at once — a
	// filter changed while an earlier one was slow — and nothing about the network guarantees they
	// come back in order, so a slower earlier answer can land on top of a newer one and leave the
	// list showing results for a question that has already been replaced. `$effect`'s own cleanup
	// runs before the next run, so each run marks itself superseded rather than needing a
	// hand-managed request counter.
	$effect(() => {
		if (!branch) return;
		const topicId = filters.topicId;
		const difficulty = filters.difficulty;
		const sourceType = filters.sourceType;
		const query = filters.query;
		let superseded = false;
		getExercisesForBranch(branch.id, getLocale(), { topicId, difficulty, sourceType, query }).then(
			(list) => {
				if (superseded) return;
				exercises = list;
				// A new answer means the filters changed (or the branch did) — start back at page one
				// rather than leaving whatever "show more" progress the visitor had made on the old list.
				visibleExerciseCount = EXERCISES_PAGE_SIZE;
			}
		);
		return () => {
			superseded = true;
		};
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
		// Same out-of-order guard as the exercise effect above, for the same reason.
		let superseded = false;
		getMaterialsForBranch(branch.id, { query, type, tag, topicId, minLevel, sort }).then((list) => {
			if (superseded) return;
			materials = list;
		});
		return () => {
			superseded = true;
		};
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
				<div class="exercises-column">
					<div class="grid">
						{#each visibleExercises as exercise (exercise.id)}
							<ExerciseCard {exercise} />
						{/each}
						{#if exercises.length === 0}
							<p class="empty">{m.home_noResults()}</p>
						{/if}
					</div>
					{#if visibleExerciseCount < exercises.length}
						<button
							type="button"
							class="show-more"
							onclick={() => (visibleExerciseCount += EXERCISES_PAGE_SIZE)}
						>
							{m.branch_showMore()}
						</button>
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
	@use '../../../lib/styles/mixins' as mix;

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
	// Desktop only, matching the 780px breakpoint below where the sidebar collapses to sitting
	// inline above the grid — sticky positioning would be meaningless (and mildly weird) there.
	// Header.svelte's own bar is `position: sticky; top: 0`, so the offset only needs to clear its
	// (fluid, clamp()-based) height; 80px covers it at every width above the collapse.
	@media (min-width: 781px) {
		.layout :global(.filters) {
			position: sticky;
			top: 80px;
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.grid--materials {
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	}
	.exercises-column {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.show-more {
		@include mix.focus-ring;
		align-self: center;
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		color: var(--text-primary);
		font-weight: 500;
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
