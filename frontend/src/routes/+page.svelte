<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Course, ResolvedExercise } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getRecentExercises, getTopRatedExercises } from '$lib/services/exercises';
	import { getCourseById } from '$lib/services/taxonomy';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';

	let topRated = $state<ResolvedExercise[]>([]);
	let recent = $state<ResolvedExercise[]>([]);
	let coursesById = $state<Record<string, Course>>({});
	let loading = $state(true);

	onMount(async () => {
		const locale = getLocale();
		const [tr, rc] = await Promise.all([
			getTopRatedExercises(locale, 6),
			getRecentExercises(locale, 6)
		]);
		topRated = tr;
		recent = rc;
		const courseIds = [...new Set([...tr, ...rc].map((e) => e.courseId))];
		const courses = await Promise.all(courseIds.map((id) => getCourseById(id)));
		const map: Record<string, Course> = {};
		for (const c of courses) if (c) map[c.id] = c;
		coursesById = map;
		loading = false;
	});
</script>

<svelte:head>
	<title>{m.common_appName()}</title>
</svelte:head>

<div class="page">
	<section class="hero">
		<h1>{m.home_hero_title()}</h1>
		<p>{m.home_hero_subtitle()}</p>
		<a class="cta" href={resolve('/fields')}>{m.home_hero_cta()}</a>
	</section>

	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else}
		<section class="section">
			<h2>{m.home_topRated_heading()}</h2>
			{#if topRated.length === 0}
				<p class="empty">{m.home_noResults()}</p>
			{:else}
				<div class="grid">
					{#each topRated as exercise (exercise.id)}
						<ExerciseCard {exercise} courseName={coursesById[exercise.courseId]?.name} />
					{/each}
				</div>
			{/if}
		</section>

		<section class="section">
			<h2>{m.home_recent_heading()}</h2>
			<div class="grid">
				{#each recent as exercise (exercise.id)}
					<ExerciseCard {exercise} courseName={coursesById[exercise.courseId]?.name} />
				{/each}
			</div>
		</section>
	{/if}
</div>

<style lang="scss">
	@use '../lib/styles/mixins' as mix;

	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.hero {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-6) 0;
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
	.section h2 {
		font-size: var(--font-size-lg);
		margin-bottom: var(--space-3);
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
