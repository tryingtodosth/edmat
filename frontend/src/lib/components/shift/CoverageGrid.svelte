<script lang="ts">
	/** Stations down, the event's own hours across — the one picture that answers "is anybody
	 * standing there?" for a whole day at a glance.
	 *
	 * **Not `CalendarWeek`.** That component draws seven days against a time axis and lays
	 * overlapping entries out side by side, which is the right picture for a tutor's week and the
	 * wrong one here: a rota's rows are *stations*, several shifts share a row on purpose, and what
	 * a cell has to show is a staffing count and its colour rather than a duration. A plain CSS
	 * grid with `grid-column: start / end` is both smaller and honest about what it is.
	 *
	 * Colours come from the backend's `isShort`, never recomputed here — the wall print, the screen
	 * and the API have to agree about what "short" means, and three implementations of that would
	 * be three chances to disagree.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate, formatTimeOfDay } from '$lib/utils/datetime';
	import type { CoverageCell } from '$lib/types/shift';

	let { cells, onpick }: { cells: CoverageCell[]; onpick?: (cell: CoverageCell) => void } =
		$props();

	/** One grid per calendar day: a two-day conference drawn on one 48-column axis is unreadable,
	 * and the day boundary is exactly where a reader's eye wants a break anyway. */
	type Day = {
		key: string;
		label: string;
		firstHour: number;
		lastHour: number;
		stations: { id: string; name: string; cells: CoverageCell[] }[];
	};

	const days = $derived.by<Day[]>(() => {
		// Plain objects rather than `Map`s: these are built fresh inside the derivation and thrown
		// away, nothing ever mutates them afterwards, and `svelte/prefer-svelte-reactivity` cannot
		// tell the difference — the lint rule is right about the general case and a `SvelteMap` here
		// would be reactive machinery around a local grouping loop.
		const byDay: Record<string, CoverageCell[]> = {};
		for (const cell of cells) {
			const key = new Date(cell.startsAt).toDateString();
			(byDay[key] ??= []).push(cell);
		}
		const out: Day[] = [];
		for (const [key, dayCells] of Object.entries(byDay)) {
			let firstHour = 24;
			let lastHour = 0;
			const stations: Record<string, { id: string; name: string; cells: CoverageCell[] }> = {};
			const order: string[] = [];
			for (const cell of dayCells) {
				const start = new Date(cell.startsAt);
				const end = new Date(cell.endsAt);
				firstHour = Math.min(firstHour, start.getHours());
				// A shift ending at 17:30 needs the 17 column drawn, one ending at 17:00 does not.
				lastHour = Math.max(lastHour, end.getMinutes() > 0 ? end.getHours() + 1 : end.getHours());
				if (!stations[cell.stationId]) {
					stations[cell.stationId] = { id: cell.stationId, name: cell.stationName, cells: [] };
					order.push(cell.stationId);
				}
				stations[cell.stationId].cells.push(cell);
			}
			out.push({
				key,
				label: formatDate(dayCells[0].startsAt),
				firstHour,
				lastHour: Math.max(lastHour, firstHour + 1),
				stations: order.map((id) => stations[id])
			});
		}
		// Sorted by the day's first shift, not by the `toDateString()` key — that key is
		// "Wed Sep 23 2026" and sorts alphabetically, which puts April before September.
		return out.sort((a, b) =>
			a.stations[0].cells[0].startsAt < b.stations[0].cells[0].startsAt ? -1 : 1
		);
	});

	// Two columns per hour, so a half-hour shift still has a cell of its own. `+2` because column 1
	// is the station name, and the result has to be a whole number — a fractional `grid-column` is
	// silently ignored by the browser and the cell lands in the wrong place.
	function column(day: Day, iso: string): number {
		const at = new Date(iso);
		const hours = at.getHours() + at.getMinutes() / 60;
		const clamped = Math.max(day.firstHour, Math.min(day.lastHour, hours));
		return Math.round((clamped - day.firstHour) * 2) + 2;
	}

	function tone(cell: CoverageCell): string {
		if (cell.confirmed === 0) return 'red';
		if (cell.isShort || cell.needsAdult) return 'amber';
		return 'green';
	}

	function toneLabel(cell: CoverageCell): string {
		const t = tone(cell);
		if (t === 'red') return m.shifts_coverageEmpty(); // "Nobody"
		if (t === 'green') return m.shifts_coverageFull(); // "Covered"
		return m.shifts_coverageShort(); // "Short"
	}

	function hours(day: Day): number[] {
		const out: number[] = [];
		for (let h = day.firstHour; h < day.lastHour; h += 1) out.push(h);
		return out;
	}
