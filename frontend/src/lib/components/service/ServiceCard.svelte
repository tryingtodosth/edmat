<script lang="ts">
	// The public browse page's own listing card — read-only, matching MaterialCard's own economy
	// (one component, reused wherever a listing renders). "My listings" management (edit/pause/
	// delete) lives inline on routes/services/+page.svelte itself instead of being folded into this
	// same component, since that needs a full ServiceForm, not just a few extra buttons.
	import { resolve } from '$app/paths';
	import type { Service } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import ReportButton from '$lib/components/shared/ReportButton.svelte';

	let {
		service,
		courseNames = [],
		linkTitle = true
	}: {
		service: Service;
		courseNames?: string[];
		linkTitle?: boolean;
	} = $props();

	let isOwnListing = $derived(authStore.user?.id === service.providerId);

	let contactHref = $derived(
		`${resolve('/messages/new')}?to=${encodeURIComponent(service.providerId)}&subject=${encodeURIComponent(
			m.services_contactSubject({ title: service.title })
		)}`
	);
</script>

<article class="service-card">
	<div class="service-card__heading">
		<h3>
			{#if linkTitle}
				<a class="service-card__title-link" href={resolve('/services/[id]', { id: service.id })}>
					{service.title}
				</a>
			{:else}
				{service.title}
			{/if}
		</h3>
		{#if service.hourlyRate !== null}
			<span class="rate">{service.hourlyRate} {service.currency}/h</span>
		{/if}
	</div>

	<!-- How you can actually attend, shown on every card without exception — for a student choosing
	     a tutor this is a hard filter, not a detail: an in-person-only listing 300 km away is simply
	     not an option, and finding that out only after opening the listing wastes the trip. The
	     location line renders beneath it whenever there is one. -->
	<p class="delivery">
		<span class="mode-pill mode-pill--{service.deliveryMode}">
			{service.deliveryMode === 'online'
				? m.services_mode_online()
				: service.deliveryMode === 'inPerson'
					? m.services_mode_inPerson()
					: m.services_mode_hybrid()}
		</span>
		{#if service.location}
			<span class="location-label">{service.location.label || m.services_locationNoLabel()}</span>
		{/if}
	</p>

	{#if service.reviewCount > 0}
		<p class="rating-summary">
			{m.review_average({
				average: service.averageRating ?? 0,
				count: service.reviewCount
			})}
		</p>
	{/if}

	{#if service.description}
		<p class="description">{service.description}</p>
	{/if}

	{#if courseNames.length > 0}
		<div class="courses">
			{#each courseNames as name (name)}
				<span class="course-chip">{name}</span>
			{/each}
		</div>
	{/if}

	<div class="service-card__footer">
		<a class="provider-link" href={resolve('/users/[id]', { id: service.providerId })}>
			{service.providerDisplayName}
		</a>
		{#if authStore.isAuthenticated && !isOwnListing}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an internal route built from resolve('/messages/new') plus a query string the eslint rule can't statically see through -->
			<a class="contact" href={contactHref}>{m.services_contact()}</a>
			<ReportButton kind="service" objectId={service.id} />
		{/if}
	</div>
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.service-card {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.service-card__heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}
	h3 {
		font-size: var(--font-size-base);
	}
	.service-card__title-link {
		color: var(--text-primary);
		&:hover {
			color: var(--accent);
			text-decoration: underline;
		}
	}
	.rating-summary {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.delivery {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.location-label {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.mode-pill {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		font-size: var(--font-size-xs);
	}
	// In-person and hybrid share the accent treatment because they share the fact that matters —
	// you can meet this person. Online stays neutral: it is the default and the most common, so
	// highlighting it would make the pill decorative rather than informative.
	.mode-pill--inPerson,
	.mode-pill--hybrid {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.rate {
		@include mix.status-pill(var(--accent), var(--accent-soft));
		flex-shrink: 0;
	}
	.description {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		flex: 1;
	}
	.courses {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.course-chip {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
	.service-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
	}
	.provider-link {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text-primary);
		&:hover {
			color: var(--accent);
		}
	}
	.contact {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
</style>
