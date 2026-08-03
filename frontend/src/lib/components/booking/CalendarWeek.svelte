<script lang="ts">
	// A week laid out against a time axis — the ordinary shape of a timetable, where the height of a
	// block is how long it lasts and two things at the same time sit side by side.
	//
	// Generic over `CalendarEntry` (calendar.ts) and used by both sides of this feature: a student's
	// bookable slots and a tutor's own schedule are the same picture drawn from different data. The
	// component knows nothing about bookings, availability modes or services — each caller resolves
	// its own domain objects into entries first.
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import {
		BACKGROUND_TONES,
		type CalendarEntry,
		fromIsoDate,
		isoDate,
		layOutDay,
		type LaidOutEntry,
		minutesIntoDay,
		visibleHours
	} from './calendar';

	let {
		days,
		entries,
		selectedId,
		onselect,
		emptyLabel
	}: {
		days: string[];
		entries: CalendarEntry[];
		selectedId?: string;
		onselect?: (entry: CalendarEntry) => void;
		emptyLabel?: string;
	} = $props();

	let hours = $derived(visibleHours(entries));
	let minMinutes = $derived(hours.from * 60);
	let spanMinutes = $derived((hours.to - hours.from) * 60);
	let hourMarks = $derived(
		Array.from({ length: hours.to - hours.from + 1 }, (_, index) => hours.from + index)
	);

	// Background bands are drawn per day in their own layer, un-laned: a published-hours band is
	// context, not an appointment, so it spans the full column width behind whatever sits on it.
	let backgroundByDay = $derived(
		new Map(
			days.map((day) => [
				day,
				entries.filter((entry) => entry.date === day && BACKGROUND_TONES.includes(entry.tone))
			])
		)
	);
	let foregroundByDay = $derived(
		new Map(
			days.map((day) => [
				day,
				layOutDay(
					entries.filter((entry) => entry.date === day && !BACKGROUND_TONES.includes(entry.tone)),
					minMinutes,
					spanMinutes
				)
			])
		)
	);

	const today = isoDate(new Date());

	function dayHeading(date: string): string {
		return new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric' }).format(
			fromIsoDate(date)
		);
	}

	/** Where an hour's line — and its label — sits, as a percentage of the visible span. One function
	 * for both, so the axis can never disagree with the grid beside it. */
	function linePosition(hour: number): string {
		return `top:${((hour * 60 - minMinutes) / spanMinutes) * 100}%`;
	}

	function placementStyle(placed: LaidOutEntry): string {
		return [
			`top:${placed.top * 100}%`,
			`height:${placed.height * 100}%`,
			`left:${(placed.lane / placed.lanes) * 100}%`,
			`width:${(1 / placed.lanes) * 100}%`
		].join(';');
	}

	function bandStyle(entry: CalendarEntry): string {
		const start = minutesIntoDay(entry.start);
		const rawEnd = minutesIntoDay(entry.end);
		const end = rawEnd <= start ? 24 * 60 : rawEnd;
		const top = ((start - minMinutes) / spanMinutes) * 100;
		const height = ((end - start) / spanMinutes) * 100;
		return `top:${top}%;height:${height}%`;
	}
</script>

