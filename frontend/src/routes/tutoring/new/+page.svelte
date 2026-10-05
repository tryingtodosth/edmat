<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { localizedPath } from '$lib/utils/localizedPath';
	import type { Branch, ServiceDraft } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	// The creation gate (learning step F): somebody can still reach this address by typing it or
	// following an old link, so the page says WHY rather than showing a form the server would
	// refuse — the `REFUSAL[reason]()` idiom, in a component because eight surfaces need it.
	import { creationStore } from '$lib/state/creation.svelte';
	import CreationGateNote from '$lib/components/shared/CreationGateNote.svelte';
	import { getAllBranches } from '$lib/services/taxonomy';
	import { createService } from '$lib/services/tutoring';
	import ServiceForm from '$lib/components/service/ServiceForm.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let branches = $state<Branch[]>([]);

	async function init() {
		branches = await getAllBranches();
	}
	init();

	async function handleSubmit(draft: ServiceDraft) {
		await createService(draft);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call so a localized route renders its Polish address; the rule only sees a bare `resolve()` without type-aware linting, which this project does not run. See lib/utils/localizedPath.ts.
		goto(localizedPath(resolve('/tutoring')));
	}
</script>

<svelte:head>
	<title>{pageTitle(m.services_newListing())}</title>
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
		{:else if creationStore.reasonFor('service') !== null}
			<CreationGateNote kind="service" />
		{:else if !creationStore.allows('service')}
			<p class="subtitle">{m.common_loading()}</p>
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
