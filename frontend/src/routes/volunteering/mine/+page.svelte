<script lang="ts">
	// Your own offers, paused and closed ones included — the board shows only `open`, which is the
	// point of pausing one. `?mine=true` is what widens the queryset server-side
	// (`needs/rules.py: public_offers` already lets you see your own; the flag is what stops the
	// public list showing them to you as if they were live).
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import type { VolunteeringOffer } from '$lib/types/need';
	import { getMyVolunteeringOffers } from '$lib/services/needs';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { NEED_KIND_LABELS, OFFER_STATUS_LABELS } from '$lib/utils/labels';
	import { pageTitle } from '$lib/utils/pageTitle';

	let offers = $state<VolunteeringOffer[]>([]);
	let loading = $state(true);

	// An `$effect` keyed on the auth flag plus a once-guard, not a bare `onMount` read:
	// `authStore.init()` resolves asynchronously, and a hard reload that checked
	// `isAuthenticated` once at mount showed an empty page to somebody with a good session
	// (frontend/CLAUDE.md trap 3).
	let loadedOnce = $state(false);
	$effect(() => {
		if (!authStore.isAuthenticated || loadedOnce) return;
		loadedOnce = true;
		load();
	});
	onMount(() => {
		if (!authStore.isAuthenticated) loading = false;
	});

	async function load() {
		try {
			offers = await getMyVolunteeringOffers();
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(m.offers_mineHeading())}</title>
</svelte:head>
<!-- "My volunteering offers" -->

<FeatureGate feature="volunteering">
	<div class="page">
		<header class="head">
			<div>
				<h1>{m.offers_mineHeading()}</h1>
				<p class="lead">{m.offers_mineLead()}</p>
			</div>
			<a class="btn-primary" href={resolve('/volunteering/new')}>{m.offers_addCta()}</a>
		</header>

		{#if !authStore.isAuthenticated}
			<p class="status">{m.shifts_signInToSee()}</p>
		{:else if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if offers.length === 0}
			<p class="status">{m.offers_mineEmpty()}</p>
		{:else}
			<ul class="list">
				{#each offers as offer (offer.id)}
					<li>
						<a href={resolve('/volunteering/[id]', { id: offer.id })}>{offer.title}</a>
						<span class="meta">
							{NEED_KIND_LABELS[offer.kind]()} · {OFFER_STATUS_LABELS[offer.status]()} ·
							{offer.language.toUpperCase()}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;
	.page {
		max-width: 48rem;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		align-items: flex-start;
	}
	h1 {
		margin: 0 0 0.3rem;
	}
	.lead {
		margin: 0;
		color: var(--text-secondary);
		max-width: 60ch;
	}
	.btn-primary {
		@include mix.button-primary;
	}
	.status {
		color: var(--text-secondary);
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.list li {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.meta {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
