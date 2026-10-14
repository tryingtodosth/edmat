<script lang="ts">
	import HiddenLanguagesNotice from '$lib/components/shared/HiddenLanguagesNotice.svelte';
	// Browsing one-off events. Wrapped in `FeatureGate` for the same reason every other gated route
	// is: the API refuses outright when a moderator has pulled the `events` switch, and without this
	// a visitor would reach the real page and discover it only as a raw 403 from the first fetch.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getEvents } from '$lib/services/events';
	import { authStore } from '$lib/state/auth.svelte';
	// The creation gate (learning step F): hosting an event is one of the four founding acts
	// `config/creation.py` governs.
	import { creationStore } from '$lib/state/creation.svelte';
	import CreationGateNote from '$lib/components/shared/CreationGateNote.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import type { EdmatEvent } from '$lib/types/event';
	import EventCard from '$lib/components/event/EventCard.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import NewSinceNotice from '$lib/components/shared/NewSinceNotice.svelte';
	import SavedCopyNotice from '$lib/components/shared/SavedCopyNotice.svelte';
	import StaleRow from '$lib/components/shared/StaleRow.svelte';
	import { cachedList, type TrackedRow } from '$lib/state/cachedList.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	type Scope = 'upcoming' | 'past' | 'hosting' | 'attending';

	let scope = $state<Scope>('upcoming');
	let events = $state<TrackedRow<EdmatEvent>[]>([]);
	let loading = $state(true);
	let failed = $state(false);
	let newCount = $state(0);
	let offline = $state(false);

	// See the courses browse page for why this is derived from the rows rather than stored: the per
	// row confirmation time is already the honest answer, and a second clock could disagree with the
	// fade drawn beside it.
	let savedAt = $derived(events.length ? Math.max(...events.map((row) => row.confirmedAt)) : null);
	let stale = $derived(savedAt !== null && Date.now() - savedAt > 24 * 60 * 60 * 1000);

	async function load(current: Scope) {
		loading = true;
		failed = false;
		// Each of the four filters is its own cached list. They are genuinely different questions —
		// merging "past" into "upcoming" would have every finished event read as newly removed — and
		// `hosting`/`attending` are the signed-in account's own, so they ride the same sign-out wipe
		// every other cached response already does.
		try {
			await cachedList<EdmatEvent>(
				`events:${current}`,
				() =>
					current === 'hosting' || current === 'attending'
						? getEvents({ mine: current })
						: getEvents({ when: current }),
				(result) => {
					// A stale scope's answer must never land in the current one: switching filters
					// fast enough leaves an earlier request still in flight.
					if (current !== scope) return;
					events = result.rows;
					newCount = result.newCount;
					offline = result.offline;
					loading = false;
				}
			);
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	// What an empty scope says and offers. The four buttons are views, not filters — none narrows
	// another — so each gets its own sentence rather than "nothing matches". Hosting offers to host;
	// the two that are about OTHER people's events point back at what is coming up.
	//
	// Inside the `$derived`, not module constants: a label built once at mount would stay in the
	// language the page opened in after the picker switched it (`locale.svelte.ts` makes `m.*()`
	// reactive only where it is read reactively).
	const emptyCopy = $derived.by(() => {
		const hostAction = {
			label: m.events_hostAnEvent(), // "Host an event"
			href: resolve('/events/new'),
			creation: 'event' as const
		};
		const upcomingAction = {
			label: m.empty_eventsSeeUpcoming(), // "See what is coming up"
			onclick: () => (scope = 'upcoming')
		};
		switch (scope) {
			case 'past':
				return { message: m.empty_eventsPast(), action: upcomingAction }; // "Events that have already happened stay here, with their programme and what they left behind."
			case 'hosting':
				return { message: m.empty_eventsHosting(), action: hostAction }; // "Events you organise will be listed here."
			case 'attending':
				return { message: m.empty_eventsAttending(), action: upcomingAction }; // "When you say you are going to an event, it shows up here."
			default:
				return { message: m.empty_eventsUpcoming(), action: hostAction }; // "Talks, workshops, study sessions and conferences, each with a programme and sign-up. Nothing is planned yet."
		}
	});

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
	<title>{pageTitle(m.events_browseHeading())}</title>
</svelte:head>

<FeatureGate feature="events">
	<div class="page">
		<header class="head">
			<div>
				<h1>{m.events_browseHeading()}</h1>
				<HiddenLanguagesNotice path="/events/" />
				<p class="lead">{m.events_browseLead()}</p>
			</div>
			{#if authStore.isAuthenticated && creationStore.allows('event')}
				<a class="primary" href={resolve('/events/new')}>{m.events_hostAnEvent()}</a>
			{/if}
		</header>

		<CreationGateNote kind="event" />

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
			<EmptyState
				name="events-{scope}"
				message={emptyCopy.message}
				action={emptyCopy.action}
				guide="events"
			/>
		{:else}
			{#if offline}
				<SavedCopyNotice {savedAt} {stale} />
			{/if}
			<NewSinceNotice count={newCount} />
			<div class="grid">
				{#each events as row (row.item.id)}
					<StaleRow confirmedAt={row.confirmedAt}>
						<!-- `headingLevel={2}`: this page's `h1` is followed straight by the grid, with no
						     section heading between, so the card's default `h3` skipped a level. -->
						<EventCard event={row.item} headingLevel={2} />
					</StaleRow>
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
			@include mix.selected-soft;
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
