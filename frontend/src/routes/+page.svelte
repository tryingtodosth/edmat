<script lang="ts">
	// The homepage used to be exercises and nothing else — top-rated and recent, and no acknowledgement
	// on the front page that this site also holds materials, branches somebody runs, people offering
	// tutoring, or (now) events. Five tabs, one per kind of thing, each showing a real listing built
	// from that feature's OWN card component rather than a homepage-specific summary card: a course on
	// the homepage should look like a course, and a second card component per kind is a second place to
	// fix every time one of them changes.
	//
	// **The selected tab is in the URL** (`?tab=`), not in component state. Three things follow from
	// that and all three were the point: a reload keeps you where you were, the browser's back button
	// steps between tabs the way a person expects, and somebody can send a link to the Events tab. A
	// query parameter rather than five routes, because these are five views of one page rather than
	// five pages — and `replaceState` would have taken the back button away again, so it is a real
	// navigation.
	//
	// **Data is fetched per tab, once, and kept.** Loading all five on first paint would make the
	// homepage five round trips slow for a visitor who only ever looks at one; re-fetching on every
	// switch would make going back and forth flicker. So each tab loads the first time it is opened
	// and is then held for the life of the page.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Branch, Material, ResolvedExercise, Service } from '$lib/types';
	import type { Course } from '$lib/types/course';
	import type { EdmatEvent } from '$lib/types/event';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getRecentExercises, getTopRatedExercises } from '$lib/services/exercises';
	import { browseMaterials } from '$lib/services/materials';
	import { getCourses } from '$lib/services/course';
	import { getServices } from '$lib/services/tutoring';
	import { getEvents } from '$lib/services/events';
	import { getBranchById } from '$lib/services/taxonomy';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import CourseCard from '$lib/components/course/CourseCard.svelte';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';
	import EventCard from '$lib/components/event/EventCard.svelte';

	type TabId = 'exercises' | 'materials' | 'branches' | 'tutoring' | 'events';

	// Each tab names the flag that governs its content, or `null` for the two that are always there.
	// A tab whose feature a moderator has killed is not rendered at all — a tab strip that opens onto
	// "this feature is unavailable" is a link to a dead end, which is precisely what the kill switch
	// exists to remove.
	const TABS: {
		id: TabId;
		label: () => string;
		flag: 'classroom' | 'tutoring' | 'events' | null;
	}[] = [
		{ id: 'exercises', label: () => m.home_tab_exercises(), flag: null },
		{ id: 'materials', label: () => m.home_tab_materials(), flag: null },
		{ id: 'branches', label: () => m.home_tab_courses(), flag: 'classroom' },
		{ id: 'tutoring', label: () => m.home_tab_tutoring(), flag: 'tutoring' },
		{ id: 'events', label: () => m.home_tab_events(), flag: 'events' }
	];

	let visibleTabs = $derived(
		TABS.filter(
			(tab) => tab.flag === null || featureFlagsStore.isEnabled(tab.flag) || authStore.isModerator
		)
	);

	// Derived from the URL on every render rather than copied into state on mount: `authStore` and the
	// flags both resolve asynchronously, and anything latched at mount here would be answering with
	// what was true before either arrived. An unknown or hidden `?tab=` falls back to exercises rather
	// than rendering nothing, so a stale link to a killed feature still lands somewhere real.
	let active = $derived.by((): TabId => {
		const asked = page.url.searchParams.get('tab') as TabId | null;
		return asked && visibleTabs.some((t) => t.id === asked) ? asked : 'exercises';
	});

	function selectTab(id: TabId) {
		// Built from the current URL rather than from `resolve('/')`, deliberately: the locale prefix
		// and any other query parameters already on the page have to survive a tab switch, and only the
		// live URL knows what they are. `resolve` cannot express "this page, with one parameter
		// changed", which is why the lint rule is suppressed here rather than worked around.
		const url = new URL(page.url);
		if (id === 'exercises') url.searchParams.delete('tab');
		else url.searchParams.set('tab', id);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- see above: same page, one query parameter changed
		goto(url, { keepFocus: true, noScroll: true });
	}

	/** Arrow-key movement between tabs, which is what makes `role="tablist"` an honest claim rather
	 * than three attributes sprinkled on some buttons: a screen reader announces this as a tab list,
	 * and a keyboard user then expects Left/Right/Home/End to work. */
	function onTabKeydown(event: KeyboardEvent) {
		const ids = visibleTabs.map((t) => t.id);
		const at = ids.indexOf(active);
		let next: number | null = null;
		if (event.key === 'ArrowRight') next = (at + 1) % ids.length;
		else if (event.key === 'ArrowLeft') next = (at - 1 + ids.length) % ids.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = ids.length - 1;
		if (next === null) return;
		event.preventDefault();
		const target = ids[next];
		selectTab(target);
		// Focus follows selection, as it must in an automatically-activated tab list — otherwise the
		// arrow key moves the panel and leaves focus behind on the tab that is no longer selected.
		document.getElementById(`tab-${target}`)?.focus();
	}

	// --- per-tab data --------------------------------------------------------------------------
	let topRated = $state<ResolvedExercise[]>([]);
	let recent = $state<ResolvedExercise[]>([]);
	let coursesById = $state<Record<string, Branch>>({});
	let materials = $state<Material[]>([]);
	let courses = $state<Course[]>([]);
	let services = $state<Service[]>([]);
	let events = $state<EdmatEvent[]>([]);

	let loaded = $state<Record<string, boolean>>({});
	let loading = $state<Record<string, boolean>>({ exercises: true });
	let failed = $state<Record<string, boolean>>({});

	async function loadTab(id: TabId) {
		if (loaded[id] || loading[id]) return;
		loading = { ...loading, [id]: true };
		failed = { ...failed, [id]: false };
		try {
			if (id === 'exercises') {
				const locale = getLocale();
				const [tr, rc] = await Promise.all([
					getTopRatedExercises(locale, 6),
					getRecentExercises(locale, 6)
				]);
				topRated = tr;
				recent = rc;
				const branchIds = [...new Set([...tr, ...rc].map((e) => e.branchId))];
				const resolved = await Promise.all(branchIds.map((cid) => getBranchById(cid)));
				const map: Record<string, Branch> = {};
				for (const c of resolved) if (c) map[c.id] = c;
				coursesById = map;
			} else if (id === 'materials') {
				materials = (await browseMaterials({ sort: 'recent' })).slice(0, 6);
			} else if (id === 'branches') {
				courses = (await getCourses({ openOnly: true })).slice(0, 6);
			} else if (id === 'tutoring') {
				services = (await getServices()).slice(0, 6);
			} else if (id === 'events') {
				events = (await getEvents({ when: 'upcoming' })).slice(0, 6);
			}
			loaded = { ...loaded, [id]: true };
		} catch {
			failed = { ...failed, [id]: true };
		} finally {
			loading = { ...loading, [id]: false };
		}
	}

	// `onMount` for the opening tab and an effect for every subsequent switch. The effect alone would
	// have worked too; loading the first one explicitly keeps that fetch from racing the feature-flags
	// request that decides which tabs exist at all.
	onMount(() => {
		loading = {};
		loadTab(active);
	});
	$effect(() => {
		loadTab(active);
	});
