<script lang="ts">
	import { contentLocalesStore } from '$lib/state/contentLocales.svelte';
	import HiddenLanguagesNotice from '$lib/components/shared/HiddenLanguagesNotice.svelte';
	import AudienceChips from '$lib/components/shared/AudienceChips.svelte';
	import { audienceFilterStore } from '$lib/state/audienceFilter.svelte';
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
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import SearchInput from '$lib/components/shared/SearchInput.svelte';
	import type { Branch, Material, ResolvedExercise, Service } from '$lib/types';
	import type { Course } from '$lib/types/course';
	import type { EdmatEvent } from '$lib/types/event';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { localizedPath } from '$lib/utils/localizedPath';
	import { getRecentExercises, getTopRatedExercises } from '$lib/services/exercises';
	import { browseMaterials } from '$lib/services/materials';
	import { getCourses } from '$lib/services/course';
	import { getServices } from '$lib/services/tutoring';
	import { getEvents } from '$lib/services/events';
	import { getBranchById } from '$lib/services/taxonomy';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import Loading from '$lib/components/shared/Loading.svelte';
	import { getActivityFeed } from '$lib/services/activity';
	import type { FeedItem } from '$lib/types';
	import ActivityRow from '$lib/components/activity/ActivityRow.svelte';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import CourseCard from '$lib/components/course/CourseCard.svelte';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';
	import EventCard from '$lib/components/event/EventCard.svelte';
	import ConceptCard from '$lib/components/concept/ConceptCard.svelte';
	import { getConcepts } from '$lib/services/concepts';
	import type { ConceptListRow } from '$lib/types/concept';
	import StartHere from '$lib/components/home/StartHere.svelte';

	type TabId =
		'exercises' | 'materials' | 'branches' | 'concepts' | 'tutoring' | 'events' | 'activity';

	// Each tab names the flag that governs its content, or `null` for the two that are always there.
	// A tab whose feature a moderator has killed is not rendered at all — a tab strip that opens onto
	// "this feature is unavailable" is a link to a dead end, which is precisely what the kill switch
	// exists to remove.
	const TABS: {
		id: TabId;
		label: () => string;
		flag: 'courses' | 'concepts' | 'tutoring' | 'events' | null;
	}[] = [
		{ id: 'exercises', label: () => m.home_tab_exercises(), flag: null },
		{ id: 'materials', label: () => m.home_tab_materials(), flag: null },
		// Next to the two content tabs it belongs with: a concept is the thing an exercise and a
		// material are ABOUT, so it reads as a third way into the same corpus rather than as one
		// more feature.
		{ id: 'concepts', label: () => m.home_tab_concepts(), flag: 'concepts' }, // "Concepts"
		{ id: 'branches', label: () => m.home_tab_courses(), flag: 'courses' },
		{ id: 'tutoring', label: () => m.home_tab_tutoring(), flag: 'tutoring' },
		{ id: 'events', label: () => m.home_tab_events(), flag: 'events' },
		// Deliberately last, deliberately near-placeholder (an owner decision alongside the
		// solution-pool feature): the newest public actions across the site, to be grown later.
		{ id: 'activity', label: () => m.home_tab_activity(), flag: null }
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
	// The `browser` guard is what lets this page be prerendered (see +page.ts). A prerendered page is
	// rendered once, at build time, for a URL that by definition has no query string — so SvelteKit
	// throws rather than let a build silently bake in one arbitrary `?tab=` answer as if it were
	// everyone's. Returning the default there is the honest answer to "which tab did they ask for?"
	// when nobody has asked yet.
	//
	// Nothing is lost by it: this is `$derived`, not state latched at mount, so the moment the page
	// hydrates in a real browser the real URL is read and a `?tab=events` link lands on Events. That
	// is the same frame in which the tabs' own content arrives anyway.
	let active = $derived.by((): TabId => {
		if (!browser) return 'exercises';
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

	/** Off to the search page with whatever was typed. A URL object rather than a string built onto
	 * `resolve()`, matching how the tab switcher above navigates — `resolve` cannot express "this
	 * route, with a query parameter". */
	function goToSearch(query: string) {
		const trimmed = query.trim();
		const url = new URL(resolve('/search'), page.url);
		if (trimmed) url.searchParams.set('q', trimmed);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above, then given a query parameter
		goto(url);
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
	let activity = $state<FeedItem[]>([]);
	let concepts = $state<ConceptListRow[]>([]);

	let loaded = $state<Record<string, boolean>>({});
	// The band chips narrow every list, and a tab fetched before the chips changed is stale. Reset
	// the per-tab cache and refetch the open tab — `untrack` so the effect depends on the bands only.
	let lastBands = audienceFilterStore.param + '|' + contentLocalesStore.param;
	$effect(() => {
		const bands = audienceFilterStore.param + '|' + contentLocalesStore.param;
		if (bands === lastBands) return;
		lastBands = bands;
		untrack(() => {
			loaded = {};
			loading = {};
			void loadTab(active);
		});
	});
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
			} else if (id === 'concepts') {
				// Most recently updated rather than alphabetical: the hub's own letter strip is where
				// somebody goes looking for a name they already know, and a home tab is for what has
				// been written lately.
				concepts = await getConcepts({ sort: 'updated', limit: 12 });
			} else if (id === 'activity') {
				activity = await getActivityFeed({ limit: 10 });
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
	// `untrack` is load-bearing: `loadTab` reads and writes `loading`/`loaded`/`failed` before its
	// first `await`, and $effect tracks every state read/write made during its synchronous run,
	// including inside a called function — so without this, the effect ends up depending on `loading`
	// too, and its own synchronous write to `loading` (inside `loadTab`) immediately reruns it, firing
	// the tab's fetch in an infinite loop. Only `active` should ever trigger this effect.
	$effect(() => {
		const id = active;
		untrack(() => loadTab(id));
	});
</script>

<!-- Named like every other page, so the tab reads "EdMat: Home" rather than a bare "EdMat" that a
     row of open tabs cannot be told apart by. -->
<PageHead title={m.common_home()} description={m.seo_home_description()} />

<div class="page">
	<section class="hero">
		<!-- The hero is the mission (owner, 2026-10-17: "change our homepage to follow our mission
		     statement of sth like 'let's cooperate on education materials'"), in the owner's own
		     2026-10-14 words for the organisation's page: an open place to work together on educational
		     materials — the community builds them, every change is visible, every solution has a person
		     who stands behind it. Until then the heading said "Learn, practise, and ask", which described
		     a catalogue to consume; this describes a thing to take part in. The three clauses are drawn
		     below the doors as a static strip, each linking to the page where that clause is TRUE
		     rather than to a page that merely repeats it. -->
		<h1>{m.home_hero_title()}</h1>
		<!-- "Let's work together on educational materials." -->
		<p>{m.home_hero_subtitle()}</p>
		<!-- Finding a named thing is still the first thing most visitors come for — on a database whose
		     whole value is that somebody already solved the problem you are stuck on, the search belongs
		     on the front door. Browse stays, as the answer to the other question ("I do not know what I
		     am looking for yet"), as a quiet link rather than the only way in. -->
		<div class="hero__search">
			<SearchInput
				label={m.search_heading()}
				placeholder={m.search_placeholder()}
				onsubmit={goToSearch}
			/>
		</div>
		<!-- Three doors, in the order the mission puts them: look, add, ask. "Add an exercise" is the
		     mission's own verb and goes to /submit behind `exercise_submissions`, the same switch the
		     header's Add… menu reads for it (house rule 3). Asking is posting a question into a tag
		     (WP15, 2026-10-15), behind `posts` like every other way in. Both stores fail open before
		     the flags load, like every gated link; a moderator keeps every door. -->
		<p class="hero__links">
			<a class="hero__browse" href={resolve('/disciplines')}>{m.home_hero_cta()}</a>
			{#if featureFlagsStore.isEnabled('exercise_submissions') || authStore.isModerator}
				<a class="hero__browse" href={resolve('/submit')}>{m.home_hero_contribute()}</a>
				<!-- "Add an exercise" -->
			{/if}
			{#if featureFlagsStore.isEnabled('posts') || authStore.isModerator}
				<a class="hero__browse" href={resolve('/ask')}>{m.ask_heroCta()}</a>
				<!-- "Ask a question" -->
			{/if}
		</p>
		<!-- The mission's three clauses. Static and prerendered with the hero, like `StartHere` below:
		     every target is a standing page no kill switch removes — /about is the organisation's own
		     page where the sentence was written, /activity is the public-by-construction log (house
		     rule 9) that makes "every change is visible" a fact, /levels is the trust system that names
		     who stands behind a solution. -->
		<ul class="hero__mission" aria-label={m.home_mission_label()}>
			<!-- "How EdMat works" -->
			<li>
				<a href={resolve('/about')} data-mission="community">
					<strong>{m.home_mission_community_title()}</strong>
					<!-- "The community builds it" -->
					<span>{m.home_mission_community_text()}</span>
				</a>
			</li>
			<li>
				<a href={resolve('/activity')} data-mission="visible">
					<strong>{m.home_mission_visible_title()}</strong>
					<!-- "Every change is visible" -->
					<span>{m.home_mission_visible_text()}</span>
				</a>
			</li>
			<li>
				<a href={resolve('/levels')} data-mission="owner">
					<strong>{m.home_mission_owner_title()}</strong>
					<!-- "Every solution has a person behind it" -->
					<span>{m.home_mission_owner_text()}</span>
				</a>
			</li>
		</ul>
		<div class="hero__audience"><AudienceChips /></div>
		<HiddenLanguagesNotice path="/exercises/" />
	</section>

	<!-- Three doors for somebody who does not know yet what this site is: the five-minute chapter,
	     the showcase, or straight in. Static, prerendered with the hero, and dismissible (it can only
	     collapse after paint, never appear). See the component. -->
	<StartHere />

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
			<!-- A card-shaped skeleton, not a line of text: it reserves the grid's height, so the footer
			     does not leap down when the cards arrive (PageSpeed's whole CLS score was that leap). -->
			<Loading variant="card" count={6} />
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
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call so a localized route renders its Polish address; the rule only sees a bare `resolve()` without type-aware linting, which this project does not run. See lib/utils/localizedPath.ts. -->
					<a href={localizedPath(resolve('/materials'))}>{m.home_seeAll()}</a>
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
		{:else if active === 'concepts'}
			<section class="section">
				<div class="section__head">
					<h2>{m.home_concepts_heading()}</h2>
					<!-- "Recently written about" -->
					<a href={resolve('/concepts')}>{m.home_seeAll()}</a>
				</div>
				{#if concepts.length === 0}
					<p class="status">{m.home_noResults()}</p>
				{:else}
					<div class="grid">
						{#each concepts as concept (concept.id)}
							<ConceptCard {concept} />
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
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call so a localized route renders its Polish address; the rule only sees a bare `resolve()` without type-aware linting, which this project does not run. See lib/utils/localizedPath.ts. -->
					<a href={localizedPath(resolve('/tutoring'))}>{m.home_seeAll()}</a>
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
		{:else if active === 'activity'}
			<section class="section">
				<div class="section__head">
					<h2>{m.home_activity_heading()}</h2>
					<a href={resolve('/activity')}>{m.home_seeAll()}</a>
				</div>
				{#if activity.length === 0}
					<p class="status">{m.home_noResults()}</p>
				{:else}
					<div class="activity">
						{#each activity as item (item.id)}
							<ActivityRow {item} />
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

	.activity {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.hero__search {
		width: min(100%, 34rem);
		margin: 0 auto;
	}

	.hero__audience {
		margin-top: 1rem;
	}
	.hero__browse {
		font-size: var(--font-size-sm);
		color: var(--accent);
		font-weight: 600;
	}
	.hero__links {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2) var(--space-4);
	}

	// The mission strip: three small cards on a wide screen, a plain stacked list on a phone — the
	// hero is the first screen a visitor sees and the card chrome is what would push the tabs
	// below the fold there. `--bg-surface` rather than the wash: the cards sit on the hero's
	// transparent tail and need their own ground in dark mode.
	.hero__mission {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		width: min(100%, 52rem);
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-3);
		text-align: left;
		@media (max-width: 720px) {
			grid-template-columns: 1fr;
			gap: var(--space-2);
		}
	}
	.hero__mission a {
		@include mix.focus-ring;
		display: block;
		height: 100%;
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		color: inherit;
		text-decoration: none;
		&:hover {
			border-color: var(--accent);
		}
		&:hover strong {
			color: var(--accent);
		}
		// The plain list: no border, no ground, a thin accent rule on the left in place of the card, so
		// three items cost three short paragraphs of height rather than three boxes.
		@media (max-width: 720px) {
			padding: 0 0 0 var(--space-3);
			border: 0;
			border-left: 2px solid var(--accent-soft);
			border-radius: 0;
			background: none;
			&:hover {
				border-left-color: var(--accent);
			}
		}
	}
	.hero__mission strong {
		display: block;
		font-size: var(--font-size-sm);
		margin-bottom: var(--space-1);
	}
	.hero__mission span {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	.hero {
		position: relative;
		isolation: isolate;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-6) 0 var(--space-3);
		text-align: center;
		align-items: center;
	}
	// The one wash. Bounded to the hero and present on one route, so it says "you are at the front
	// door" — the brand's own soft tint, not a warning-adjacent peach. Fades out by 70% of the
	// ellipse, above the audience chips and the hidden-languages notice, which are INSIDE .hero and
	// sit on its transparent tail. Measured at the centre: light 14.85 / 5.96 / 5.10 (text-primary /
	// text-secondary / the browse link), dark 8.91 / 5.12 / 5.00. High contrast hides it. The
	// 2026-10-08 full bleed below does not move those: it changes where the wash ENDS, not the tint
	// at its centre, which samples the same rgb(214,233,233) light / rgb(27,67,67) dark either way.
	.hero::before {
		content: '';
		position: absolute;
		// Full bleed, because a wash that stops where the content column stops is not a wash. The
		// ellipse is centred at 28% of the box and reaches 36% of its height, so bounded by `.hero`
		// it was cut off flat 8% above its own centre line — a straight horizontal edge across the
		// page immediately under the header — and bounded by `.page` it ended at 1100px on any
		// wider window. So: up over `.page`'s own top padding, and out to both window edges.
		// `50% - 50vw` is the full-bleed idiom (50% of this box's width is its own half, 50vw the
		// window's, and the box is centred). `vw` counts the scrollbar, so the handful of pixels of
		// overhang is clipped by `.app-main`'s `overflow-x: clip` — see `+layout.svelte`, which
		// explains why that is `clip` and not `hidden` — rather than putting a horizontal scrollbar
		// on the home page.
		inset-block: calc(-1 * var(--space-4)) 0;
		inset-inline: calc(50% - 50vw);
		z-index: -1;
		pointer-events: none;
		// The horizontal radius is a length now, not the old `60%`: measured against a 100vw box a
		// percentage grows with the window (1536px on a 2560px monitor) and flattens the glow into a
		// band across the top of the page. 40rem is what 60% of the 1100px column already came to,
		// so the shape over the column is the one the colour pass measured — it simply no longer
		// stops at the column's edge. The vertical radius stays a percentage: it should follow the
		// hero's own height, which is what it is lighting.
		background: radial-gradient(ellipse 40rem 50% at 50% 28%, var(--hero-wash) 0%, transparent 72%);
	}
	:global(:root[data-contrast='high']) .hero::before {
		display: none;
	}
	.hero h1 {
		font-size: var(--font-size-xl);
		max-width: 600px;
	}
	.hero p {
		color: var(--text-secondary);
		max-width: 560px;
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
		// On a phone, tall enough that the footer starts below the fold while a tab is still loading:
		// the single-column cards that replace the skeleton are taller than it, and the footer moving
		// DOWN on screen was this page's entire layout-shift score. A shift that happens off-screen is
		// not one. Not on wide screens — there the multi-column skeleton already matches the cards'
		// height, and a forced minimum would only open a gap above the footer.
		@media (max-width: 720px) {
			min-height: 70vh;
		}
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
