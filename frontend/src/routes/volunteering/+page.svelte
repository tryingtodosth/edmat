<script lang="ts">
	// Everything this person has helped run, and what it is worth — the page the account menu's
	// "Volunteering" entry lands on.
	//
	// Hours are the whole content, because hours are what the Polish Volunteer Act's own
	// certificate is about ("wyszczególnienie zakresu świadczeń oraz liczba wypracowanych godzin").
	// Each row links to the printable certificate for that event; the certificate itself lives
	// under the event, because it is the organiser who issues it.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { formatDate } from '$lib/utils/datetime';
	import { getMyVolunteering } from '$lib/services/shifts';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';
	import type { VolunteeringSummary } from '$lib/types/shift';

	let rows = $state<VolunteeringSummary[]>([]);
	let loaded = $state(false);
	let error = $state('');

	// An `$effect` keyed on the auth flag rather than a bare `onMount` call: `authStore.init()`
	// resolves asynchronously, and a hard reload that read `isAuthenticated` once at mount showed an
	// empty page to somebody with a perfectly good session (frontend/CLAUDE.md trap 3).
	let loadedOnce = $state(false);
	$effect(() => {
		if (!authStore.isAuthenticated || loadedOnce) return;
		loadedOnce = true;
		load();
	});
	onMount(() => {
		if (!authStore.isAuthenticated) loaded = true;
	});

	async function load() {
		try {
			rows = await getMyVolunteering();
		} catch {
			error = m.common_error();
		} finally {
			loaded = true;
		}
	}

	const totalHours = $derived(
		rows.reduce((sum, row) => sum + Number(row.hours || 0), 0).toFixed(2)
	);
</script>

<svelte:head><title>{pageTitle(m.shifts_volunteeringTitle())}</title></svelte:head>
<!-- "Volunteering" -->

<FeatureGate feature="shifts">
	<div class="page">
		<h1>{m.shifts_volunteeringTitle()}</h1>
		<!-- "Volunteering" -->
		{#if !authStore.isAuthenticated}
			<p class="status">{m.shifts_signInToSee()}</p>
			<!-- "Sign in to see the events you have helped run." -->
		{:else if error}
			<p class="error" role="alert">{error}</p>
		{:else if loaded && rows.length === 0}
			<p class="status">{m.shifts_volunteeringEmpty()}</p>
			<!-- "You have not been on a rota yet." -->
		{:else}
			<p class="total">{m.shifts_hoursAcrossEvents({ hours: totalHours })}</p>
			<!-- "{hours} h across every event" -->
			<ul>
				{#each rows as row (row.event.id)}
					<li>
						<a href={resolve('/events/[id]', { id: row.event.id })}>{row.event.title}</a>
						{#if row.event.startsAt}
							<span class="when">{formatDate(row.event.startsAt)}</span>
						{/if}
						<span class="hours">{m.shifts_creditedHours({ hours: row.hours })}</span>
						<!-- "{hours} h credited" -->
						<span class="counts"
							>{m.shifts_shiftCounts({ done: row.doneCount, total: row.shiftCount })}</span
						>
						<!-- "{done} of {total} shifts done" -->
						<a class="cert" href={resolve('/events/[id]/certificate', { id: row.event.id })}>
							{m.shifts_certificate()}
							<!-- "Certificate of service" -->
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 760px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
	}
	h1 {
		font-size: 1.4rem;
	}
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: baseline;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--border);
	}
	.when,
	.hours,
	.counts,
	.status,
	.total {
		color: var(--text-secondary);
		font-size: 0.87rem;
	}
	.error {
		color: var(--danger, #c62828);
	}
</style>
