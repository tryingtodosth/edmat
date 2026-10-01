<script lang="ts">
	// One volunteering offer. Public when it is `open`; a paused or closed one 404s for everybody
	// except its own volunteer and staff, which is `needs/rules.py: public_offers` deciding, not
	// this page — a detail route that filtered for itself is how two surfaces start disagreeing.
	//
	// The owner's own controls (edit in place, delete) live here rather than on a separate route:
	// an offer is six fields, and a page that sends you somewhere else to change one of them is
	// a page that stops being changed.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import type { VolunteeringOffer, VolunteeringOfferDraft } from '$lib/types/need';
	import {
		deleteVolunteeringOffer,
		getVolunteeringOffer,
		updateVolunteeringOffer
	} from '$lib/services/needs';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import OfferForm from '$lib/components/needs/OfferForm.svelte';
	import { NEED_KIND_LABELS, OFFER_STATUS_LABELS, SKILL_LEVEL_LABELS } from '$lib/utils/labels';
	import { pageTitle } from '$lib/utils/pageTitle';

	let offer = $state<VolunteeringOffer | null>(null);
	let loading = $state(true);
	let missing = $state(false);
	let editing = $state(false);

	// An id-changed guard, not a bare `$effect` call: frontend/CLAUDE.md trap 2 — an effect that
	// reads `page.params.id` re-fires with no navigation at all.
	let loadedForId = $state('');
	$effect(() => {
		const id = page.params.id;
		if (!id || id === loadedForId) return;
		loadedForId = id;
		load(id);
	});

	async function load(id: string) {
		loading = true;
		missing = false;
		try {
			offer = await getVolunteeringOffer(id);
		} catch {
			missing = true;
		} finally {
			loading = false;
		}
	}

	let isMine = $derived(
		!!offer?.volunteer && !!authStore.user?.id && offer.volunteer.id === authStore.user.id
	);
	let canMessage = $derived(
		(featureFlagsStore.isEnabled('messaging') || authStore.isModerator) &&
			authStore.isAuthenticated &&
			!isMine
	);

	async function save(draft: VolunteeringOfferDraft) {
		if (!offer) return;
		offer = await updateVolunteeringOffer(offer.id, draft);
		editing = false;
	}

	async function remove() {
		if (!offer || !confirm(m.offers_deleteConfirm())) return;
		await deleteVolunteeringOffer(offer.id);
		await goto(resolve('/volunteering'));
	}
</script>

<svelte:head>
	<title>{pageTitle(offer?.title ?? m.offers_browseHeading())}</title>
</svelte:head>

<FeatureGate feature="volunteering">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if missing || !offer}
			<p class="status">{m.offers_notFound()}</p>
		{:else if editing}
			<h1>{m.offers_editHeading()}</h1>
			<OfferForm initial={offer} onSubmit={save} onCancel={() => (editing = false)} />
		{:else}
			<header class="head">
				<div>
					<h1>{offer.title}</h1>
					{#if offer.volunteer}
						<p class="who">
							<a href={resolve('/users/[id]', { id: offer.volunteer.id })}
								>{offer.volunteer.displayName}</a
							>
						</p>
					{/if}
				</div>
				{#if isMine}
					<div class="owner-actions">
						<button type="button" class="secondary" onclick={() => (editing = true)}>
							{m.common_edit()}
						</button>
						<button type="button" class="danger" onclick={remove}>{m.offers_deleteCta()}</button>
					</div>
				{/if}
			</header>

			<ul class="facts">
				<li><span class="pill">{NEED_KIND_LABELS[offer.kind]()}</span></li>
				<li>{SKILL_LEVEL_LABELS[offer.skillLevel]()}</li>
				{#if isMine}<li>{OFFER_STATUS_LABELS[offer.status]()}</li>{/if}
				{#if offer.isRemote}<li>{m.needs_remoteBadge()}</li>{/if}
				{#if offer.locationText}<li>{offer.locationText}</li>{/if}
				{#if offer.hoursPerWeek}
					<li>{m.offers_hoursPerWeek({ hours: offer.hoursPerWeek })}</li>
				{/if}
			</ul>

			{#if offer.description}
				<div class="body"><MathContent source={offer.description} /></div>
			{/if}

			<!-- Two language lines, because they answer two different questions and collapsing them
			     loses the one a reader is usually after — see `needs/models.py`'s own docstring. -->
			<dl class="langs">
				{#if offer.spokenLanguages.length > 0}
					<dt>{m.offers_detailSpoken()}</dt>
					<dd>{offer.spokenLanguages.join(' · ').toUpperCase()}</dd>
				{/if}
				<dt>{m.offers_detailWrittenIn()}</dt>
				<dd>{offer.language.toUpperCase()}</dd>
			</dl>

			{#if canMessage && offer.volunteer}
				<p class="contact">
					<a class="btn-primary" href={resolve('/messages')}>{m.offers_contactCta()}</a>
				</p>
			{/if}
			<p class="note">{m.offers_contactHint()}</p>
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
		margin: 0 0 0.2rem;
	}
	.who {
		margin: 0;
		color: var(--text-secondary);
	}
	.owner-actions {
		display: flex;
		gap: var(--space-2);
	}
	.secondary {
		@include mix.button-secondary;
	}
	.danger {
		@include mix.button-secondary;
		color: var(--status-danger);
	}
	.btn-primary {
		@include mix.button-primary;
	}
	.facts {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: 0;
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.pill {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.langs {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.2rem var(--space-3);
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.langs dt {
		color: var(--text-secondary);
	}
	.langs dd {
		margin: 0;
	}
	.status,
	.note {
		color: var(--text-secondary);
	}
	.note {
		font-size: var(--font-size-sm);
		max-width: 60ch;
	}
	.contact {
		margin: 0;
	}
</style>
