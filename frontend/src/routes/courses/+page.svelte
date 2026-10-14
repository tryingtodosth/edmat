<script lang="ts">
	import HiddenLanguagesNotice from '$lib/components/shared/HiddenLanguagesNotice.svelte';
	// Browsing courses people are running, at `/courses` — the route the taxonomy used to hold for
	// its przedmiot rows, which are now `/branches/[branch]`.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getCourses } from '$lib/services/course';
	import { authStore } from '$lib/state/auth.svelte';
	// The creation gate (learning step F): "Run a course" is one of the four founding acts
	// `config/creation.py` governs, so the button is drawn only when the server says this account
	// may use it — and the sentence saying why it is missing is drawn when it may not.
	import { creationStore } from '$lib/state/creation.svelte';
	import CreationGateNote from '$lib/components/shared/CreationGateNote.svelte';
	import type { Course } from '$lib/types/course';
	import CourseCard from '$lib/components/course/CourseCard.svelte';
	import NewSinceNotice from '$lib/components/shared/NewSinceNotice.svelte';
	import SavedCopyNotice from '$lib/components/shared/SavedCopyNotice.svelte';
	import StaleRow from '$lib/components/shared/StaleRow.svelte';
	import { cachedList, type TrackedRow } from '$lib/state/cachedList.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let courses = $state<TrackedRow<Course>[]>([]);
	let loading = $state(true);
	let failed = $state(false);
	let openOnly = $state(false);
	let newCount = $state(0);
	let offline = $state(false);

	// When the network never answered, "saved copy from {when}" means the last time the server
	// actually confirmed any of this — which the rows already carry per row, so there is nothing
	// extra to store and no second clock that could disagree with the fade.
	let savedAt = $derived(
		courses.length ? Math.max(...courses.map((row) => row.confirmedAt)) : null
	);
	let stale = $derived(savedAt !== null && Date.now() - savedAt > 24 * 60 * 60 * 1000);

	async function load() {
		loading = true;
		failed = false;
		// The two filter states are cached separately: merging an open-only answer into the full list
		// would silently drop every closed course as "no longer returned by the server", which is not
		// what a checkbox means.
		const name = openOnly ? 'courses:open' : 'courses:all';
		try {
			await cachedList<Course>(
				name,
				() => getCourses({ openOnly }),
				(result) => {
					courses = result.rows;
					newCount = result.newCount;
					offline = result.offline;
					// Content is on screen the moment there is any, cached or fresh — the spinner is for
					// having nothing to show, not for "a request is in flight".
					loading = false;
				}
			);
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	// General courses by default; university/faculty versions one chip away (owner, 2026-10-14: "a
	// default/general course, and subcourses for specific universities and faculties"). Filtered
	// HERE, over the rows already loaded, rather than as new query parameters: the list is bounded
	// by construction (no pagination anywhere in this API), so a request per chip would buy nothing,
	// and the offline/saved-copy machinery above keeps working under a filter for free. The API
	// takes the same filters (`?top=`, `?kind=`, `?university=`, `?faculty=`) for anybody else.
	type View = 'general' | 'versions' | 'all';
	let view = $state<View>('general');
	let universityFilter = $state('');
	let facultyFilter = $state('');
	const fold = (text: string) => text.trim().toLowerCase();
	// The universities (and, under one, the faculties) on offer are the ones actually in the list —
	// a select of every university in Poland would mostly lead to "no results". Case-folded so "UW"
	// and "uw" are one entry, matching the backend's `__iexact`.
	function distinct(values: string[]): string[] {
		const byKey: Record<string, string> = {};
		for (const value of values)
			if (value.trim() && !byKey[fold(value)]) byKey[fold(value)] = value.trim();
		return Object.values(byKey).sort((x, y) => x.localeCompare(y));
	}
	let universityCourses = $derived(courses.filter((row) => row.item.kind === 'university'));
	let universities = $derived(distinct(universityCourses.map((row) => row.item.university)));
	let faculties = $derived(
		universityFilter
			? distinct(
					universityCourses
						.filter((row) => fold(row.item.university) === fold(universityFilter))
						.map((row) => row.item.faculty)
				)
			: []
	);
	// How many visible versions each general course has, for its card.
	let versionCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const row of courses)
			if (row.item.parent) counts[row.item.parent] = (counts[row.item.parent] ?? 0) + 1;
		return counts;
	});
	let visible = $derived(
		courses.filter((row) => {
			const c = row.item;
			if (view === 'general') return !c.parent;
			if (view === 'versions') {
				if (c.kind !== 'university') return false;
				if (universityFilter && fold(c.university) !== fold(universityFilter)) return false;
				if (facultyFilter && fold(c.faculty) !== fold(facultyFilter)) return false;
			}
			return true;
		})
	);
	function choose(next: View) {
		view = next;
		if (next !== 'versions') {
			universityFilter = '';
			facultyFilter = '';
		}
	}

	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const key = String(openOnly);
		if (key === loadedFor) return;
		loadedFor = key;
		load();
	});
