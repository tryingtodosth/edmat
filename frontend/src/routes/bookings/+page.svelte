<script lang="ts">
	// "My schedule" — one page, three tabs, because they are three views of the same calendar rather
	// than three features. Splitting them across routes would mean a tutor answering a request has to
	// leave the page to check whether they had already blocked that afternoon.
	//
	//   Requests    — bookings made WITH you: what to answer, and what is coming up.
	//   My bookings — bookings YOU made with somebody else.
	//   Availability — the weekly rules and one-off exceptions everything above is computed from.
	//
	// Most accounts here are both a tutor and a student (the same reasoning messaging's own single
	// inbox already follows), so neither side is hidden behind a role the account has to hold.
	import { resolve } from '$app/paths';
	import type {
		AvailabilityException,
		AvailabilityRule,
		Booking,
		Service,
		TutorSchedule
	} from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import {
		BookingConflictError,
		cancelBooking,
		completeBooking,
		confirmBooking,
		createAvailabilityException,
		createAvailabilityRule,
		declineBooking,
		deleteAvailabilityException,
		deleteAvailabilityRule,
		getAvailabilityExceptions,
		getAvailabilityRules,
		getBookings
	} from '$lib/services/booking';
	import { getMySchedule } from '$lib/services/booking';
	import { getMyServices } from '$lib/services/tutoring';
	import { authStore } from '$lib/state/auth.svelte';
	import CalendarMonth from '$lib/components/booking/CalendarMonth.svelte';
	import CalendarWeek from '$lib/components/booking/CalendarWeek.svelte';
	import ViewSwitcher from '$lib/components/booking/ViewSwitcher.svelte';
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
	} from '$lib/components/booking/calendar';

	type Tab = 'incoming' | 'mine' | 'availability';
	let tab = $state<Tab>('incoming');

	let incoming = $state<Booking[]>([]);
	let mine = $state<Booking[]>([]);
	let rules = $state<AvailabilityRule[]>([]);
	let exceptions = $state<AvailabilityException[]>([]);
	let myServices = $state<Service[]>([]);
	let loading = $state(true);
	let actionError = $state('');

	// The weekday vocabulary is Monday-first and 0-based, matching Python's `date.weekday()`, which
	// is what the backend compares a rule against — see AvailabilityRule (types/booking.ts) for why
	// the wire format follows the side doing the arithmetic rather than JS's Sunday-first `getDay()`.
	const WEEKDAYS = $derived([
		m.booking_weekday_monday(),
		m.booking_weekday_tuesday(),
		m.booking_weekday_wednesday(),
		m.booking_weekday_thursday(),
		m.booking_weekday_friday(),
		m.booking_weekday_saturday(),
		m.booking_weekday_sunday()
	]);

	let newRule = $state({ weekday: 0, startTime: '14:00', endTime: '16:00', serviceId: '' });
	let newException = $state({
		date: '',
		kind: 'block' as 'block' | 'open',
		startTime: '',
		endTime: '',
		note: ''
	});
	let ruleError = $state('');
	let exceptionError = $state('');

	function todayIso(): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	}

	// Deliberately does NOT clear `actionError`. A real bug found by driving this in a browser: the
	// refusal path below sets the message and then reloads to show the world as it now is, and a
	// reset here silently wiped the explanation on its way past — the tutor saw the list rearrange
	// itself with no word about why their click had not worked. Callers clear it before acting
	// instead, which is the moment it actually stops being true.
	async function load() {
		loading = true;
		try {
			const [asTutor, asStudent, ruleRows, exceptionRows, services] = await Promise.all([
				getBookings({ role: 'tutor' }),
				getBookings({ role: 'student' }),
				getAvailabilityRules(),
				getAvailabilityExceptions(todayIso()),
				getMyServices()
			]);
			incoming = asTutor;
			mine = asStudent;
			rules = ruleRows;
			exceptions = exceptionRows;
			myServices = services;
		} catch {
			actionError = m.booking_loadFailed();
		} finally {
			loading = false;
		}
	}

	// A real `$effect` on `isAuthenticated` rather than a one-shot `onMount` check: a hard reload
	// re-runs the root layout's own async `authStore.init()` from scratch, which has not necessarily
	// resolved by the time this component mounts — the exact race CLAUDE.md records the messages page
	// having shipped with once. `loadedOnce` stops it re-firing and resetting the tab afterwards.
	let loadedOnce = $state(false);
	$effect(() => {
		if (!authStore.isAuthenticated || loadedOnce) return;
		loadedOnce = true;
		load();
	});

	function formatWhen(iso: string): string {
		return new Intl.DateTimeFormat(getLocale(), {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}

	const STATUS_LABEL: Record<Booking['status'], () => string> = {
		requested: () => m.booking_status_requested(),
		confirmed: () => m.booking_status_confirmed(),
		declined: () => m.booking_status_declined(),
		cancelled: () => m.booking_status_cancelled(),
		completed: () => m.booking_status_completed()
	};

	async function act(what: 'confirm' | 'decline' | 'cancel' | 'complete', booking: Booking) {
		actionError = '';
		try {
			if (what === 'confirm') await confirmBooking(booking.id);
			else if (what === 'decline') await declineBooking(booking.id);
			else if (what === 'cancel') await cancelBooking(booking.id);
			else await completeBooking(booking.id);
			await load();
		} catch (e) {
			// A 409 is not "something went wrong" — it is the world having moved (somebody else acted,
			// or the tutor already has that hour confirmed), so it gets its own sentence and a reload
			// rather than a generic failure the user would keep retrying. The reload comes FIRST and
			// the message is set after it, so the refreshed list and the explanation of why it changed
			// arrive together rather than the one overwriting the other.
			if (e instanceof BookingConflictError) await load();
			actionError = e instanceof BookingConflictError ? e.message : m.booking_actionFailed();
		}
	}

	async function addRule(event: SubmitEvent) {
		event.preventDefault();
		ruleError = '';
		try {
			await createAvailabilityRule({
				weekday: newRule.weekday,
				startTime: newRule.startTime,
				endTime: newRule.endTime,
				serviceId: newRule.serviceId || undefined
			});
			rules = await getAvailabilityRules();
		} catch {
			ruleError = m.booking_ruleFailed();
		}
	}

	async function addException(event: SubmitEvent) {
		event.preventDefault();
		exceptionError = '';
		try {
			await createAvailabilityException({
				date: newException.date,
				kind: newException.kind,
				startTime: newException.startTime || undefined,
				endTime: newException.endTime || undefined,
				note: newException.note
			});
			exceptions = await getAvailabilityExceptions(todayIso());
			newException = { date: '', kind: 'block', startTime: '', endTime: '', note: '' };
		} catch {
			exceptionError = m.booking_exceptionFailed();
		}
	}

	async function removeRule(id: string) {
		await deleteAvailabilityRule(id);
		rules = await getAvailabilityRules();
	}

	async function removeException(id: string) {
		await deleteAvailabilityException(id);
		exceptions = await getAvailabilityExceptions(todayIso());
	}

	// ---- the calendar over the tutor's own schedule -------------------------------------------
	//
	// Read from its own endpoint rather than assembled here out of `rules` + `exceptions` + `incoming`.
	// Expanding a weekly rule over real dates, adding one-off openings and then subtracting blocks is
	// exactly the arithmetic booking/availability.py exists to own, and a second implementation of it
	// in the browser is how the calendar and the slots a student is offered start disagreeing.

	type CalendarView = 'week' | 'month';
	let calendarView = $state<CalendarView>('week');
	let calendarAnchor = $state(isoDate(startOfWeek(new Date())));
	let schedule = $state<TutorSchedule | undefined>(undefined);
	let scheduleFailed = $state(false);

	let calendarDays = $derived(
		calendarView === 'month'
			? monthGridDays(monthOf(calendarAnchor))
			: dayRange(fromIsoDate(calendarAnchor), 7)
	);

	async function loadSchedule() {
		scheduleFailed = false;
		try {
			schedule = await getMySchedule(calendarDays[0], calendarDays[calendarDays.length - 1]);
		} catch {
			scheduleFailed = true;
		}
	}

	// Only fetches while the calendar is actually on screen, and only when the range changes — the
	// same range-keyed guard the student-facing panel uses, for the same reason a bare $effect would
	// refetch on every keystroke in the forms below.
	let scheduleLoadedFor = $state<string | undefined>(undefined);
	$effect(() => {
		if (!authStore.isAuthenticated || tab !== 'availability') return;
		const range = `${calendarDays[0]}..${calendarDays[calendarDays.length - 1]}`;
		if (range === scheduleLoadedFor) return;
		scheduleLoadedFor = range;
		loadSchedule();
	});

	/** Which statuses belong on a calendar at all.
	 *
	 * A declined or cancelled session is not an appointment, and drawing it would fill the week with
	 * blocks nobody is going to attend. A completed one stays, because looking back at what you
	 * actually taught last week is half of why anybody opens a calendar. */
	const ON_CALENDAR: Booking['status'][] = ['requested', 'confirmed', 'completed'];
	const TONE_FOR_STATUS: Record<string, CalendarEntry['tone']> = {
		requested: 'requested',
		confirmed: 'confirmed',
		completed: 'settled'
	};

	let calendarEntries = $derived<CalendarEntry[]>([
		// Published hours first, as background bands — the point of the tutor's own calendar is seeing
		// each booking sitting INSIDE the window it occupies, which is exactly what the student-facing
		// endpoint (correctly) subtracts away.
		...(schedule?.days ?? []).flatMap((day) =>
			day.windows.map((window) => ({
				id: `window-${day.date}-${window.start}`,
				date: day.date,
				start: window.start,
				end: window.end,
				label: m.booking_calendar_published(),
				tone: 'window' as const
			}))
		),
		...(schedule?.bookings ?? [])
			.filter((booking) => ON_CALENDAR.includes(booking.status))
			.map((booking) => ({
				id: booking.id,
				date: booking.startsAt.slice(0, 10),
				start: booking.startsAt,
				end: booking.endsAt,
				// Whichever party is not you — a calendar row saying your own name would be useless, and
				// this page shows both the lessons you teach and the ones you take.
				label:
					booking.tutorId === authStore.user?.id
						? booking.studentDisplayName
						: booking.tutorDisplayName,
				sublabel: booking.serviceTitle,
				tone: TONE_FOR_STATUS[booking.status] ?? 'confirmed'
			}))
	]);

	let calendarMonthDays = $derived<CalendarMonthDay[]>(
		(schedule?.days ?? []).map((day) => {
			const onDay = (schedule?.bookings ?? []).filter(
				(booking) =>
					booking.startsAt.slice(0, 10) === day.date && ON_CALENDAR.includes(booking.status)
			);
			return {
				date: day.date,
				count: onDay.length,
				// A pending request is the thing on that day that needs you, so it wins the colour.
				tone: onDay.some((booking) => booking.status === 'requested') ? 'requested' : 'confirmed',
				// Published hours with nothing booked into them yet: a dot rather than a number, since
				// it is a different fact from the count beside it.
				marked: day.windows.length > 0
			};
		})
	);

	let calendarPeriodLabel = $derived(
		calendarView === 'month'
			? new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(
					fromIsoDate(`${monthOf(calendarAnchor)}-01`)
				)
			: `${formatShortDay(calendarDays[0])} – ${formatShortDay(calendarDays[calendarDays.length - 1])}`
	);

	function formatShortDay(iso: string): string {
		return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(
			fromIsoDate(iso)
		);
	}

	function stepCalendar(direction: number) {
		if (calendarView === 'month') {
			calendarAnchor = `${shiftMonth(monthOf(calendarAnchor), direction)}-01`;
		} else {
			const from = fromIsoDate(calendarAnchor);
			calendarAnchor = isoDate(
				new Date(from.getFullYear(), from.getMonth(), from.getDate() + direction * 7)
			);
		}
	}

	function changeCalendarView(next: string) {
		const wanted = next as CalendarView;
		// Re-anchored into the other view's own units, so switching keeps you where you were looking
		// rather than snapping back to today.
		calendarAnchor =
			wanted === 'month'
				? `${monthOf(calendarAnchor)}-01`
				: isoDate(startOfWeek(fromIsoDate(calendarAnchor)));
		calendarView = wanted;
	}

	let pendingCount = $derived(incoming.filter((b) => b.status === 'requested').length);
	function serviceTitle(id?: string): string {
		return myServices.find((s) => s.id === id)?.title ?? '';
	}
</script>

<svelte:head>
	<title>{m.booking_pageTitle()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.booking_pageTitle()}</h1>

	{#if !authStore.isAuthenticated}
		<p class="muted"><a href={resolve('/login')}>{m.booking_loginToBook()}</a></p>
	{:else}
		<nav class="tabs" aria-label={m.booking_pageTitle()}>
			<button type="button" class:active={tab === 'incoming'} onclick={() => (tab = 'incoming')}>
				{m.booking_tab_incoming()}{pendingCount > 0 ? ` (${pendingCount})` : ''}
			</button>
			<button type="button" class:active={tab === 'mine'} onclick={() => (tab = 'mine')}>
				{m.booking_tab_mine()}
			</button>
			<button
				type="button"
				class:active={tab === 'availability'}
				onclick={() => (tab = 'availability')}
			>
				{m.booking_tab_availability()}
			</button>
		</nav>

		{#if actionError}
			<p class="error">{actionError}</p>
		{/if}

		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if tab === 'incoming'}
			{#if incoming.length === 0}
				<p class="muted">{m.booking_noIncoming()}</p>
			{:else}
				<ul class="bookings">
					{#each incoming as booking (booking.id)}
						<li class="booking">
							<div class="booking__head">
								<strong>{formatWhen(booking.startsAt)}</strong>
								<span class="pill pill--{booking.status}">{STATUS_LABEL[booking.status]()}</span>
							</div>
							<p class="booking__who">
								{m.booking_withStudent({
									student: booking.studentDisplayName,
									listing: booking.serviceTitle
								})}
							</p>
							{#if booking.studentNote}
								<p class="booking__note">&ldquo;{booking.studentNote}&rdquo;</p>
							{/if}
							{#if booking.status === 'requested' && booking.overlappingCount > 0}
								<!-- The one thing a tutor running a `declared` listing genuinely needs before
								     deciding: that this hour is contested. Confirming one request does NOT
								     auto-decline the others — they may be the same study group, or worth a
								     counter-offer — but nobody should have to decide blind. -->
								<p class="booking__clash">
									{m.booking_clashWarning({ count: booking.overlappingCount })}
								</p>
							{/if}
							<div class="booking__actions">
								{#if booking.status === 'requested'}
									<button type="button" class="primary" onclick={() => act('confirm', booking)}>
										{m.booking_confirm()}
									</button>
									<button type="button" onclick={() => act('decline', booking)}>
										{m.booking_decline()}
									</button>
								{:else if booking.status === 'confirmed'}
									<button type="button" onclick={() => act('complete', booking)}>
										{m.booking_markComplete()}
									</button>
									<button type="button" onclick={() => act('cancel', booking)}>
										{m.booking_cancel()}
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if tab === 'mine'}
			{#if mine.length === 0}
				<p class="muted">
					{m.booking_noneOfMine()}
					<a href={resolve('/services')}>{m.booking_findATutor()}</a>
				</p>
			{:else}
				<ul class="bookings">
					{#each mine as booking (booking.id)}
						<li class="booking">
							<div class="booking__head">
								<strong>{formatWhen(booking.startsAt)}</strong>
								<span class="pill pill--{booking.status}">{STATUS_LABEL[booking.status]()}</span>
							</div>
							<p class="booking__who">
								{m.booking_withTutor({
									tutor: booking.tutorDisplayName,
									listing: booking.serviceTitle
								})}
							</p>
							{#if booking.tutorNote}
								<p class="booking__note">&ldquo;{booking.tutorNote}&rdquo;</p>
							{/if}
							{#if booking.status === 'requested' || booking.status === 'confirmed'}
								<div class="booking__actions">
									<button type="button" onclick={() => act('cancel', booking)}>
										{m.booking_cancel()}
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<!-- The calendar comes first, and the two editors below it are what produce it: a tutor
			     opening this tab wants to see the shape of their week before deciding whether to change
			     a rule. Week and month only — there is no list view here, because the rules and
			     exceptions listed underneath already ARE the list, and offering a third rendering of
			     the same facts on the same screen would be noise. -->
			<section class="panel">
				<h2>{m.booking_calendar_heading()}</h2>
				<ViewSwitcher
					value={calendarView}
					options={[
						{ value: 'week', label: m.booking_view_week() },
						{ value: 'month', label: m.booking_view_month() }
					]}
					onchange={changeCalendarView}
					onprevious={() => stepCalendar(-1)}
					onnext={() => stepCalendar(1)}
					ontoday={() =>
						(calendarAnchor =
							calendarView === 'month'
								? `${monthOf(isoDate(new Date()))}-01`
								: isoDate(startOfWeek(new Date())))}
					periodLabel={calendarPeriodLabel}
				/>
				{#if scheduleFailed}
					<p class="error">{m.booking_loadFailed()}</p>
				{:else if !schedule}
					<p class="muted">{m.common_loading()}</p>
				{:else if calendarView === 'week'}
					<CalendarWeek
						days={calendarDays}
						entries={calendarEntries}
						emptyLabel={m.booking_calendar_emptyWeek()}
					/>
					<p class="muted legend">{m.booking_calendar_legend()}</p>
				{:else}
					<CalendarMonth
						month={monthOf(calendarAnchor)}
						days={calendarMonthDays}
						cellLabel={(day) => m.booking_calendar_daySessions({ count: day.count })}
						onselect={(date) => {
							calendarAnchor = isoDate(startOfWeek(fromIsoDate(date)));
							calendarView = 'week';
						}}
					/>
					<p class="muted">{m.booking_calendar_monthHint()}</p>
				{/if}
			</section>

			<section class="panel">
				<h2>{m.booking_weeklyHours()}</h2>
				<p class="muted">{m.booking_weeklyHoursHint()}</p>
				{#if rules.length === 0}
					<p class="muted">{m.booking_noRules()}</p>
				{:else}
					<ul class="rules">
						{#each rules as rule (rule.id)}
							<li>
								<span>
									{WEEKDAYS[rule.weekday]}
									{rule.startTime}–{rule.endTime}
									{#if rule.serviceId}
										<em>({serviceTitle(rule.serviceId) || m.booking_oneListingOnly()})</em>
									{/if}
								</span>
								<button type="button" class="link" onclick={() => removeRule(rule.id)}>
									{m.common_delete()}
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<form class="inline-form" onsubmit={addRule}>
					<label>
						<span>{m.booking_field_weekday()}</span>
						<select bind:value={newRule.weekday}>
							{#each WEEKDAYS as label, index (label)}
								<option value={index}>{label}</option>
							{/each}
						</select>
					</label>
					<label>
						<span>{m.booking_field_from()}</span>
						<input type="time" bind:value={newRule.startTime} required />
					</label>
					<label>
						<span>{m.booking_field_to()}</span>
						<input type="time" bind:value={newRule.endTime} required />
					</label>
					<label>
						<span>{m.booking_field_appliesTo()}</span>
						<select bind:value={newRule.serviceId}>
							<!-- The default, and the common case: a person has one calendar, so a rule
							     applies to every listing they run unless they say otherwise. -->
							<option value="">{m.booking_allListings()}</option>
							{#each myServices as service (service.id)}
								<option value={service.id}>{service.title}</option>
							{/each}
						</select>
					</label>
					<button type="submit" class="primary">{m.booking_addRule()}</button>
				</form>
				{#if ruleError}
					<p class="error">{ruleError}</p>
				{/if}
			</section>

			<section class="panel">
				<h2>{m.booking_exceptions()}</h2>
				<p class="muted">{m.booking_exceptionsHint()}</p>
				{#if exceptions.length === 0}
					<p class="muted">{m.booking_noExceptions()}</p>
				{:else}
					<ul class="rules">
						{#each exceptions as exception (exception.id)}
							<li>
								<span>
									{exception.date}
									{#if exception.startTime}
										{exception.startTime}–{exception.endTime}
									{:else}
										<em>{m.booking_allDay()}</em>
									{/if}
									<span class="pill pill--{exception.kind}">
										{exception.kind === 'open' ? m.booking_kind_open() : m.booking_kind_block()}
									</span>
									{#if exception.note}<em>{exception.note}</em>{/if}
								</span>
								<button type="button" class="link" onclick={() => removeException(exception.id)}>
									{m.common_delete()}
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<form class="inline-form" onsubmit={addException}>
					<label>
						<span>{m.booking_field_date()}</span>
						<input type="date" bind:value={newException.date} required />
					</label>
					<label>
						<span>{m.booking_field_kind()}</span>
						<select bind:value={newException.kind}>
							<option value="block">{m.booking_kind_block()}</option>
							<option value="open">{m.booking_kind_open()}</option>
						</select>
					</label>
					<label>
						<span>{m.booking_field_from()}</span>
						<input type="time" bind:value={newException.startTime} />
					</label>
					<label>
						<span>{m.booking_field_to()}</span>
						<input type="time" bind:value={newException.endTime} />
					</label>
					<label class="wide">
						<span>{m.booking_field_note()}</span>
						<input type="text" bind:value={newException.note} maxlength="200" />
					</label>
					<button type="submit" class="primary">{m.booking_addException()}</button>
				</form>
				<!-- Said out loud because it is the one asymmetry between the two kinds, and a tutor who
				     leaves the times blank on an opening gets a validation error they would otherwise
				     have to guess the reason for. -->
				<p class="muted">{m.booking_allDayBlockOnly()}</p>
				{#if exceptionError}
					<p class="error">{exceptionError}</p>
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.muted {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.tabs {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		button {
			@include mix.button-secondary;
			padding: var(--space-1) var(--space-3);
			font-size: var(--font-size-sm);
		}
		button.active {
			background: var(--accent);
			color: var(--accent-contrast);
			border-color: var(--accent);
		}
	}
	.bookings {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}
	.booking {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.booking__head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
	}
	.booking__who,
	.booking__note {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.booking__note {
		font-style: italic;
	}
	.booking__clash {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
		align-self: flex-start;
	}
	.booking__actions {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-1);
		button {
			@include mix.button-secondary;
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-sm);
		}
		button.primary {
			@include mix.button-primary;
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-sm);
		}
	}
	.pill {
		font-size: var(--font-size-xs);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
	}
	.pill--confirmed,
	.pill--open {
		background: var(--status-success-bg);
		color: var(--status-success);
	}
	.pill--declined,
	.pill--cancelled,
	.pill--block {
		background: var(--status-danger-bg);
		color: var(--status-danger);
	}
	.pill--requested {
		background: var(--status-warning-bg);
		color: var(--status-warning);
	}
	.panel {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.rules {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		list-style: none;
		padding: 0;
		font-size: var(--font-size-sm);
		li {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: var(--space-2);
		}
		em {
			color: var(--text-secondary);
		}
	}
	.link {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
		padding: 0;
		@include mix.focus-ring;
	}
	.inline-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: flex-end;
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
		label {
			display: flex;
			flex-direction: column;
			gap: 2px;
			font-size: var(--font-size-xs);
			font-weight: 600;
		}
		label.wide {
			flex: 1 1 180px;
		}
		input,
		select {
			@include mix.focus-ring;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
			font-family: inherit;
			font-size: var(--font-size-sm);
		}
		button.primary {
			@include mix.button-primary;
			padding: var(--space-1) var(--space-3);
			font-size: var(--font-size-sm);
		}
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.legend {
		font-size: var(--font-size-xs);
	}
</style>
