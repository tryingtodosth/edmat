<script lang="ts">
	// Two lists, not one merged one: running a course and taking part in it are different jobs with
	// different next actions, and a single list would make somebody scan for which of the two each
	// row is before they could act on it.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getMyParticipation, getMyTeaching } from '$lib/services/course';
	import { authStore } from '$lib/state/auth.svelte';
	import type { Course } from '$lib/types/course';
	import CourseCard from '$lib/components/course/CourseCard.svelte';

	let teaching = $state<Course[]>([]);
	let participating = $state<Course[]>([]);
	let loading = $state(true);
	let failed = $state(false);

	let loaded = $state(false);
	$effect(() => {
		if (loaded || !authStore.isAuthenticated) return;
		loaded = true;
		Promise.all([getMyTeaching(), getMyParticipation()])
			.then(([mine, joined]) => {
				teaching = mine;
				participating = joined;
			})
			.catch(() => (failed = true))
			.finally(() => (loading = false));
	});
</script>

<svelte:head>
	<title>{m.course_myCourses()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<header class="head">
		<h1>{m.course_myCourses()}</h1>
		{#if authStore.isAuthenticated}
			<a class="primary" href={resolve('/courses/new')}>{m.course_runACourse()}</a>
		{/if}
	</header>

	{#if !authStore.isAuthenticated}
		<p class="status">{m.course_refusal_signIn()}</p>
		<a href={resolve('/login')}>{m.nav_login()}</a>
	{:else if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if failed}
		<p class="status">{m.common_error_generic()}</p>
	{:else}
		<section>
			<h2>{m.course_teachingHeading()}</h2>
			{#if teaching.length === 0}
				<p class="status">{m.course_teachingEmpty()}</p>
			{:else}
				<div class="grid">
					{#each teaching as course (course.id)}
						<CourseCard {course} />
					{/each}
				</div>
			{/if}
		</section>

		<section>
			<h2>{m.course_participatingHeading()}</h2>
			{#if participating.length === 0}
				<p class="status">{m.course_participatingEmpty()}</p>
			{:else}
				<div class="grid">
					{#each participating as course (course.id)}
						<CourseCard {course} />
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

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
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	h2 {
		font-size: var(--font-size-md);
		margin-bottom: var(--space-2);
	}
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.primary {
		@include mix.button-primary;
	}
	.grid {
		display: grid;
		gap: var(--space-3);
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	}
</style>
