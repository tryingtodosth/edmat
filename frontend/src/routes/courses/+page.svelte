<script lang="ts">
	// Browsing courses people are running, at `/courses` — the route the taxonomy used to hold for
	// its przedmiot rows, which are now `/branches/[branch]`.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getCourses } from '$lib/services/course';
	import { authStore } from '$lib/state/auth.svelte';
	import type { Course } from '$lib/types/course';
	import CourseCard from '$lib/components/course/CourseCard.svelte';
	import NewSinceNotice from '$lib/components/shared/NewSinceNotice.svelte';
	import SavedCopyNotice from '$lib/components/shared/SavedCopyNotice.svelte';
	import StaleRow from '$lib/components/shared/StaleRow.svelte';
	import { cachedList, type TrackedRow } from '$lib/state/cachedList.svelte';

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

	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const key = String(openOnly);
		if (key === loadedFor) return;
		loadedFor = key;
		load();
	});
</script>

<svelte:head>
	<title>{m.course_browseHeading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<header class="head">
		<div>
			<h1>{m.course_browseHeading()}</h1>
			<p class="lead">{m.course_browseLead()}</p>
		</div>
		{#if authStore.isAuthenticated}
			<div class="actions">
				<a class="secondary" href={resolve('/courses/mine')}>{m.course_myCourses()}</a>
				<a class="primary" href={resolve('/courses/new')}>{m.course_runACourse()}</a>
			</div>
		{/if}
	</header>

	<label class="filter">
		<input type="checkbox" bind:checked={openOnly} />
		<span>{m.course_filterOpenOnly()}</span>
	</label>

	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if failed}
		<p class="status">{m.common_error_generic()}</p>
	{:else if courses.length === 0}
		<div class="empty">
			<p class="status">{m.course_browseEmpty()}</p>
			{#if authStore.isAuthenticated}
				<a class="primary" href={resolve('/courses/new')}>{m.course_runACourse()}</a>
			{:else}
				<a class="primary" href={resolve('/register')}>{m.courses_emptySignUpCta()}</a>
			{/if}
		</div>
	{:else}
		{#if offline}
			<SavedCopyNotice {savedAt} {stale} />
		{/if}
		<NewSinceNotice count={newCount} />
		<div class="grid">
			{#each courses as row (row.item.id)}
				<StaleRow confirmedAt={row.confirmedAt}>
					<CourseCard course={row.item} />
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
