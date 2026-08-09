<script lang="ts">
	// Searching the whole site, from the one place a person arrives at.
	//
	// **Why this exists.** The homepage promised "Find the right exercise, worked and explained" and
	// then offered a button to go and browse disciplines — so the only way to find a named thing was
	// to guess which discipline held it and use the filter box on that page. On a database whose
	// whole value is that somebody else already solved the problem you are stuck on, the search has
	// to be on the front door.
	//
	// Exercises and materials first, in that order, because an exercise is what the site is for and
	// a material is the supporting thing. Then everything else the navbar's staged collapse leans on
	// this page reaching: disciplines and their branches (stage 6 replaces the Disciplines link with
	// this page's own icon, so the things that link opened must be findable here), taught courses
	// (stage 9 removes the Courses link on the same grounds), events, and tutoring listings. Kinds
	// are kept as separate, labelled sections rather than one ranked list — folding six kinds into
	// one ordering would need a relevance model this has no basis for.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { searchExercises } from '$lib/services/exercises';
	import { searchMaterials } from '$lib/services/materials';
	import { getCourses } from '$lib/services/course';
	import { getEvents } from '$lib/services/events';
	import { getServices } from '$lib/services/tutoring';
	import { getDisciplines, getAllBranches } from '$lib/services/taxonomy';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import CourseCard from '$lib/components/course/CourseCard.svelte';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';
	import EventCard from '$lib/components/event/EventCard.svelte';
	import SearchInput from '$lib/components/shared/SearchInput.svelte';
	import type { Branch, Discipline, Material, ResolvedExercise, Service } from '$lib/types';
	import type { Course } from '$lib/types/course';
	import type { EdmatEvent } from '$lib/types/event';
	import { SEARCH_MIN_QUERY_LENGTH } from '$lib/utils/textInput';

	let exercises = $state<ResolvedExercise[]>([]);
	let materials = $state<Material[]>([]);
	let disciplines = $state<Discipline[]>([]);
	let branches = $state<Branch[]>([]);
	let courses = $state<Course[]>([]);
	let events = $state<EdmatEvent[]>([]);
	let services = $state<Service[]>([]);
	let loading = $state(false);
	let searchedFor = $state('');

	// The same gate every other surface for these features uses (`Header.svelte`'s `can`): a killed
	// feature must not resurface through search, and a moderator still sees it to manage it.
	const can = (key: Parameters<typeof featureFlagsStore.isEnabled>[0]) =>
		featureFlagsStore.isEnabled(key) || authStore.isModerator;
	let canClassroom = $derived(can('classroom'));
	let canTutoring = $derived(can('tutoring'));
	let canEvents = $derived(can('events'));

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
			disciplines = [];
			branches = [];
			courses = [];
			events = [];
			services = [];
			searchedFor = '';
			return;
		}
		void run(q);
	});

	/** Disciplines and branches are a handful of rows the taxonomy pages already fetch whole, so
	 * they are filtered here rather than given a backend `?q=` of their own — a name/description
	 * `includes` over a bounded, already-served list, not a second search implementation. */
	function matches(q: string, ...texts: string[]): boolean {
		const needle = q.toLowerCase();
		return texts.some((t) => t.toLowerCase().includes(needle));
	}

	async function run(q: string) {
		loading = true;
		try {
			// Settled together: one kind's search failing should not decide whether the others
			// render, and they are independent requests. A killed feature's kind is never asked for
			// at all — the gate must hold on the request, not only on the rendering.
			const [ex, mat, disc, br, crs, ev, srv] = await Promise.allSettled([
				searchExercises(q, getLocale(), 24),
				searchMaterials(q),
				getDisciplines(),
				getAllBranches(),
				canClassroom ? getCourses({ q }) : Promise.resolve([]),
				canEvents ? getEvents({ q }) : Promise.resolve([]),
				canTutoring ? getServices(undefined, { q }) : Promise.resolve([])
			]);
			// Only adopt an answer that is still the current question — a slower earlier search must
			// not overwrite a newer one.
			if (q !== query) return;
			exercises = ex.status === 'fulfilled' ? ex.value : [];
			materials = mat.status === 'fulfilled' ? mat.value : [];
			disciplines =
				disc.status === 'fulfilled'
					? disc.value.filter((d) => matches(q, d.name, d.description))
					: [];
			branches =
				br.status === 'fulfilled' ? br.value.filter((b) => matches(q, b.name, b.description)) : [];
			courses = crs.status === 'fulfilled' ? crs.value : [];
			events = ev.status === 'fulfilled' ? ev.value : [];
			services = srv.status === 'fulfilled' ? srv.value : [];
			searchedFor = q;
		} finally {
			if (q === query) loading = false;
		}
	}

	const total = $derived(
		exercises.length +
			materials.length +
			disciplines.length +
			branches.length +
			courses.length +
			events.length +
			services.length
	);
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

		{#if disciplines.length || branches.length}
			<h2>{m.nav_browse()}</h2>
			<!-- Plain link rows rather than cards: a discipline or branch is a place to go, not a
			     content item, and its browse page is one click away. -->
			<ul class="taxonomy-hits">
				{#each disciplines as discipline (discipline.id)}
					<li>
						<a href={resolve('/disciplines/[discipline]', { discipline: discipline.id })}>
							{discipline.name}
						</a>
					</li>
				{/each}
				{#each branches as branch (branch.id)}
					<li>
						<a href={resolve('/branches/[branch]', { branch: branch.id })}>{branch.name}</a>
					</li>
				{/each}
			</ul>
		{/if}

		{#if courses.length}
			<h2>{m.home_tab_courses()}</h2>
			<div class="grid">
				{#each courses as course (course.id)}
					<CourseCard {course} />
				{/each}
			</div>
		{/if}

		{#if events.length}
			<h2>{m.home_tab_events()}</h2>
			<div class="grid">
				{#each events as event (event.id)}
					<EventCard {event} />
				{/each}
			</div>
		{/if}

		{#if services.length}
			<h2>{m.home_tab_tutoring()}</h2>
			<div class="grid">
				{#each services as service (service.id)}
					<ServiceCard {service} />
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

	.taxonomy-hits {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		a {
			display: inline-block;
			padding: var(--space-1) var(--space-3);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			color: var(--text-primary);
			&:hover {
				background: var(--bg-surface-alt);
			}
		}
	}
</style>
