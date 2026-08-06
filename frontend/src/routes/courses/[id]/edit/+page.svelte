<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getCourse, updateCourse } from '$lib/services/course';
	import type { Course, TaughtCourseDraft } from '$lib/types/course';
	import CourseForm from '$lib/components/course/CourseForm.svelte';

	let course = $state<Course | null>(null);
	let loading = $state(true);
	let submitting = $state(false);
	let error = $state('');

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		getCourse(id)
			.then((found) => (course = found ?? null))
			.finally(() => (loading = false));
	});

	async function submit(draft: TaughtCourseDraft) {
		submitting = true;
		error = '';
		try {
			await updateCourse(page.params.id!, draft);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- internal route with a dynamic id segment
			await goto(`${resolve('/courses')}/${page.params.id}`);
		} catch (e) {
			// The API refuses a cap below the number of people already admitted, and that message is
			// worth showing verbatim rather than replacing with a generic failure.
			error = e instanceof Error ? e.message : m.common_error_generic();
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.course_edit()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if !course}
		<p class="status">{m.course_notFound()}</p>
	{:else if !course.isInstructor}
		<!-- The API already refuses this; saying so here avoids presenting a form that could only
		     fail on submit. -->
		<p class="status">{m.course_refusal_notYours()}</p>
	{:else}
		<h1>{m.course_edit()}</h1>
		<CourseForm
			initial={course}
			submitLabel={m.common_save()}
			{submitting}
			{error}
			onsubmit={submit}
		/>
	{/if}
</div>

<style lang="scss">
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
