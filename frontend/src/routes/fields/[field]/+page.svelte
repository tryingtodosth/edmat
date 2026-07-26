<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Course, Field } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getCoursesForField, getFieldById } from '$lib/services/taxonomy';
	import { getExercisesForCourse } from '$lib/services/exercises';
	import CourseCard from '$lib/components/course/CourseCard.svelte';

	let field = $state<Field | undefined>(undefined);
	let courses = $state<Course[]>([]);
	let exerciseCounts = $state<Record<string, number>>({});
	let loading = $state(true);
	let notFound = $state(false);

	async function load(fieldId: string) {
		loading = true;
		notFound = false;
		const f = await getFieldById(fieldId);
		if (!f) {
			notFound = true;
			loading = false;
			return;
		}
		field = f;
		courses = await getCoursesForField(fieldId);
		const counts: Record<string, number> = {};
		await Promise.all(
			courses.map(async (c) => {
				counts[c.id] = (await getExercisesForCourse(c.id, getLocale())).length;
			})
		);
		exerciseCounts = counts;
		loading = false;
	}

	// See routes/exercises/[id]/+page.svelte's own note on why this guard exists — an
	// id-changed check keeps a spuriously-refiring $effect idempotent instead of just hoping it
	// never refires without a real navigation.
	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.field!;
		if (id === loadedForId) return;
		loadedForId = id;
		load(id);
	});
</script>

<svelte:head>
	<title>{field?.name ?? m.common_appName()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<!-- "Breadcrumb" -->
	<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
		<a href={resolve('/fields')}>{m.common_home()}</a>
	</nav>

	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else if notFound}
		<p class="empty">{m.field_notFound()}</p>
	{:else if field}
		<header>
			<h1>{field.name}</h1>
			<p>{field.description}</p>
		</header>
		<h2>{m.field_coursesHeading()}</h2>
		<div class="grid">
			{#each courses as course (course.id)}
				<CourseCard {course} exerciseCount={exerciseCounts[course.id] ?? 0} />
			{/each}
		</div>
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
		a {
			color: var(--accent);
		}
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	header p {
		color: var(--text-secondary);
		margin-top: var(--space-1);
	}
	h2 {
		font-size: var(--font-size-lg);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.loading,
	.empty {
		color: var(--text-secondary);
	}
</style>