</script>

<svelte:head>
	<title>{pageTitle(m.course_browseHeading())}</title>
</svelte:head>

<div class="page">
	<header class="head">
		<div>
			<h1>{m.course_browseHeading()}</h1>
			<HiddenLanguagesNotice path="/courses/" />
			<p class="lead">{m.course_browseLead()}</p>
		</div>
		{#if authStore.isAuthenticated}
			<div class="actions">
				<a class="secondary" href={resolve('/courses/mine')}>{m.course_myCourses()}</a>
				{#if creationStore.allows('course')}
					<a class="primary" href={resolve('/courses/new')}>{m.course_runACourse()}</a>
				{/if}
			</div>
		{/if}
	</header>

	<CreationGateNote kind="course" />

	<div class="filters">
		<div class="kind-chips" role="group" aria-label={m.course_filter_kindLabel()}>
			<!-- "Show" -->
			<button
				type="button"
				class="chip"
				aria-pressed={view === 'general'}
				onclick={() => choose('general')}
			>
				{m.course_filter_general()}
				<!-- "General courses" -->
			</button>
			<button
				type="button"
				class="chip"
				aria-pressed={view === 'versions'}
				onclick={() => choose('versions')}
			>
				{m.course_filter_versions()}
				<!-- "University versions" -->
			</button>
			<button
				type="button"
				class="chip"
				aria-pressed={view === 'all'}
				onclick={() => choose('all')}
			>
				{m.course_filter_kindAll()}
				<!-- "All" -->
			</button>
		</div>
		{#if universities.length > 0}
			<select
				class="university-select"
				bind:value={universityFilter}
				onchange={() => {
					// A university reaches the versions, so it switches the view to them.
					facultyFilter = '';
					if (universityFilter) view = 'versions';
				}}
				aria-label={m.course_form_university()}
			>
				<!-- "University" -->
				<option value="">{m.course_filter_universityAll()}</option>
				<!-- "Any university" -->
				{#each universities as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
		{/if}
		{#if faculties.length > 0}
			<select
				class="university-select"
				bind:value={facultyFilter}
				aria-label={m.course_filter_faculty()}
			>
				<!-- "Faculty" -->
				<option value="">{m.course_filter_facultyAll()}</option>
				<!-- "Any faculty" -->
				{#each faculties as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
		{/if}
		<label class="filter">
			<input type="checkbox" bind:checked={openOnly} />
			<span>{m.course_filterOpenOnly()}</span>
		</label>
	</div>

	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if failed}
		<p class="status">{m.common_error_generic()}</p>
	{:else if courses.length === 0}
		<div class="empty">
			<p class="status">{m.course_browseEmpty()}</p>
			{#if authStore.isAuthenticated}
				{#if creationStore.allows('course')}
					<a class="primary" href={resolve('/courses/new')}>{m.course_runACourse()}</a>
				{/if}
			{:else}
				<a class="primary" href={resolve('/register')}>{m.courses_emptySignUpCta()}</a>
			{/if}
		</div>
	{:else}
		{#if offline}
			<SavedCopyNotice {savedAt} {stale} />
		{/if}
		<NewSinceNotice count={newCount} />
		{#if visible.length === 0}
			<p class="status">{m.course_filter_noMatch()}</p>
			<!-- "No course matches these filters." -->
		{/if}
		<div class="grid">
			{#each visible as row (row.item.id)}
				<StaleRow confirmedAt={row.confirmedAt}>
					<CourseCard course={row.item} versionCount={versionCounts[row.item.id] ?? 0} />
				</StaleRow>
			{/each}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 900px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		align-items: flex-start;
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.lead,
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.primary {
		@include mix.button-primary;
	}
	.secondary {
		@include mix.focus-ring;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		color: inherit;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.kind-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.chip {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-full, 999px);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
		&[aria-pressed='true'] {
			@include mix.selected-soft;
		}
	}
	.university-select {
		font: inherit;
		font-size: var(--font-size-sm);
		padding: var(--space-1) var(--space-2);
		max-width: 100%;
	}
	.filter {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.grid {
		display: grid;
		gap: var(--space-3);
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	}
</style>
