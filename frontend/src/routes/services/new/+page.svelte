<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Course, ServiceDraft } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { getAllCourses } from '$lib/services/taxonomy';
	import { createService } from '$lib/services/tutoring';
	import ServiceForm from '$lib/components/service/ServiceForm.svelte';

	let courses = $state<Course[]>([]);

	async function init() {
		courses = await getAllCourses();
	}
	init();

	async function handleSubmit(draft: ServiceDraft) {
		await createService(draft);
		goto(resolve('/services'));
	}
</script>

<svelte:head>
	<title>{m.services_newListing()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.services_newListing()}</h1>
	<p class="subtitle">{m.services_newListingSubtitle()}</p>

	{#if !authStore.isAuthenticated}
		<p class="login-prompt"><a href={resolve('/login')}>{m.services_loginRequired()}</a></p>
	{:else}
		<ServiceForm {courses} onSubmit={handleSubmit} />
	{/if}
</div>

<style lang="scss">
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.login-prompt a {
		color: var(--accent);
		font-weight: 600;
	}
</style>