</script>

<svelte:head>
	<title>{m.common_appName()}</title>
</svelte:head>

<div class="page">
	<section class="hero">
		<h1>{m.home_hero_title()}</h1>
		<p>{m.home_hero_subtitle()}</p>
		<a class="cta" href={resolve('/disciplines')}>{m.home_hero_cta()}</a>
	</section>

	<!-- `tabindex="-1"` on the list itself, with the roving tabindex living on the tabs: the container
	     must be focusable for the keydown handler to be a legitimate place to put one, but focus should
	     land on a TAB, never on the strip around them. -->
	<div
		class="tabs"
		role="tablist"
		tabindex="-1"
		aria-label={m.home_tabs_label()}
		onkeydown={onTabKeydown}
	>
		{#each visibleTabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id="tab-{tab.id}"
				class="tab"
				class:tab--active={active === tab.id}
				aria-selected={active === tab.id}
				aria-controls="panel-{tab.id}"
				tabindex={active === tab.id ? 0 : -1}
				onclick={() => selectTab(tab.id)}
			>
				{tab.label()}
			</button>
		{/each}
	</div>

	<div
		class="panel"
		role="tabpanel"
		id="panel-{active}"
		aria-labelledby="tab-{active}"
		tabindex="-1"
	>
		{#if loading[active]}
			<p class="status">{m.common_loading()}</p>
		{:else if failed[active]}
			<p class="status">{m.common_error_generic()}</p>
		{:else if active === 'exercises'}
			<section class="section">
				<h2>{m.home_topRated_heading()}</h2>
				{#if topRated.length === 0}
					<p class="status">{m.home_noResults()}</p>
				{:else}
					<div class="grid">
						{#each topRated as exercise (exercise.id)}
							<ExerciseCard {exercise} courseName={coursesById[exercise.branchId]?.name} />
						{/each}
					</div>
				{/if}
			</section>
			<section class="section">
				<h2>{m.home_recent_heading()}</h2>
				<div class="grid">
					{#each recent as exercise (exercise.id)}
						<ExerciseCard {exercise} courseName={coursesById[exercise.branchId]?.name} />
					{/each}
				</div>
			</section>
		{:else if active === 'materials'}
			<section class="section">
				<div class="section__head">
					<h2>{m.home_materials_heading()}</h2>
					<a href={resolve('/materials')}>{m.home_seeAll()}</a>
				</div>
				{#if materials.length === 0}
					<p class="status">{m.home_noResults()}</p>
				{:else}
					<div class="grid">
						{#each materials as material (material.id)}
							<MaterialCard {material} />
						{/each}
					</div>
				{/if}
			</section>
		{:else if active === 'branches'}
			<section class="section">
				<div class="section__head">
					<h2>{m.home_courses_heading()}</h2>
					<a href={resolve('/courses')}>{m.home_seeAll()}</a>
				</div>
				{#if courses.length === 0}
					<p class="status">{m.course_browseEmpty()}</p>
				{:else}
					<div class="grid">
						{#each courses as course (course.id)}
							<CourseCard {course} />
						{/each}
					</div>
				{/if}
			</section>
		{:else if active === 'tutoring'}
			<section class="section">
				<div class="section__head">
					<h2>{m.home_tutoring_heading()}</h2>
					<a href={resolve('/services')}>{m.home_seeAll()}</a>
				</div>
				{#if services.length === 0}
					<p class="status">{m.home_noResults()}</p>
				{:else}
					<div class="grid">
						{#each services as service (service.id)}
							<ServiceCard {service} />
						{/each}
					</div>
				{/if}
			</section>
		{:else if active === 'events'}
			<section class="section">
				<div class="section__head">
					<h2>{m.home_events_heading()}</h2>
					<a href={resolve('/events')}>{m.home_seeAll()}</a>
				</div>
				{#if events.length === 0}
					<p class="status">{m.events_browseEmpty()}</p>
				{:else}
					<div class="grid">
						{#each events as event (event.id)}
							<EventCard {event} />
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</div>
</div>

<style lang="scss">
	@use '../lib/styles/mixins' as mix;

	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.hero {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-6) 0 var(--space-3);
		text-align: center;
		align-items: center;
	}
	.hero h1 {
		font-size: var(--font-size-xl);
		max-width: 600px;
	}
	.hero p {
		color: var(--text-secondary);
		max-width: 560px;
	}
	.cta {
		@include mix.button-primary;
		margin-top: var(--space-2);
	}
	.tabs {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
		border-bottom: 1px solid var(--border-color);
	}
	.tab {
		@include mix.focus-ring;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text-secondary);
		cursor: pointer;
		&:hover {
			color: var(--text-primary);
		}
	}
	.tab--active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		// Focusable so activating a tab can move a keyboard user into the content, but without a ring:
		// the tab that put them here already showed one, and a ring around a whole page section is
		// noise rather than information.
		outline: none;
	}
	.section__head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
		a {
			font-size: var(--font-size-sm);
			color: var(--text-secondary);
		}
	}
	.section h2 {
		font-size: var(--font-size-lg);
		margin-bottom: var(--space-3);
	}
	.section__head h2 {
		margin-bottom: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.status {
		color: var(--text-secondary);
	}
</style>
