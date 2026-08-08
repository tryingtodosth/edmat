<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Branch, ServiceDraft } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { getAllBranches } from '$lib/services/taxonomy';
	import { createService } from '$lib/services/tutoring';
	import ServiceForm from '$lib/components/service/ServiceForm.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';

	let branches = $state<Branch[]>([]);

	async function init() {
		branches = await getAllBranches();
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

<FeatureGate feature="tutoring">
	<div class="page">
		<h1>{m.services_newListing()}</h1>
		<p class="subtitle">{m.services_newListingSubtitle()}</p>

		{#if authStore.restoring}
			<p class="session-restoring">{m.common_loading()}</p>
		{:else if !authStore.isAuthenticated}
			<p data-session-hidden class="login-prompt">
				<a href={resolve('/login')}>{m.services_loginRequired()}</a>
			</p>
		{:else}
			<ServiceForm {branches} onSubmit={handleSubmit} />
		{/if}
	</div>
</FeatureGate>

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
