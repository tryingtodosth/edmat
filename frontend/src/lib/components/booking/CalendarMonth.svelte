<script lang="ts">
	// A month at a glance: which days have anything on them, and roughly how much.
	//
	// Deliberately a summary rather than a miniature week view. A month grid that tried to show every
	// session's time would be illegible at this size, and the question it exists to answer is a
	// different one — "which day should I look at?" — so a cell carries a count and a tone, and
	// clicking it hands the day back to the caller, which is what every real calendar does.
	//
	// Generic over `CalendarMonthDay` (calendar.ts), like CalendarWeek: the student's "days with free
	// slots" and the tutor's "days with sessions" are the same picture.
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { type CalendarMonthDay, fromIsoDate, isoDate, monthGridDays, monthOf } from './calendar';

	let {
		month,
		days,
		selected,
		onselect,
		cellLabel
	}: {
		month: string; // 'YYYY-MM'
		days: CalendarMonthDay[];
		selected?: string;
		onselect?: (date: string) => void;
		/** The accessible name for one cell. Supplied by the caller because only the caller knows what
		 * the count counts — "3 times free" and "3 sessions" are the same number and different
		 * sentences, and inventing one here would be wrong for whichever side did not write it. */
		cellLabel?: (day: CalendarMonthDay) => string;
	} = $props();

	let byDate = $derived(new Map(days.map((day) => [day.date, day])));
	let grid = $derived(monthGridDays(month));
	const today = isoDate(new Date());

	// Monday-first, matching the backend's own weekday numbering and both locales' convention. Built
	// from a real week through Intl rather than hardcoded, so the names come out translated (and
	// abbreviated the way each locale abbreviates) without a message key per day.
	let weekdayNames = $derived(
		Array.from({ length: 7 }, (_, index) =>
			new Intl.DateTimeFormat(getLocale(), { weekday: 'short' }).format(
				new Date(2024, 0, 1 + index) // 2024-01-01 was a Monday
			)
		)
	);

	function dayNumber(date: string): number {
		return fromIsoDate(date).getDate();
	}

	function defaultLabel(day: CalendarMonthDay): string {
		return `${new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long' }).format(fromIsoDate(day.date))} — ${day.count}`;
	}
</script>

<div class="month">
	<div class="month__weekdays" aria-hidden="true">
		{#each weekdayNames as name (name)}
			<span>{name}</span>
		{/each}
	</div>

	<div class="month__grid" role="grid" aria-label={m.booking_calendar_monthLabel()}>
		{#each grid as date (date)}
			{@const day = byDate.get(date)}
			{@const outside = monthOf(date) !== month}
			<!-- Every cell is a button, including the empty ones and the ones spilling in from the
			     neighbouring month. A day with nothing on it is still a day somebody may want to look
			     at, and making only the busy days selectable would mean the calendar quietly refused
			     the exact question "is anything happening on the 14th?". -->
			<button
				type="button"
				class="month__cell"
				class:month__cell--outside={outside}
				class:month__cell--today={date === today}
				class:month__cell--selected={date === selected}
				class:month__cell--has={(day?.count ?? 0) > 0}
				aria-label={day ? (cellLabel ? cellLabel(day) : defaultLabel(day)) : undefined}
				aria-pressed={date === selected}
				onclick={() => onselect?.(date)}
			>
				<span class="month__number">{dayNumber(date)}</span>
				{#if day && day.count > 0}
					<span class="month__count month__count--{day.tone ?? 'free'}">{day.count}</span>
				{:else if day?.marked}
					<span class="month__dot" aria-hidden="true"></span>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.month {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.month__weekdays,
	.month__grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}
	.month__weekdays span {
		text-align: center;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: capitalize;
	}
	.month__cell {
		@include mix.focus-ring;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		/* Square-ish, so the grid reads as a calendar rather than a table of numbers, and so a month
		   with six rows does not become taller than the screen. */
		aspect-ratio: 1 / 1;
		min-height: 2.5rem;
		padding: 2px;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
	}
	.month__cell--outside {
		opacity: 0.4;
	}
	.month__cell--today {
		border-color: var(--accent);
	}
	.month__cell--selected {
		background: var(--accent);
		color: var(--accent-contrast);
	}
	.month__number {
		line-height: 1;
	}
	.month__count {
		min-width: 1.25rem;
		padding: 0 4px;
		border-radius: 999px;
		font-size: var(--font-size-xs);
		font-weight: 600;
		line-height: 1.4;
	}
	.month__dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
		opacity: 0.6;
	}
	.month__cell--selected .month__dot {
		background: var(--accent-contrast);
		opacity: 1;
	}
	.month__count--free {
		background: var(--status-success-bg);
		color: var(--status-success);
	}
	.month__count--window {
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
	}
	.month__count--requested {
		background: var(--status-warning-bg);
		color: var(--status-warning);
	}
	.month__count--confirmed {
		background: var(--status-success-bg);
		color: var(--status-success);
	}
	.month__count--settled {
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
	}
	/* On a selected (accent) cell the pill's own tinted background disappears into it, so it borrows
	   the cell's colours instead of keeping a tone nobody can read. */
	.month__cell--selected .month__count {
		background: var(--accent-contrast);
		color: var(--accent);
	}
</style>
