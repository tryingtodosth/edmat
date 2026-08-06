<script lang="ts">
	// Browsing courses people are running, at `/courses` — the route the taxonomy used to hold for
	// its przedmiot rows, which are now `/branches/[branch]`.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getCourses } from '$lib/services/course';
	import { authStore } from '$lib/state/auth.svelte';
	import type { Course } from '$lib/types/course';
	import CourseCard from '$lib/components/course/CourseCard.svelte';

	let courses = $state<Course[]>([]);
	let loading = $state(true);
	let failed = $state(false);
	let openOnly = $state(false);

	async function load() {
		loading = true;
		failed = false;
		try {
			courses = await getCourses({ openOnly });
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
		<p class="status">{m.course_browseEmpty()}</p>
	{:else}
		<div class="grid">
			{#each courses as course (course.id)}
				<CourseCard {course} />
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
