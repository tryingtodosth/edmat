<script lang="ts">
	/** My agenda (AUDIENCE-BRIEF.md §3.2, §3.5): the sessions this person bookmarked and the
	 * events they said they are going to, soonest first, with the same thing as an `.ics` file. */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { MyAgenda } from '$lib/types/event';
	import { getMyAgenda, getMyAgendaIcs } from '$lib/services/events';
	import { authStore } from '$lib/state/auth.svelte';
	import { formatDateTime } from '$lib/utils/datetime';
	import { downloadText } from '$lib/utils/download';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	let agenda = $state<MyAgenda | null>(null);
	let loading = $state(true);
	let loadedOnce = false;
	$effect(() => {
		if (!authStore.isAuthenticated || loadedOnce) return;
		loadedOnce = true;
		getMyAgenda()
			.then((a) => (agenda = a))
			.finally(() => (loading = false));
	});
	async function exportIcs() {
		downloadText('edmat-my-agenda.ics', await getMyAgendaIcs(), 'text/calendar');
	}
</script>

<PageHead title={m.events_myAgenda()} description={m.events_myAgendaEmpty()} />
<FeatureGate feature="events">
	<div class="agenda">
		<div class="agenda__head">
			<h1>{m.events_myAgenda()}</h1>
			{#if agenda && (agenda.sessions.length > 0 || agenda.events.length > 0)}
				<button type="button" onclick={exportIcs}>{m.events_exportIcs()}</button>
			{/if}
		</div>
		{#if !authStore.isAuthenticated}
			<p class="status">{m.events_block_sign_in()}</p>
		{:else if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if agenda && agenda.sessions.length === 0 && agenda.events.length === 0}
			<p class="status">{m.events_myAgendaEmpty()}</p>
		{:else if agenda}
			{#if agenda.sessions.length > 0}
				<h2>{m.events_bookmarkedSessions()}</h2>
				<ul class="rows">
					{#each agenda.sessions as s (s.id)}
						<li>
							<span class="when">{formatDateTime(s.startsAt)}</span>
							<a href={resolve('/events/[id]', { id: s.eventId })}>{s.title}</a>
							{#if s.locationText}<span class="place">{s.locationText}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if agenda.events.length > 0}
				<h2>{m.events_goingTo()}</h2>
				<ul class="rows">
					{#each agenda.events as e (e.id)}
						<li>
							<span class="when">{e.startsAt ? formatDateTime(e.startsAt) : m.events_form_scheduling_none()}</span>
							<a href={resolve('/events/[id]', { id: e.id })}>{e.title}</a>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.agenda {
		max-width: 52rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}
	.agenda__head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0;
	}
	button {
		min-height: 44px;
		padding: 0 1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		cursor: pointer;
	}
	.rows {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: grid;
		gap: 0.4rem;
	}
	li {
		display: flex;
		gap: 0.7rem;
		flex-wrap: wrap;
		align-items: baseline;
	}
	.when,
	.place {
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}
	.status {
		color: var(--text-secondary);
	}
</style>
