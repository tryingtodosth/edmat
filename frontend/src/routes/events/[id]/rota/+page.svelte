<script lang="ts">
	// The wall rota: the sheet that gets printed and taped up beside the organiser desk.
	//
	// It exists because the most reliable network at a conference is a piece of paper. Everything
	// here is what somebody standing in a corridor needs — station, time, who — at a size that
	// reads from a metre away, with no controls at all.
	//
	// **It shows names, so it is staff-only**, and the API enforces that: the stations endpoint
	// 404s for anybody who does not help run the event. Co-volunteer names arrive already masked
	// to a first name and a last initial unless the reader is an organiser, which is exactly the
	// right amount of detail for something on a wall.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { formatDate, formatTimeOfDay } from '$lib/utils/datetime';
	import { getStations } from '$lib/services/shifts';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';
	import type { Shift, Station } from '$lib/types/shift';

	let stations = $state<Station[]>([]);
	let error = $state('');
	let loadedFor = $state('');

	$effect(() => {
		const id = page.params.id;
		if (!id || id === loadedFor || !authStore.isAuthenticated) return;
		loadedFor = id;
		load(id);
	});

	async function load(id: string) {
		try {
			stations = await getStations(id);
		} catch {
			error = m.shifts_rotaNotYours();
		}
	}

	type Row = { shift: Shift; station: Station };
	const days = $derived.by(() => {
		// A plain object, not a `Map`: built inside the derivation, thrown away after it, never
		// mutated from outside — `svelte/prefer-svelte-reactivity` is right in general and wrong here.
		const byDay: Record<string, Row[]> = {};
		for (const station of stations) {
			for (const shift of station.shifts) {
				const key = new Date(shift.startsAt).toDateString();
				(byDay[key] ??= []).push({ shift, station });
			}
		}
		return Object.entries(byDay)
			.map(([key, rows]) => ({
				key,
				label: formatDate(rows[0].shift.startsAt),
				rows: rows.sort((a, b) => (a.shift.startsAt < b.shift.startsAt ? -1 : 1))
			}))
			.sort((a, b) => (a.rows[0].shift.startsAt < b.rows[0].shift.startsAt ? -1 : 1));
	});
</script>

<svelte:head><title>{pageTitle(m.shifts_wallRota())}</title></svelte:head>
<!-- "Print the wall rota" -->

<FeatureGate feature="shifts">
	<div class="page">
		<div class="controls">
			<a href={resolve('/events/[id]', { id: page.params.id ?? '' })}>{m.shifts_backToEvent()}</a>
			<!-- "Back to the event" -->
			<button type="button" onclick={() => window.print()}>{m.shifts_print()}</button>
			<!-- "Print" -->
		</div>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		{#each days as day (day.key)}
			<section class="day">
				<h2>{day.label}</h2>
				<table>
					<thead>
						<tr>
							<th>{m.shifts_colTime()}</th>
							<!-- "Time" -->
							<th>{m.shifts_colStation()}</th>
							<!-- "Station" -->
							<th>{m.shifts_colWhere()}</th>
							<!-- "Where" -->
							<th>{m.shifts_colWho()}</th>
							<!-- "Who" -->
						</tr>
					</thead>
					<tbody>
						{#each day.rows as row (row.shift.id)}
							<tr class:short={row.shift.isShort}>
								<td class="time">
									{formatTimeOfDay(row.shift.startsAt)}–{formatTimeOfDay(row.shift.endsAt)}
								</td>
								<td>{row.station.name}</td>
								<td>{row.station.locationText}</td>
								<td>
									{#if row.shift.assignments.length === 0}
										<em>{m.shifts_nobodyYet()}</em>
										<!-- "— nobody —" -->
									{:else}
										{row.shift.assignments.map((a) => a.user.displayName).join(', ')}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/each}
		{#if !error && days.length === 0}
			<p class="status">{m.shifts_noShiftsYet()}</p>
			<!-- "No hours on this station yet." -->
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 900px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
	}
	.controls {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	h2 {
		font-size: 1.2rem;
		margin: 1.2rem 0 0.4rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 1.05rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.5rem 0.4rem 0;
		border-bottom: 1px solid var(--border);
	}
	.time {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	// The one thing a wall rota has to shout: a row nobody is standing in.
	tr.short td {
		font-weight: 700;
	}
	.status,
	.error {
		color: var(--text-secondary);
	}
	@media print {
		.controls {
			display: none;
		}
		.page {
			margin: 0;
			padding: 0;
			max-width: none;
		}
		:global(body) {
			background: #fff;
			color: #000;
		}
		table {
			font-size: 12pt;
		}
	}
</style>
