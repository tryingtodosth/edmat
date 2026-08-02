<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { createCourse } from '$lib/services/classroom';
	import { authStore } from '$lib/state/auth.svelte';
	import type { TaughtCourseDraft } from '$lib/types/classroom';
	import CourseForm from '$lib/components/classroom/CourseForm.svelte';

	let submitting = $state(false);
	let error = $state('');

	async function submit(draft: TaughtCourseDraft) {
		submitting = true;
		error = '';
		try {
			const created = await createCourse(draft);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- internal route with a dynamic id segment
			await goto(`${resolve('/classroom')}/${created.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : m.common_error_generic();
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.classroom_runACourse()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.classroom_runACourse()}</h1>
	{#if !authStore.isAuthenticated}
		<p class="status">{m.classroom_refusal_signIn()}</p>
		<a href={resolve('/login')}>{m.nav_login()}</a>
	{:else}
		<p class="lead">{m.classroom_newLead()}</p>
		<CourseForm submitLabel={m.classroom_create()} {submitting} {error} onsubmit={submit} />
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
	.lead,
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
