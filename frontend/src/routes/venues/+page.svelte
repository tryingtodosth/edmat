<script lang="ts">
	/**
	 * The venue directory — every building that hosts events, with how many rooms it has.
	 *
	 * Reachable from the footer rather than the header nav (CONFERENCE-BRIEF.md §3.A): a reader
	 * browsing exercises has no reason to be offered a list of buildings, while an organiser looking
	 * for somewhere to hold something goes looking for it.
	 *
	 * The list loads in `onMount`, not at component top level — this page is prerendered, and a
	 * service call at the top level runs at build time too, where `fetch('/api/…')` has no origin
	 * (frontend/CLAUDE.md, "First paint").
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import { getVenues } from '$lib/services/venues';
	import type { VenueSummary } from '$lib/types/venue';

	let venues = $state<VenueSummary[]>([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			venues = await getVenues();
		} catch {
			venues = [];
		} finally {
			loading = false;
		}
	});
</script>

<PageHead title={m.venues_browseTitle()} description={m.venues_browseIntro()} />
<!-- "Venues" / "Buildings that host events on EdMat, with their rooms and what each one can hold." -->

<FeatureGate feature="venues">
	<div class="page">
		<h1>{m.venues_browseTitle()}</h1>
		<!-- "Venues" -->
		<p class="intro">{m.venues_browseIntro()}</p>
		<!-- "Buildings that host events on EdMat, with their rooms and what each one can hold." -->

		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if venues.length === 0}
			<p class="status">{m.venues_empty()}</p>
			<!-- "No venue has been added yet." -->
		{:else}
			<ul class="venues">
				{#each venues as venue (venue.id)}
					<li>
						<a class="card" href={resolve('/venues/[slug]', { slug: venue.slug })}>
							<strong>{venue.name}</strong>
							{#if venue.address}<span class="address">{venue.address}</span>{/if}
							<span class="rooms">{venue.roomCount} {m.venues_roomCountLabel()}</span>
							<!-- "rooms" -->
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-4) var(--space-8);
	}
	.intro,
	.status {
		color: var(--text-secondary);
	}
	.venues {
		list-style: none;
		padding: 0;
		margin: var(--space-4) 0 0;
		display: grid;
		gap: 0.6rem;
	}
	.card {
		display: grid;
		gap: 0.15rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.7rem 0.9rem;
		text-decoration: none;
		color: inherit;
	}
	.card:hover {
		border-color: var(--accent);
	}
	.address,
	.rooms {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
</style>
