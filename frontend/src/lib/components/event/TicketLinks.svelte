<script lang="ts">
	/** The three ticket links on an event page (CONFERENCE-BRIEF.md §3.D), one per role: "My ticket"
	 * for somebody holding a seat, "Scan" for any staff member (the volunteer role is exactly this),
	 * "Badge sheet" for the organisers.
	 *
	 * Each link is shown only to the person it works for, so nobody is offered a page that will
	 * refuse them — and the whole panel disappears when the `tickets` flag is off, because a kill
	 * switch that leaves its links behind has hidden nothing (house rule 3). The flag is read here
	 * rather than at the route, so the LINK goes with the page. */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { EdmatEvent } from '$lib/types/event';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';

	let { event }: { event: EdmatEvent } = $props();

	const enabled = $derived(featureFlagsStore.isEnabled('tickets') || authStore.isModerator);
	const hasSeat = $derived(event.myAttendance === 'going' || event.myAttendance === 'promoted');
</script>

{#if enabled && (hasSeat || event.canCheckIn || event.canOrganise)}
	<section class="tickets">
		<h3>{m.tickets_linksHeading()}</h3>
		<div class="links">
			{#if hasSeat}
				<a href={resolve('/events/[id]/ticket', { id: event.id })}>{m.tickets_myTicket()}</a>
			{/if}
			{#if event.canCheckIn}
				<a href={resolve('/events/[id]/scan', { id: event.id })}>{m.tickets_scan()}</a>
			{/if}
			{#if event.canOrganise}
				<a href={resolve('/events/[id]/badges', { id: event.id })}>{m.tickets_badges()}</a>
			{/if}
		</div>
	</section>
{/if}

<style lang="scss">
	.tickets {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	h3 {
		margin: 0 0 0.5rem;
	}
	.links {
		display: flex;
		gap: 0.8rem;
		flex-wrap: wrap;
	}
</style>
