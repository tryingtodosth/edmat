<script lang="ts">
	// "Book this" on a tutoring listing — the student-facing half of the booking module.
	//
	// The notice at the top is not decoration. `derived` and `declared` produce identical-looking
	// grids of slots that mean two genuinely different things ("this hour is free" versus "the tutor
	// teaches at this hour, and may already have somebody"), and a student who cannot tell which they
	// are looking at has been misled by the interface rather than by the tutor. So the mode is stated
	// in words, above the slots, in both cases — including the good one, because a notice that only
	// ever appears when something is qualified teaches people to distrust its absence.
	//
	// Three views over the same data, because "when is this person free" is really asked at three
	// scales: a list to read straight through, a week against a time axis to judge whether an hour
	// fits around your own timetable, and a month to find which week is worth opening at all.
	import { resolve } from '$app/paths';
	import type { Service, ServiceAvailability } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import {
		SlotUnavailableError,
		getServiceAvailability,
		requestBooking
	} from '$lib/services/booking';
	import { authStore } from '$lib/state/auth.svelte';
	import CalendarMonth from './CalendarMonth.svelte';
	import CalendarWeek from './CalendarWeek.svelte';
	import ViewSwitcher from './ViewSwitcher.svelte';
	import {
		type CalendarEntry,
		type CalendarMonthDay,
		dayRange,
		fromIsoDate,
		isoDate,
		monthGridDays,
		monthOf,
		shiftMonth,
		startOfWeek
	} from './calendar';

	let { service }: { service: Service } = $props();

	type View = 'list' | 'week' | 'month';
	let view = $state<View>('list');
	/** The first day of the range on screen — a Monday in list/week, the 1st in month. One anchor for
	 * all three views, so switching between them keeps you where you were rather than snapping back
	 * to today. */
	let anchor = $state(isoDate(startOfWeek(new Date())));

	let availability = $state<ServiceAvailability | undefined>(undefined);
	let loading = $state(true);
	let loadFailed = $state(false);

	let selectedSlot = $state<string | undefined>(undefined);
	let note = $state('');
	let submitting = $state(false);
	/** Distinguished from a generic failure on purpose: a slot taken between render and click is the
	 * one error whose right answer is "here is the refreshed calendar, pick again". */
	let slotGone = $state(false);
	let requestFailed = $state(false);
	let requested = $state(false);

	/** The days the current view needs. A month asks for the whole grid, including the spill-over days
	 * from the neighbouring months, so those cells are honest rather than blank by omission. */
	let visibleDays = $derived(
		view === 'month' ? monthGridDays(monthOf(anchor)) : dayRange(fromIsoDate(anchor), 7)
	);

	/** How far ahead the backend will answer (its own MAX_HORIZON_DAYS). Paging past it would show
	 * empty periods indistinguishable from genuinely empty ones, so the arrow stops instead. */
	const HORIZON_DAYS = 90;
	function today(): Date {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), now.getDate());
	}
	let horizon = $derived(
		isoDate(new Date(today().getFullYear(), today().getMonth(), today().getDate() + HORIZON_DAYS))
	);
	let atStart = $derived(visibleDays[visibleDays.length - 1] < isoDate(today()));
	let atEnd = $derived(visibleDays[0] > horizon);

	async function load() {
		loading = true;
		loadFailed = false;
		try {
			availability = await getServiceAvailability(service.id, {
				from: visibleDays[0],
				to: visibleDays[visibleDays.length - 1]
			});
		} catch {
			loadFailed = true;
		} finally {
			loading = false;
		}
	}

	// Keyed on the range actually on screen, so paging or widening the view refetches and nothing else
	// does — the same "idempotency guard rather than a bare $effect" discipline the detail pages
	// already use, since a plain effect re-runs on unrelated reactive changes and would refetch on
	// every keystroke in the note field below.
	let loadedFor = $state<string | undefined>(undefined);
	$effect(() => {
		const range = `${visibleDays[0]}..${visibleDays[visibleDays.length - 1]}`;
		if (range === loadedFor) return;
		loadedFor = range;
		load();
	});

	let isOwnListing = $derived(authStore.user?.id === service.providerId);
	let daysWithSlots = $derived((availability?.days ?? []).filter((day) => day.slots.length > 0));
	let canPick = $derived(!isOwnListing && authStore.isAuthenticated);

	/** Every published slot as a calendar block. One resolution, both calendar views — the components
	 * themselves know nothing about availability modes or services (see calendar.ts). */
	let entries = $derived<CalendarEntry[]>(
		(availability?.days ?? []).flatMap((day) =>
			day.slots.map((slot) => ({
				id: slot.start,
				date: day.date,
				start: slot.start,
				end: slot.end,
				label: formatTime(slot.start),
				tone: 'free' as const,
				interactive: canPick
			}))
		)
	);

	let monthDays = $derived<CalendarMonthDay[]>(
		(availability?.days ?? []).map((day) => ({
			date: day.date,
			count: day.slots.length,
			tone: 'free' as const
		}))
	);

	function formatDay(iso: string): string {
		return new Intl.DateTimeFormat(getLocale(), {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(fromIsoDate(iso));
	}

	function formatTime(iso: string): string {
		return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(
			new Date(iso)
		);
	}

	function formatShort(iso: string): string {
		return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(
			fromIsoDate(iso)
		);
	}

	let periodLabel = $derived(
		view === 'month'
			? new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(
					fromIsoDate(`${monthOf(anchor)}-01`)
				)
			: `${formatShort(visibleDays[0])} – ${formatShort(visibleDays[visibleDays.length - 1])}`
	);

	function step(direction: number) {
		if (view === 'month') {
			anchor = `${shiftMonth(monthOf(anchor), direction)}-01`;
		} else {
			const from = fromIsoDate(anchor);
			anchor = isoDate(
				new Date(from.getFullYear(), from.getMonth(), from.getDate() + direction * 7)
			);
		}
		selectedSlot = undefined;
	}

	function goToday() {
		anchor =
			view === 'month' ? `${monthOf(isoDate(new Date()))}-01` : isoDate(startOfWeek(new Date()));
	}

	function changeView(next: string) {
		const wanted = next as View;
		// Switching re-anchors to the same moment in the other view's own units, so "the week of the
		// 12th" becomes "the month containing the 12th" and back, rather than jumping to today.
		if (wanted === 'month' && view !== 'month') anchor = `${monthOf(anchor)}-01`;
		if (wanted !== 'month' && view === 'month') anchor = isoDate(startOfWeek(fromIsoDate(anchor)));
		view = wanted;
		selectedSlot = undefined;
	}

	/** Clicking a day in the month view opens that week — the ordinary calendar gesture, and the only
	 * way a month cell can lead anywhere useful given it deliberately shows counts rather than times. */
	function openDay(date: string) {
		anchor = isoDate(startOfWeek(fromIsoDate(date)));
		view = 'week';
	}

	function pick(start: string) {
		selectedSlot = selectedSlot === start ? undefined : start;
		slotGone = false;
		requestFailed = false;
	}

	async function submit() {
		if (!selectedSlot) return;
		submitting = true;
		slotGone = false;
		requestFailed = false;
		try {
			await requestBooking(service.id, selectedSlot, note);
			requested = true;
			selectedSlot = undefined;
			note = '';
			// Refetch rather than removing the slot locally: in `derived` mode it has genuinely gone,
			// and in `declared` mode it genuinely has not — asking the server is the only way to show
			// the right one without re-implementing the mode rule here.
			await load();
		} catch (e) {
			if (e instanceof SlotUnavailableError) {
				slotGone = true;
				await load();
			} else {
				requestFailed = true;
			}
		} finally {
			submitting = false;
		}
	}
</script>

<section class="booking">
	<h2>{m.booking_heading()}</h2>

	{#if loading && !availability}
		<p class="muted">{m.common_loading()}</p>
	{:else if loadFailed}
		<p class="error">{m.booking_loadFailed()}</p>
	{:else if availability && !availability.hasSchedule}
		<!-- "Nobody wrote a schedule" and "every hour is taken" are indistinguishable from an empty
		     grid, and want completely different words — hence the backend's own `has_schedule` flag
		     rather than inferring it from the slot count. -->
		<p class="muted">{m.booking_noSchedule()}</p>
	{:else}
		<p class="mode-notice" class:mode-notice--declared={availability?.mode === 'declared'}>
			{availability?.mode === 'declared' ? m.booking_notice_declared() : m.booking_notice_derived()}
		</p>

		<ViewSwitcher
			value={view}
			options={[
				{ value: 'list', label: m.booking_view_list() },
				{ value: 'week', label: m.booking_view_week() },
				{ value: 'month', label: m.booking_view_month() }
			]}
			onchange={changeView}
			onprevious={() => step(-1)}
			onnext={() => step(1)}
			ontoday={goToday}
			{periodLabel}
			previousDisabled={atStart}
			nextDisabled={atEnd}
		/>

		{#if view === 'list'}
			{#if daysWithSlots.length === 0}
				<p class="muted">{m.booking_noSlotsThisWeek()}</p>
			{:else}
				<ul class="days">
					{#each daysWithSlots as day (day.date)}
						<li class="day">
							<h3>{formatDay(day.date)}</h3>
							<div class="slots">
								{#each day.slots as slot (slot.start)}
									<button
										type="button"
										class="slot"
										class:slot--selected={selectedSlot === slot.start}
										aria-pressed={selectedSlot === slot.start}
										onclick={() => pick(slot.start)}
									>
										{formatTime(slot.start)}
									</button>
								{/each}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if view === 'week'}
			<CalendarWeek
				days={visibleDays}
				{entries}
				selectedId={selectedSlot}
				onselect={(entry) => pick(entry.start)}
				emptyLabel={m.booking_noSlotsThisWeek()}
			/>
		{:else}
			<CalendarMonth
				month={monthOf(anchor)}
				days={monthDays}
				onselect={openDay}
				cellLabel={(day) => m.booking_calendar_dayFree({ count: day.count })}
			/>
			<p class="muted">{m.booking_calendar_monthHint()}</p>
		{/if}

		{#if isOwnListing}
			<p class="muted">
				{m.booking_ownListing()}
				<a href={resolve('/bookings')}>{m.booking_manageSchedule()}</a>
			</p>
		{:else if !authStore.isAuthenticated}
			<p class="muted"><a href={resolve('/login')}>{m.booking_loginToBook()}</a></p>
		{:else if selectedSlot}
			<div class="request">
				<p class="chosen">
					{m.booking_chosen({
						time: `${formatShort(selectedSlot.slice(0, 10))} ${formatTime(selectedSlot)}`
					})}
				</p>
				<label class="field">
					<span>{m.booking_noteLabel()} <em>({m.common_optional()})</em></span>
					<textarea rows="2" bind:value={note} maxlength="2000"></textarea>
				</label>
				<button type="button" class="submit" onclick={submit} disabled={submitting}>
					{submitting ? m.common_loading() : m.booking_request()}
				</button>
			</div>
		{/if}

		{#if slotGone}
			<p class="error">{m.booking_slotGone()}</p>
		{/if}
		{#if requestFailed}
			<p class="error">{m.booking_requestFailed()}</p>
		{/if}
		{#if requested}
			<!-- "Requested", never "booked". The tutor confirms in BOTH modes, and telling somebody
			     they have an appointment when what they have is a question would be the single most
			     misleading sentence this feature could say. -->
			<p class="notice">
				{m.booking_requestSent()}
				<a href={resolve('/bookings')}>{m.booking_seeYourBookings()}</a>
			</p>
		{/if}
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.booking {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	h3 {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.muted {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.mode-notice {
		font-size: var(--font-size-sm);
		border-left: 3px solid var(--accent);
		padding-left: var(--space-2);
		color: var(--text-secondary);
	}
	.mode-notice--declared {
		border-left-color: var(--status-warning);
	}
	.days {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		list-style: none;
		padding: 0;
	}
	.day {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.slots {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.slot {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-sm);
		&--selected {
			background: var(--accent);
			color: var(--accent-contrast);
			border-color: var(--accent);
		}
	}
	.request {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
	}
	.chosen {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
		em {
			color: var(--text-secondary);
			font-weight: 400;
		}
		textarea {
			@include mix.focus-ring;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
			font-family: inherit;
			resize: vertical;
		}
	}
	.submit {
		@include mix.button-primary;
		align-self: flex-start;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
		a {
			color: inherit;
			text-decoration: underline;
		}
	}
</style>
