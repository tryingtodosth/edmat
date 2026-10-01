<script lang="ts">
	// The volunteering OFFERS board — people saying what they can help with (backend
	// `needs.VolunteeringOffer`, 2026-10-01). The mirror of `/needs`, which is courses, events and
	// materials saying what they need, and the two pages link to each other because they are two
	// halves of one question.
	//
	// It took the `/volunteering` address and the shifts rota's own "my hours" page moved to
	// `/volunteering/hours`, by owner decision: the public noun gets the public address, and the
	// personal record of what you have already done sits under it.
	//
	// Wrapped in `FeatureGate` for the reason every gated route is: without it a visitor reaches
	// the real page and learns the switch is off from a raw 403 on the first fetch.
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { NeedKind, OfferBoardFilters, VolunteeringOffer } from '$lib/types/need';
	import { getVolunteeringOffers } from '$lib/services/needs';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import { NEED_KINDS, NEED_KIND_LABELS, SKILL_LEVEL_LABELS } from '$lib/utils/labels';
	import { pageTitle } from '$lib/utils/pageTitle';

	let offers = $state<VolunteeringOffer[]>([]);
	let loading = $state(true);
	let failed = $state(false);

	let kind = $state<NeedKind | ''>('');
	let remote = $state(false);
	let speaks = $state('');
	let query = $state('');

	// The `needs` board is the other half of this one; its own switch may be off, in which case
	// the cross-link has to go with it (house rule 3 — a kill switch removes the LINKS).
	let needsOn = $derived(featureFlagsStore.isEnabled('needs') || authStore.isModerator);

	async function load() {
		loading = true;
		failed = false;
		const filters: OfferBoardFilters = {};
		if (kind) filters.kind = kind;
		if (remote) filters.remote = true;
		if (speaks.trim()) filters.speaks = speaks.trim().toLowerCase();
		if (query.trim()) filters.q = query.trim();
		try {
			offers = await getVolunteeringOffers(filters);
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(load, 300);
	}
</script>

<svelte:head>
	<title>{pageTitle(m.offers_browseHeading())}</title>
</svelte:head>
<!-- "Volunteering offers" -->

<FeatureGate feature="volunteering">
	<div class="page">
		<header class="head">
			<div>
				<h1>{m.offers_browseHeading()}</h1>
				<p class="lead">{m.offers_browseLead()}</p>
				<!-- "People who can help, and what they can help with. Nothing here is paid." -->
			</div>
			<div class="head__actions">
				{#if authStore.isAuthenticated}
					<a class="btn-primary" href={resolve('/volunteering/new')}>{m.offers_addCta()}</a>
					<!-- "Offer to help" -->
					<a class="btn-secondary" href={resolve('/volunteering/mine')}>{m.offers_mineCta()}</a>
					<!-- "My offers" -->
				{/if}
			</div>
		</header>

		{#if needsOn}
			<p class="crosslink">
				{m.offers_crossToNeeds()}
				<!-- "Looking for the other side?" -->
				<a href={resolve('/needs')}>{m.needs_browseHeading()}</a>
			</p>
		{/if}

		<div class="filters">
			<select bind:value={kind} onchange={load} aria-label={m.needs_formKindLabel()}>
				<option value="">{m.needs_filter_allKinds()}</option>
				{#each NEED_KINDS as k (k)}
					<option value={k}>{NEED_KIND_LABELS[k]()}</option>
				{/each}
			</select>
			<label class="checkbox">
				<input type="checkbox" bind:checked={remote} onchange={load} />
				<span>{m.needs_filter_remoteOnly()}</span>
			</label>
			<!-- `type="text"`, never `type="number"` anywhere in this app, but this one is a language
			     code: a short free string, because `locale` is a free string everywhere here and
			     pinning it to the interface's own two would hide the Ukrainian offers this filter
			     exists for. -->
			<input
				type="text"
				class="speaks"
				bind:value={speaks}
				oninput={onSearchInput}
				placeholder={m.offers_filter_speaksPlaceholder()}
				aria-label={m.offers_filter_speaksPlaceholder()}
				maxlength="8"
			/>
			<input
				type="text"
				class="search"
				bind:value={query}
				oninput={onSearchInput}
				placeholder={m.needs_searchPlaceholder()}
				aria-label={m.needs_searchPlaceholder()}
			/>
		</div>

		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if failed}
			<p class="status">{m.common_error_generic()}</p>
		{:else if offers.length === 0}
			<p class="status">{m.offers_browseEmpty()}</p>
			<!-- "Nobody has posted an offer yet." -->
		{:else}
			<div class="grid">
				{#each offers as offer (offer.id)}
					<a class="card" href={resolve('/volunteering/[id]', { id: offer.id })}>
						<div class="card__head">
							<strong>{offer.title}</strong>
							<span class="pill">{NEED_KIND_LABELS[offer.kind]()}</span>
						</div>
						{#if offer.volunteer}
							<p class="who">{m.offers_byPerson({ name: offer.volunteer.displayName })}</p>
						{/if}
						{#if offer.description}
							<div class="excerpt"><MathContent source={offer.description} /></div>
						{/if}
						<div class="meta">
							<span>{SKILL_LEVEL_LABELS[offer.skillLevel]()}</span>
							{#if offer.isRemote}<span class="badge">{m.needs_remoteBadge()}</span>{/if}
							{#if offer.locationText}<span>{offer.locationText}</span>{/if}
							{#if offer.hoursPerWeek}<span
									>{m.offers_hoursPerWeek({ hours: offer.hoursPerWeek })}</span
								>{/if}
							{#if offer.spokenLanguages.length > 0}
								<span class="langs">{offer.spokenLanguages.join(' · ').toUpperCase()}</span>
							{/if}
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		justify-content: space-between;
		align-items: flex-start;
	}
	.head h1 {
		margin: 0 0 0.3rem;
	}
	.head__actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.btn-primary {
		@include mix.button-primary;
	}
	.btn-secondary {
		@include mix.button-secondary;
	}
	.lead {
		color: var(--text-secondary);
		max-width: 60ch;
		margin: 0;
	}
	.crosslink {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.filters {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		align-items: center;
	}
	select,
	input {
		font: inherit;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		min-height: 40px;
	}
	input.speaks {
		max-width: 10rem;
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.checkbox input {
		min-height: 0;
	}
	.status {
		color: var(--text-secondary);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: var(--space-3);
	}
	.card {
		@include mix.card-surface;
		@include mix.focus-ring;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		color: inherit;
		text-decoration: none;

		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.card__head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		align-items: baseline;
	}
	.pill {
		@include mix.status-pill(var(--accent), var(--accent-soft));
		flex-shrink: 0;
	}
	.who {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	// A card is a summary: a long offer, or one with a chemistry drawing in it, must not stretch
	// the grid cell to the height of the whole description.
	.excerpt {
		max-height: 7.5rem;
		overflow: hidden;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		margin-top: auto;
	}
	.badge,
	.langs {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
</style>
