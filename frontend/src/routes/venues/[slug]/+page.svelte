<script lang="ts">
	/**
	 * One building: its address, how to reach somebody in it, its rooms with both capacities, and
	 * the checklists it hands organisers.
	 *
	 * The slug is what the URL carries (a link somebody sends), while the API's own id is the
	 * numeric pk — `getVenueBySlug` is the one place that translation happens.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import { getVenueBySlug, getVenueTemplates } from '$lib/services/venues';
	import type { ChecklistTemplate, Venue } from '$lib/types/venue';

	let venue = $state<Venue | null>(null);
	let templates = $state<ChecklistTemplate[]>([]);
	let loading = $state(true);
	let failed = $state(false);

	// The id-changed guard (frontend/CLAUDE.md trap 2): this effect re-fires with no navigation.
	let loadedFor = $state('');
	$effect(() => {
		const slug = page.params.slug ?? '';
		if (!slug || slug === loadedFor) return;
		loadedFor = slug;
		void load(slug);
	});

	async function load(slug: string) {
		loading = true;
		failed = false;
		try {
			venue = await getVenueBySlug(slug);
			failed = venue === null;
			if (venue) {
				try {
					templates = await getVenueTemplates(venue.id);
				} catch {
					templates = [];
				}
			}
		} catch {
			venue = null;
			failed = true;
		} finally {
			loading = false;
		}
	}
</script>

<PageHead title={venue?.name ?? m.venues_browseTitle()} description={venue?.address ?? ''} />

<FeatureGate feature="venues">
	<div class="page">
		<p class="back"><a href={resolve('/venues')}>{m.venues_backToVenues()}</a></p>
		<!-- "All venues" -->

		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if failed || !venue}
			<p class="status">{m.venues_notFound()}</p>
			<!-- "No such venue." -->
		{:else}
			<h1>{venue.name}</h1>
			{#if !venue.isActive}
				<p class="status warn">{m.venues_inactive()}</p>
				<!-- "This building is not currently hosting events." -->
			{/if}
			{#if venue.canAdminister}
				<p class="manage">
					<a href={resolve('/venues/[slug]/manage', { slug: venue.slug })}>
						{m.venues_manageLink()}
						<!-- "Run this building" -->
					</a>
				</p>
			{/if}

			<dl class="facts">
				{#if venue.address}
					<dt>{m.venues_address()}</dt>
					<!-- "Address" -->
					<dd>{venue.address}</dd>
				{/if}
				{#if venue.contactNote}
					<dt>{m.venues_contact()}</dt>
					<!-- "Getting in touch" -->
					<dd>{venue.contactNote}</dd>
				{/if}
				{#if venue.securityPhone}
					<dt>{m.venues_securityPhone()}</dt>
					<!-- "Porter's lodge / security" -->
					<dd>{venue.securityPhone}</dd>
				{/if}
			</dl>

			<h2>{m.venues_roomsHeading()}</h2>
			<!-- "Rooms" -->
			<p class="hint">{m.venues_capacityNote()}</p>
			<!-- "Seats are chairs; the fire capacity is how many people the building's fire safety instruction allows…" -->
			{#if venue.rooms.length === 0}
				<p class="status">{m.venues_noRooms()}</p>
				<!-- "No rooms listed yet." -->
			{:else}
				<ul class="rooms">
					{#each venue.rooms as room (room.id)}
						<li class="room">
							<strong>{room.name}</strong>
							{#if room.number}<span class="meta">{m.venues_roomNumber()}: {room.number}</span>{/if}
							{#if room.floor}<span class="meta">{m.venues_roomFloor()}: {room.floor}</span>{/if}
							<span class="meta">{m.venues_seated()}: {room.seatedCapacity}</span>
							<span class="meta">{m.venues_fire()}: {room.fireCapacity}</span>
							{#if room.accessible}<span class="pill">{m.venues_accessible()}</span>{/if}
							{#if room.hasAv}<span class="pill">{m.venues_hasAv()}</span>{/if}
							{#if !room.isActive}<span class="pill pill--off">{m.venues_roomRetired()}</span>{/if}
							{#if room.notes}<p class="notes">{room.notes}</p>{/if}
						</li>
					{/each}
				</ul>
			{/if}

			<h2>{m.venues_templatesHeading()}</h2>
			<!-- "Checklists this building hands out" -->
			{#if templates.length === 0}
				<p class="status">{m.venues_noTemplates()}</p>
				<!-- "This building has not written a checklist of its own…" -->
			{:else}
				<ul class="templates">
					{#each templates as template (template.id)}
						<li>
							<strong>{template.name}</strong>
							<span class="meta">
								{template.items.length}
								{m.venues_templateItems()} · {m.venues_templateVersion()}
								{template.version}
							</span>
							{#if template.description}<p class="notes">{template.description}</p>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-4) var(--space-8);
	}
	.status,
	.hint,
	.meta,
	.notes {
		color: var(--text-secondary);
	}
	.warn {
		color: var(--status-danger);
	}
	.hint,
	.meta,
	.notes {
		font-size: 0.85rem;
	}
	.back,
	.manage {
		margin: 0 0 0.4rem;
	}
	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.2rem 0.8rem;
		margin: 0.6rem 0;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	.rooms,
	.templates {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0;
		display: grid;
		gap: 0.6rem;
	}
	.room,
	.templates li {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
	}
	.notes {
		flex-basis: 100%;
		margin: 0.2rem 0 0;
	}
	.pill {
		font-size: 0.72rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.pill--off {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-secondary);
	}
</style>
