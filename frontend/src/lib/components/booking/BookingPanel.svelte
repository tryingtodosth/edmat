<script lang="ts">
	// "Book this" on a tutoring listing — the student-facing half of the booking module.
	//
	// The notice at the top is not decoration. `derived` and `declared` produce identical-looking
	// grids of buttons that mean two genuinely different things ("this hour is free" versus "the
	// tutor teaches at this hour, and may already have somebody"), and a student who cannot tell
	// which they are looking at has been misled by the interface rather than by the tutor. So the
	// mode is stated in words, above the slots, in both cases — including the good one, because a
	// notice that only ever appears when something is qualified teaches people to distrust its
	// absence.
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

	let { service }: { service: Service } = $props();

	/** How many days one screenful covers. A week, because that is the unit people think about a
	 * timetable in, and because a fortnight of empty rows is a worse first impression than one week
	 * with a "next" button. */
	const WINDOW_DAYS = 7;

	let weekOffset = $state(0);
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

	function isoDay(offsetDays: number): string {
		const now = new Date();
		// The offset goes into the constructor rather than a `setDate()` afterwards: the constructor
		// normalises an out-of-range day itself (the 38th of March is the 7th of April), so nothing is
		// mutated — which is also what this project's `svelte/prefer-svelte-reactivity` rule wants,
		// since a mutated Date in reactive code is a real source of stale renders.
		const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
		// Built from the local Y/M/D parts rather than `toISOString()`, which converts to UTC first
		// and so hands back yesterday's date for anybody east of Greenwich late in the evening.
		return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
	}

	async function load() {
		loading = true;
		loadFailed = false;
		try {
			availability = await getServiceAvailability(service.id, {
				from: isoDay(weekOffset * WINDOW_DAYS),
				to: isoDay(weekOffset * WINDOW_DAYS + WINDOW_DAYS - 1)
			});
		} catch {
			loadFailed = true;
		} finally {
			loading = false;
		}
	}

	// Keyed on the week being viewed, so paging re-fetches and nothing else does — the same
	// "idempotency guard rather than a bare $effect" discipline the detail pages already use, since a
	// plain effect re-runs on unrelated reactive changes and would refetch on every keystroke in the
	// note field below.
	let loadedFor = $state<number | undefined>(undefined);
	$effect(() => {
		const offset = weekOffset;
		if (offset === loadedFor) return;
		loadedFor = offset;
		load();
	});

	let isOwnListing = $derived(authStore.user?.id === service.providerId);
	let daysWithSlots = $derived((availability?.days ?? []).filter((d) => d.slots.length > 0));

	function formatDay(iso: string): string {
		return new Intl.DateTimeFormat(getLocale(), {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(new Date(`${iso}T00:00:00`));
	}

	function formatTime(iso: string): string {
		return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(
			new Date(iso)
		);
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

		<nav class="weeks" aria-label={m.booking_weekNav()}>
			<button
				type="button"
				onclick={() => (weekOffset = Math.max(0, weekOffset - 1))}
				disabled={weekOffset === 0}
			>
				{m.booking_previousWeek()}
			</button>
			<button type="button" onclick={() => (weekOffset = weekOffset + 1)}>
				{m.booking_nextWeek()}
			</button>
		</nav>

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

		{#if isOwnListing}
			<p class="muted">
				{m.booking_ownListing()}
				<a href={resolve('/bookings')}>{m.booking_manageSchedule()}</a>
			</p>
		{:else if !authStore.isAuthenticated}
			<p class="muted"><a href={resolve('/login')}>{m.booking_loginToBook()}</a></p>
		{:else if selectedSlot}
			<div class="request">
				<p class="chosen">{m.booking_chosen({ time: formatTime(selectedSlot) })}</p>
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
	.weeks {
		display: flex;
		gap: var(--space-2);
		button {
			@include mix.button-secondary;
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-sm);
		}
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
