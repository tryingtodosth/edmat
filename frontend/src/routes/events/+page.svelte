<script lang="ts">
	// Browsing one-off events. Wrapped in `FeatureGate` for the same reason every other gated route
	// is: the API refuses outright when a moderator has pulled the `events` switch, and without this
	// a visitor would reach the real page and discover it only as a raw 403 from the first fetch.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getEvents } from '$lib/services/events';
	import { authStore } from '$lib/state/auth.svelte';
	import type { EdmatEvent } from '$lib/types/event';
	import EventCard from '$lib/components/event/EventCard.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';

	type Scope = 'upcoming' | 'past' | 'hosting' | 'attending';

	let scope = $state<Scope>('upcoming');
	let events = $state<EdmatEvent[]>([]);
	let loading = $state(true);
	let failed = $state(false);

	async function load(current: Scope) {
		loading = true;
		failed = false;
		try {
			events =
				current === 'hosting' || current === 'attending'
					? await getEvents({ mine: current })
					: await getEvents({ when: current });
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	// Keyed on the scope rather than run on every state change, the same guard `/classroom`'s own
	// browse page uses — an unguarded `$effect` reading `events` would re-enter itself once the fetch
	// assigns to it.
	let loadedFor = $state<Scope | null>(null);
	$effect(() => {
		if (scope === loadedFor) return;
		loadedFor = scope;
		load(scope);
	});
</script>

<svelte:head>
	<title>{m.events_browseHeading()} — {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="events">
	<div class="page">
		<header class="head">
			<div>
				<h1>{m.events_browseHeading()}</h1>
				<p class="lead">{m.events_browseLead()}</p>
			</div>
			{#if authStore.isAuthenticated}
				<a class="primary" href={resolve('/events/new')}>{m.events_hostAnEvent()}</a>
			{/if}
		</header>

		<!-- Plain buttons rather than tabs: these four are filters over one list, and the homepage's
		     own tablist is a genuinely different thing (five separate kinds of content). Calling both
		     "tabs" would give a screen reader two different promises for the same word. -->
		<div class="filters">
			<button
				type="button"
				class:active={scope === 'upcoming'}
				aria-pressed={scope === 'upcoming'}
				onclick={() => (scope = 'upcoming')}>{m.events_filter_upcoming()}</button
			>
			<button
				type="button"
				class:active={scope === 'past'}
				aria-pressed={scope === 'past'}
				onclick={() => (scope = 'past')}>{m.events_filter_past()}</button
			>
			{#if authStore.isAuthenticated}
				<button
					type="button"
					class:active={scope === 'hosting'}
					aria-pressed={scope === 'hosting'}
					onclick={() => (scope = 'hosting')}>{m.events_hosting()}</button
				>
				<button
					type="button"
					class:active={scope === 'attending'}
					aria-pressed={scope === 'attending'}
					onclick={() => (scope = 'attending')}>{m.events_attending()}</button
				>
			{/if}
		</div>

		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if failed}
			<p class="status">{m.common_error_generic()}</p>
		{:else if events.length === 0}
			<p class="status">
				{scope === 'upcoming' ? m.events_browseEmpty() : m.events_pastEmpty()}
			</p>
		{:else}
			<div class="grid">
				{#each events as event (event.id)}
					<EventCard {event} />
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
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.lead {
		color: var(--text-secondary);
		max-width: 60ch;
	}
	.primary {
		@include mix.button-primary;
	}
	.filters {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		button {
			@include mix.button-secondary;
			font-size: var(--font-size-sm);
		}
		.active {
			border-color: var(--accent);
			color: var(--accent);
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.status {
		color: var(--text-secondary);
	}
</style>