</script>

<div class="coverage">
	{#if cells.length === 0}
		<p class="status">{m.shifts_coverageEmptyGrid()}</p>
		<!-- "No shifts yet, so there is nothing to cover." -->
	{/if}
	{#each days as day (day.key)}
		<h4>{day.label}</h4>
		<div
			class="grid"
			style="--columns: {(day.lastHour - day.firstHour) * 2}"
			role="table"
			aria-label={m.shifts_coverageGridLabel({ day: day.label })}
		>
			<div class="corner" style="grid-row: 1"></div>
			{#each hours(day) as hour (hour)}
				<div
					class="hour"
					style="grid-row: 1; grid-column: {(hour - day.firstHour) * 2 + 2} / span 2"
				>
					{String(hour).padStart(2, '0')}
				</div>
			{/each}
			{#each day.stations as station, index (station.id)}
				<div class="station" style="grid-row: {index + 2}">{station.name}</div>
				{#each station.cells as cell (cell.shiftId)}
					<button
						type="button"
						class="cell {tone(cell)}"
						style="grid-row: {index + 2}; grid-column: {column(day, cell.startsAt)} / {Math.max(
							column(day, cell.endsAt),
							column(day, cell.startsAt) + 1
						)}"
						onclick={() => onpick?.(cell)}
						title="{formatTimeOfDay(cell.startsAt)}–{formatTimeOfDay(cell.endsAt)} · {toneLabel(
							cell
						)}"
					>
						<span class="count">{cell.confirmed}/{cell.needed}</span>
						{#if cell.needsAdult}
							<span class="flag" title={m.shifts_needsAdultFlag()}>!</span>
							<!-- "Needs an adult on this shift" -->
						{/if}
					</button>
				{/each}
			{/each}
		</div>
	{/each}
	<ul class="legend">
		<li><span class="swatch green"></span>{m.shifts_coverageFull()}</li>
		<!-- "Covered" -->
		<li><span class="swatch amber"></span>{m.shifts_coverageShort()}</li>
		<!-- "Short" -->
		<li><span class="swatch red"></span>{m.shifts_coverageEmpty()}</li>
		<!-- "Nobody" -->
	</ul>
</div>

<style lang="scss">
	.coverage {
		margin-top: 0.8rem;
	}
	h4 {
		margin: 0.8rem 0 0.35rem;
		font-size: 0.95rem;
	}
	.grid {
		display: grid;
		grid-template-columns: 9rem repeat(var(--columns), minmax(1.1rem, 1fr));
		gap: 2px;
		align-items: stretch;
		overflow-x: auto;
	}
	.corner {
		grid-column: 1;
	}
	.hour {
		font-size: 0.7rem;
		color: var(--text-secondary);
		text-align: left;
		border-left: 1px solid var(--border);
		padding-left: 2px;
	}
	.station {
		grid-column: 1;
		font-size: 0.8rem;
		padding: 0.25rem 0.4rem 0.25rem 0;
		display: flex;
		align-items: center;
	}
	.cell {
		border: 1px solid var(--border);
		border-radius: 5px;
		font: inherit;
		font-size: 0.72rem;
		padding: 0.25rem 0.2rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		min-height: 1.7rem;
		color: var(--text-primary);
	}
	// Colour is never the only carrier: every cell prints its own "2/3" and the flag is a glyph.
	.cell.green {
		background: color-mix(in srgb, #2e7d32 22%, transparent);
	}
	.cell.amber {
		background: color-mix(in srgb, #ef6c00 26%, transparent);
	}
	.cell.red {
		background: color-mix(in srgb, #c62828 26%, transparent);
	}
	.flag {
		font-weight: 700;
	}
	.legend {
		display: flex;
		gap: 0.9rem;
		list-style: none;
		padding: 0;
		margin: 0.6rem 0 0;
		font-size: 0.78rem;
		color: var(--text-secondary);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.swatch {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 3px;
		border: 1px solid var(--border);
		display: inline-block;
	}
	.swatch.green {
		background: color-mix(in srgb, #2e7d32 22%, transparent);
	}
	.swatch.amber {
		background: color-mix(in srgb, #ef6c00 26%, transparent);
	}
	.swatch.red {
		background: color-mix(in srgb, #c62828 26%, transparent);
	}
	.status {
		color: var(--text-secondary);
		font-size: 0.85rem;
	}
</style>
