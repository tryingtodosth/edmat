<script lang="ts">
	// Posting a volunteering offer. Signed-in only, and closed to an under-16 — the backend
	// refuses with the word `minor` (`needs/rules.py`, the same refusal a tutoring listing makes),
	// and this page says the sentence rather than showing a generic failure: a refusal carries its
	// reason (house rule 6).
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import type { VolunteeringOfferDraft } from '$lib/types/need';
	import { createVolunteeringOffer } from '$lib/services/needs';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import OfferForm from '$lib/components/needs/OfferForm.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let refusal = $state('');

	async function submit(draft: VolunteeringOfferDraft) {
		refusal = '';
		try {
			const created = await createVolunteeringOffer(draft);
			await goto(resolve('/volunteering/[id]', { id: created.id }));
		} catch (error) {
			if (error instanceof ApiError && error.status === 403) {
				refusal = m.offers_minorRefusal();
				return;
			}
			throw error;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(m.offers_newHeading())}</title>
</svelte:head>
<!-- "Offer to help" -->

<FeatureGate feature="volunteering">
	<div class="page">
		<h1>{m.offers_newHeading()}</h1>
		<p class="lead">{m.offers_newLead()}</p>
		{#if !authStore.isAuthenticated}
			<p class="status">{m.shifts_signInToSee()}</p>
		{:else}
			{#if refusal}
				<p class="refusal">{refusal}</p>
			{/if}
			<OfferForm onSubmit={submit} onCancel={() => goto(resolve('/volunteering'))} />
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 48rem;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		margin: 0;
	}
	.lead {
		color: var(--text-secondary);
		margin: 0;
		max-width: 60ch;
	}
	.status {
		color: var(--text-secondary);
	}
	.refusal {
		color: var(--status-danger);
		max-width: 60ch;
	}
</style>
