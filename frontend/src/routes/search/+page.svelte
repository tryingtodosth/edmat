<script lang="ts">
	// Searching the whole site, from the one place a person arrives at.
	//
	// **Why this exists.** The homepage promised "Find the right exercise, worked and explained" and
	// then offered a button to go and browse disciplines — so the only way to find a named thing was
	// to guess which discipline held it and use the filter box on that page. On a database whose
	// whole value is that somebody else already solved the problem you are stuck on, the search has
	// to be on the front door.
	//
	// Exercises and materials, in that order, because an exercise is what the site is for and a
	// material is the supporting thing. Not courses, events or tutoring: those are people and
	// schedules rather than content, each already has its own browse page with its own filters, and
	// folding five kinds into one ranked list would need a relevance model this has no basis for.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { searchExercises } from '$lib/services/exercises';
	import { searchMaterials } from '$lib/services/materials';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import SearchInput from '$lib/components/shared/SearchInput.svelte';
	import type { Material, ResolvedExercise } from '$lib/types';
	import { SEARCH_MIN_QUERY_LENGTH } from '$lib/utils/textInput';

	let exercises = $state<ResolvedExercise[]>([]);
	let materials = $state<Material[]>([]);
	let loading = $state(false);
	let searchedFor = $state('');

	const query = $derived(page.url.searchParams.get('q') ?? '');

	/** The URL is the state, so a result page can be linked, reloaded and reached with the back
	 * button — which is most of why a search deserves a route rather than a popover. */
	function submit(next: string) {
		const trimmed = next.trim();
		const url = new URL(page.url);
		if (trimmed) url.searchParams.set('q', trimmed);
		else url.searchParams.delete('q');
		// Same page with one query parameter changed, which `resolve` cannot express — the homepage's
		// tab switcher navigates the same way for the same reason. The suppression is on its own
		// single line because the rule reports on the `goto` line, and a multi-line comment above it
		// puts the directive on the wrong one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url, { keepFocus: true, noScroll: true });
	}

	// Keyed off the URL rather than off the input, so arriving with `?q=` already set searches
	// without anybody having to type it again.
	let ran = $state('');
	$effect(() => {
		const q = query;
		if (q === ran) return;
		ran = q;
		if (q.trim().length < SEARCH_MIN_QUERY_LENGTH) {
			exercises = [];
			materials = [];
			searchedFor = '';
			return;
		}
		void run(q);
	});

	async function run(q: string) {
		loading = true;
		try {
			// Settled together: a material search failing should not decide whether the exercises
			// render, and the two are independent requests.
			const [ex, mat] = await Promise.allSettled([
				searchExercises(q, getLocale(), 24),
				searchMaterials(q)
			]);
			// Only adopt an answer that is still the current question — a slower earlier search must
			// not overwrite a newer one.
			if (q !== query) return;
			exercises = ex.status === 'fulfilled' ? ex.value : [];
			materials = mat.status === 'fulfilled' ? mat.value : [];
			searchedFor = q;
		} finally {
			if (q === query) loading = false;
		}
	}

	const total = $derived(exercises.length + materials.length);
</script>

<svelte:head>
	<title>{m.search_heading()} — {m.common_appName()}</title>
</svelte:head>

<section class="search-page">
	<h1>{m.search_heading()}</h1>

	<SearchInput
		value={query}
		placeholder={m.search_placeholder()}
		label={m.search_heading()}
		autofocus
		onsubmit={submit}
	/>

	{#if query.trim().length > 0 && query.trim().length < SEARCH_MIN_QUERY_LENGTH}
		<p class="muted">{m.search_tooShort({ count: SEARCH_MIN_QUERY_LENGTH })}</p>
	{:else if loading}
		<p class="muted">{m.common_loading()}</p>
	{:else if searchedFor && total === 0}
		<p class="muted">{m.search_noResults({ query: searchedFor })}</p>
	{:else if searchedFor}
		<p class="muted">{m.search_resultCount({ count: total })}</p>

		{#if exercises.length}
			<h2>{m.home_tab_exercises()}</h2>
			<div class="grid">
				{#each exercises as exercise (exercise.id)}
					<ExerciseCard {exercise} />
				{/each}
			</div>
		{/if}

		{#if materials.length}
			<h2>{m.home_tab_materials()}</h2>
			<div class="grid">
				{#each materials as material (material.id)}
					<MaterialCard {material} />
				{/each}
			</div>
		{/if}
	{:else}
		<p class="muted">{m.search_prompt()}</p>
	{/if}
</section>

<style lang="scss">
	.search-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	h2 {
		font-size: var(--font-size-lg);
		margin-top: var(--space-2);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}

	.muted {
		color: var(--text-secondary);
	}
</style>