{#snippet entryBody(entry: CalendarEntry)}
	<span class="week__entry-label">{entry.label}</span>
	{#if entry.sublabel}
		<span class="week__entry-sub">{entry.sublabel}</span>
	{/if}
{/snippet}

<div class="week">
	{#if entries.length === 0 && emptyLabel}
		<p class="empty">{emptyLabel}</p>
	{/if}

	<!-- Horizontally scrollable rather than reflowed on a narrow screen. Seven columns against a time
	     axis genuinely needs the width; collapsing it to a stack would produce the list view, which is
	     already offered as its own choice next to this one. -->
	<div class="week__scroll">
		<div class="week__head" style="--columns:{days.length}">
			<span class="week__axis-head" aria-hidden="true"></span>
			{#each days as day (day)}
				<span class="week__day-head" class:week__day-head--today={day === today}>
					{dayHeading(day)}
				</span>
			{/each}
		</div>

		<div class="week__body" style="--columns:{days.length};--rows:{hours.to - hours.from}">
			<div class="week__axis" aria-hidden="true">
				<!-- The same marks the hour lines use, positioned the same way (a percentage of the
				     visible span, from an inline style) so the label and its line cannot drift apart —
				     they did, when the labels were positioned by an nth-child rule in the stylesheet
				     that had to be kept in step with the row height by hand. The last mark is dropped:
				     it would sit on the bottom edge with nothing below it, and be clipped. -->
				{#each hourMarks.slice(0, -1) as hour (hour)}
					<span class="week__hour" style={linePosition(hour)}>
						{String(hour).padStart(2, '0')}:00
					</span>
				{/each}
			</div>

			{#each days as day (day)}
				<div class="week__column" class:week__column--today={day === today}>
					<!-- The hour lines are the column's own background, so they cannot drift out of step
					     with the axis labels beside them. -->
					{#each hourMarks.slice(0, -1) as hour (hour)}
						<span class="week__line" style={linePosition(hour)}></span>
					{/each}

					{#each backgroundByDay.get(day) ?? [] as band (band.id)}
						<span class="week__band" style={bandStyle(band)} title={band.label}></span>
					{/each}

					{#each foregroundByDay.get(day) ?? [] as placed (placed.entry.id)}
						{@const entry = placed.entry}
						<!-- A real <button> when it does something and a plain <div> when it does not — two
						     branches rather than one `<svelte:element>` switching between them. A bookable
						     slot has to be focusable and announced as pressable, and a session somebody is
						     merely looking at must not pretend to be; a dynamic tag leaves the compiler
						     unable to check either, which it says so about. The shared innards live in one
						     snippet, so the two branches cannot drift. -->
						{#if entry.interactive && onselect}
							<button
								type="button"
								class="week__entry week__entry--{entry.tone}"
								class:week__entry--selected={entry.id === selectedId}
								aria-pressed={entry.id === selectedId}
								style={placementStyle(placed)}
								onclick={() => onselect(entry)}
							>
								{@render entryBody(entry)}
							</button>
						{:else}
							<div class="week__entry week__entry--{entry.tone}" style={placementStyle(placed)}>
								{@render entryBody(entry)}
							</div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	</div>

	<p class="week__hint">{m.booking_calendar_scrollHint()}</p>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.week {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.empty {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.week__scroll {
		overflow-x: auto;
	}
	.week__head,
	.week__body {
		display: grid;
		grid-template-columns: 3.5rem repeat(var(--columns), minmax(5.5rem, 1fr));
		min-width: 42rem;
	}
	.week__head {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--bg-surface);
	}
	.week__day-head {
		padding: var(--space-1) 0;
		text-align: center;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: capitalize;
		border-bottom: 1px solid var(--border-color);
	}
	.week__day-head--today {
		color: var(--accent);
	}
	.week__axis-head {
		border-bottom: 1px solid var(--border-color);
	}
	.week__body {
		/* One row per hour, so the grid's own height follows how many hours are actually in view
		   rather than a fixed pixel figure that would squash a long day. */
		height: calc(var(--rows) * 3rem);
	}
	.week__axis {
		position: relative;
		border-right: 1px solid var(--border-color);
	}
	.week__hour {
		position: absolute;
		right: var(--space-1);
		/* Sits just under its own line rather than centred on it — centring pulled the first label
		   half-way out of the top of the grid, where it was clipped. This is also how a paper
		   timetable reads: the label belongs to the hour that starts there. */
		padding-top: 2px;
		font-size: var(--font-size-xs);
		line-height: 1;
		color: var(--text-secondary);
	}
	.week__column {
		position: relative;
		border-right: 1px solid var(--border-color);
	}
	.week__column--today {
		background: var(--bg-surface-alt);
	}
	.week__line {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--border-color);
		opacity: 0.5;
	}
	.week__band {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--accent);
		opacity: 0.12;
		border-radius: var(--radius-sm);
	}
	.week__entry {
		@include mix.focus-ring;
		position: absolute;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 2px 4px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: var(--font-size-xs);
		text-align: left;
		line-height: 1.15;
	}
	button.week__entry {
		cursor: pointer;
	}
	.week__entry-label {
		font-weight: 600;
	}
	.week__entry-sub {
		opacity: 0.85;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.week__entry--free {
		background: var(--bg-surface);
		border-color: var(--accent);
		color: var(--accent);
	}
	.week__entry--selected {
		background: var(--accent);
		color: var(--accent-contrast);
	}
	.week__entry--requested {
		background: var(--status-warning-bg);
		border-color: var(--status-warning);
		color: var(--status-warning);
	}
	.week__entry--confirmed {
		background: var(--status-success-bg);
		border-color: var(--status-success);
		color: var(--status-success);
	}
	.week__entry--settled {
		background: var(--bg-surface-alt);
		border-color: var(--border-color);
		color: var(--text-secondary);
		text-decoration: line-through;
	}
	.week__hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	@media (min-width: 720px) {
		.week__hint {
			display: none;
		}
	}
</style>
