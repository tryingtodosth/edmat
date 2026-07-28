<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type {
		Course,
		Field,
		Material,
		MaterialBrowseFilters,
		ResolvedExercise,
		Topic
	} from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getCourseById, getFieldById, getTopicsForCourse } from '$lib/services/taxonomy';
	import { getExercisesForCourse, type ExerciseFilters } from '$lib/services/exercises';
	import { getMaterialsForCourse } from '$lib/services/materials';
	import FiltersSidebar from '$lib/components/course/FiltersSidebar.svelte';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import MaterialFilterBar from '$lib/components/material/MaterialFilterBar.svelte';

	let course = $state<Course | undefined>(undefined);
	let field = $state<Field | undefined>(undefined);
	let topics = $state<Topic[]>([]);
	let materials = $state<Material[]>([]);
	let exercises = $state<ResolvedExercise[]>([]);
	let tab = $state<'exercises' | 'materials'>('exercises');
	let filters = $state<ExerciseFilters>({});
	let materialFilters = $state<MaterialBrowseFilters>({});
	let loading = $state(true);
	let notFound = $state(false);

	async function loadCourse(courseId: string) {
		loading = true;
		notFound = false;
		filters = {};
		materialFilters = {};
		const c = await getCourseById(courseId);
		if (!c) {
			notFound = true;
			loading = false;
			return;
		}
		course = c;
		const [f, t] = await Promise.all([getFieldById(c.fieldId), getTopicsForCourse(courseId)]);
		field = f;
		topics = t;
		materials = await getMaterialsForCourse(courseId);
		loading = false;
	}

	// See routes/exercises/[id]/+page.svelte's own note on why this guard exists — without it, a
	// spuriously-refiring $effect would silently reset `filters` back to {} on this page, wiping
	// out whatever the visitor had just picked in FiltersSidebar.
	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.course!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadCourse(id);
	});

	// Every filter change re-runs the service call, same shape a real fetch() will have later —
	// each filter field is read synchronously here so Svelte's effect tracking picks it up.
	$effect(() => {
		if (!course) return;
		const topicId = filters.topicId;
		const difficulty = filters.difficulty;
		const sourceType = filters.sourceType;
		const query = filters.query;
		getExercisesForCourse(course.id, getLocale(), { topicId, difficulty, sourceType, query }).then(
			(list) => {
				exercises = list;
			}
		);
	});

	// Same shape, for the Materials tab's own filter bar — course-scoped `getMaterialsForCourse`
	// now forwards every real structured param the search/filter/sort overhaul added (type,
	// topic/subtopic coverage depth, tag, free text, sort) to the backend's own
	// `_filter_materials`/`_sort_materials` (materials/views.py), the exact same ones the
	// cross-course /materials hub already uses.
	$effect(() => {
		if (!course) return;
		const query = materialFilters.query;
		const type = materialFilters.type;
		const tag = materialFilters.tag;
		const topicId = materialFilters.topicId;
		const minLevel = materialFilters.minLevel;
		const sort = materialFilters.sort;
		getMaterialsForCourse(course.id, { query, type, tag, topicId, minLevel, sort }).then((list) => {
			materials = list;
		});
	});
</script>

<svelte:head>
	<title>{course?.name ?? m.common_appName()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else if notFound}
		<p class="empty">{m.course_notFound()}</p>
	{:else if course}
		<!-- "Breadcrumb" -->
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/fields')}>{m.common_home()}</a> ›
			{#if field}
				<a href={resolve('/fields/[field]', { field: field.id })}>{field.name}</a>
			{/if}
		</nav>

		<header>
			<h1>{course.name}</h1>
			<p class="university">{course.university}</p>
			<p>{course.description}</p>
		</header>

		<div class="tabs" role="tablist">
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'exercises'}
				class:active={tab === 'exercises'}
				onclick={() => (tab = 'exercises')}
			>
				{m.course_tab_exercises()}
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'materials'}
				class:active={tab === 'materials'}
				onclick={() => (tab = 'materials')}
			>
				{m.course_tab_materials()}
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
					scope="course"
					{topics}
				/>
				<div class="grid grid--materials">
					{#if materials.length === 0}
						<p class="empty">{m.material_noMaterials()}</p>
					{:else}
						{#each materials as material (material.id)}
							<MaterialCard {material} {topics} />
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
	.university {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		margin-top: var(--space-1);
	}
	header p:not(.university) {
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
