<script lang="ts">
	// One event: what it is, when, where, and the one decision a reader came here to make.
	//
	// The answer buttons are always BOTH shown once somebody has answered, rather than one button that
	// toggles. "Going / Not going" as a pair says what the two options are and which one you picked;
	// a single button reading "Cancel my attendance" makes the reader work out their own current state
	// from the label of the thing that would change it.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDateTime } from '$lib/utils/datetime';
	import { cancelEvent, getEvent, getEventAttendees, respondToEvent } from '$lib/services/events';
	import { createAvailabilityException, getMySchedule } from '$lib/services/booking';
	import { authStore } from '$lib/state/auth.svelte';
	import type { EdmatEvent, EventAttendee } from '$lib/types/event';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';

	let event = $state<EdmatEvent | null>(null);
	let attendees = $state<EventAttendee[]>([]);
	let loading = $state(true);
	let failed = $state(false);
	let busy = $state(false);
	let actionError = $state('');

	const LOCATION_LABEL = {
		onsite: () => m.events_locationKind_onsite(),
		online: () => m.events_locationKind_online(),
		hybrid: () => m.events_locationKind_hybrid()
	};

	const BLOCK_REASON = {
		sign_in: () => m.events_block_sign_in(),
		cancelled: () => m.events_block_cancelled(),
		not_published: () => m.events_block_not_published(),
		host: () => m.events_block_host(),
		past: () => m.events_block_past(),
		full: () => m.events_block_full()
	};

	/** The roster is private (host, plus the people going), so this is allowed to 403 and that is not
	 * an error worth showing — it is the rule working. Swallowed rather than surfaced. */
	async function loadAttendees(id: string) {
		try {
			attendees = await getEventAttendees(id);
		} catch {
			attendees = [];
		}
	}

	onMount(async () => {
		try {
			event = await getEvent(page.params.id!);
			await loadAttendees(event.id);
			await checkClash(event);
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	});

	async function respond(status: 'going' | 'not_going') {
		if (!event) return;
		busy = true;
		actionError = '';
		try {
			event = await respondToEvent(event.id, status);
			await loadAttendees(event.id);
		} catch (e) {
			actionError = e instanceof Error ? e.message : m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	async function callOff() {
		if (!event) return;
		if (!confirm(m.events_cancelConfirm())) return;
		busy = true;
		actionError = '';
		try {
			event = await cancelEvent(event.id);
		} catch (e) {
			actionError = e instanceof Error ? e.message : m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	// ---- clashes with the reader's own calendar ------------------------------------------------
	// Hosting an event removes those hours from anything still bookable (booking/availability.py), and
	// that subtraction is silent by design: it only ever affects hours nobody has taken. What it
	// deliberately does NOT do is move a session somebody has already booked and paid attention to.
	// So a host can end up double-booked with no warning anywhere, and the only person who can fix it
	// is the one who never found out. This says it on the page.
	let clash = $state<{ kind: 'booking' | 'availability'; count: number } | null>(null);
	// A one-click "keep this evening free" for somebody ATTENDING. Attending does not withdraw
	// bookable hours — that decision stands, and it is the right one (booking/availability.py) — but
	// the escape hatch for somebody who does want the evening held was "go and write an availability
	// exception by hand", which nobody will do.
	let blocking = $state(false);
	let blocked = $state(false);

	const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
		new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

	/** Only ever asked for an event that has not happened yet: a clash with a past evening is not a
	 * problem anybody can still act on, and the warning would be noise on every old page. */
	async function checkClash(current: EdmatEvent) {
		if (!authStore.isAuthenticated || current.isPast || current.status === 'cancelled') return;
		// Start day THROUGH end day, not just the start: an event running to 00:30 has an hour of itself
		// on a date the first query would never look at.
		try {
			const schedule = await getMySchedule(
				current.startsAt.slice(0, 10),
				current.endsAt.slice(0, 10)
			);
			// A live booking only. A declined or cancelled request is not a commitment, and a completed
			// one is in the past by definition.
			const live = schedule.bookings.filter(
				(b) =>
					(b.status === 'confirmed' || b.status === 'requested') &&
					overlaps(current.startsAt, current.endsAt, b.startsAt, b.endsAt)
			);
			if (live.length > 0) {
				clash = { kind: 'booking', count: live.length };
				return;
			}
			// Published hours are the softer case, and only worth raising to the host — for anybody else
			// the subtraction never happens at all, so there is nothing to warn about.
			if (!current.isHost) return;
			const stillOffered = schedule.days
				.flatMap((d) => d.windows)
				.some((w) => overlaps(current.startsAt, current.endsAt, w.start, w.end));
			if (stillOffered) clash = { kind: 'availability', count: 0 };
		} catch {
			// Somebody who runs no tutoring at all has no schedule to read, and a failure here must not
			// break the page they actually came for.
		}
	}

	async function holdTheEvening() {
		if (!event) return;
		blocking = true;
		actionError = '';
		try {
			const start = new Date(event.startsAt);
			const end = new Date(event.endsAt);
			const hhmm = (d: Date) =>
				`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
			await createAvailabilityException({
				date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
				kind: 'block',
				startTime: hhmm(start),
				endTime: hhmm(end),
				// The note is what makes this reversible six weeks later: an unexplained hole in a
				// schedule is one somebody deletes.
				note: m.events_holdNote({ title: event.title })
			});
			blocked = true;
		} catch (e) {
			actionError = e instanceof Error ? e.message : m.common_error_generic();
		} finally {
			blocking = false;
		}
	}

	let seatsLine = $derived(
		!event
			? ''
			: event.seatsLeft === null
				? m.events_noCap()
				: m.events_seatsLeft({ count: event.seatsLeft, capacity: event.capacity })
	);
</script>

<svelte:head>
	<title>{event ? event.title : m.events_browseHeading()} — {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="events">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if failed || !event}
			<p class="status">{m.common_error_generic()}</p>
		{:else}
			<nav class="back"><a href={resolve('/events')}>← {m.events_browseHeading()}</a></nav>

			{#if event.status === 'cancelled'}
				<p class="notice notice--danger">{m.events_cancelledNotice()}</p>
			{:else if event.status === 'draft'}
				<p class="notice">{m.events_draftNotice()}</p>
			{:else if event.isPast}
				<p class="notice">{m.events_pastNotice()}</p>
			{/if}

			<header class="head">
				<h1 class:struck={event.status === 'cancelled'}>{event.title}</h1>
				<p class="host">{m.events_byHost({ name: event.host.displayName })}</p>
				{#if event.summary}
					<p class="summary">{event.summary}</p>
				{/if}
			</header>

			<dl class="facts">
				<div>
					<dt>{m.events_when()}</dt>
					<dd>
						{formatDateTime(event.startsAt)} · {m.events_duration({
							count: event.durationMinutes
						})}
					</dd>
				</div>
				<div>
					<dt>{m.events_where()}</dt>
					<dd>
						{LOCATION_LABEL[event.locationKind]()}
						{#if event.locationText}
							· {event.locationText}
						{/if}
						{#if event.onlineUrl}
							·
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a host-supplied external URL, deliberately not an internal route -->
							<a href={event.onlineUrl} target="_blank" rel="noopener noreferrer">
								{m.events_joinLink()}
							</a>
						{/if}
					</dd>
				</div>
				<div>
					<dt>{m.events_attendees()}</dt>
					<dd>
						{m.events_goingCount({ count: event.goingCount })} · {seatsLine}
						{#if event.isHost && event.declinedCount > 0}
							· {m.events_declinedCount({ count: event.declinedCount })}
						{/if}
					</dd>
				</div>
			</dl>

			{#if event.description}
				<section class="description"><p>{event.description}</p></section>
			{/if}

			<section class="respond">
				{#if event.isHost}
					<p class="mine">{m.events_youAreHosting()}</p>
					<div class="host-actions">
						{#if event.status !== 'cancelled'}
							<a class="edit" href={resolve('/events/[id]/edit', { id: event.id })}>
								{m.events_edit()}
							</a>
							<button type="button" class="danger" disabled={busy} onclick={callOff}>
								{m.events_cancel()}
							</button>
						{/if}
					</div>
				{:else}
					{#if event.myAttendance === 'going'}
						<p class="mine">{m.events_youAreGoing()}</p>
						<!-- Saying you are coming deliberately does NOT withdraw your bookable hours
						     (booking/availability.py explains why an RSVP must not quietly cost somebody
						     income). This is the escape hatch for the person who does want them held, so
						     that it is one click rather than a hand-written availability exception. -->
						{#if !event.isPast && event.status !== 'cancelled'}
							{#if blocked}
								<p class="held" role="status">{m.events_holdDone()}</p>
							{:else}
								<button
									type="button"
									class="secondary"
									disabled={blocking}
									onclick={holdTheEvening}
								>
									{blocking ? m.common_loading() : m.events_holdEvening()}
								</button>
								<small class="hint">{m.events_holdHint()}</small>
							{/if}
						{/if}
					{:else if event.myAttendance === 'not_going'}
						<p class="mine">{m.events_youAreNotGoing()}</p>
					{/if}

					{#if event.canRespond || event.myAttendance}
						<div class="answers">
							<button
								type="button"
								class="primary"
								disabled={busy || event.myAttendance === 'going' || !event.canRespond}
								aria-pressed={event.myAttendance === 'going'}
								onclick={() => respond('going')}
							>
								{m.events_going()}
							</button>
							<button
								type="button"
								class="secondary"
								disabled={busy || event.myAttendance === 'not_going'}
								aria-pressed={event.myAttendance === 'not_going'}
								onclick={() => respond('not_going')}
							>
								{m.events_notGoing()}
							</button>
						</div>
					{/if}

					<!-- The refusal is always named. A disabled button with no explanation is the thing
					     this codebase argues against everywhere else, and "full" and "this already
					     happened" are completely different to a person. -->
					{#if event.responseBlockReason}
						<p class="blocked">{BLOCK_REASON[event.responseBlockReason]()}</p>
						{#if event.responseBlockReason === 'sign_in'}
							<a href={resolve('/login')}>{m.nav_login()}</a>
						{/if}
					{/if}
				{/if}

				<!-- Outside the host/attendee split on purpose: a booking already sitting on these hours
				     is worth knowing about whichever side of the event you are on, and only the person
				     reading can resolve it. Hosting removes the hours from anything still bookable
				     (booking/availability.py), but it deliberately never moves a session somebody has
				     already booked — so this is the one collision nothing else in the app reports. -->
				{#if clash}
					<p class="clash" role="status">
						{clash.kind === 'booking'
							? m.events_clash_booking({ count: clash.count })
							: m.events_clash_availability()}
					</p>
				{/if}

				{#if actionError}
					<p class="error" role="alert">{actionError}</p>
				{/if}
			</section>

			<section class="roster">
				<h2>{m.events_attendees()}</h2>
				{#if attendees.length === 0}
					<p class="status">
						{authStore.isAuthenticated && (event.isHost || event.myAttendance === 'going')
							? m.events_attendeesEmpty()
							: m.events_attendeesPrivate()}
					</p>
				{:else}
					<ul>
						{#each attendees as row (row.id)}
							<li>
								<a href={resolve('/users/[id]', { id: row.attendee.id })}>
									{row.attendee.displayName}
								</a>
								{#if row.status === 'not_going'}
									<span class="declined">{m.events_notGoing()}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.back a {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.notice {
		@include mix.card-surface;
		padding: var(--space-3);
		font-size: var(--font-size-sm);
	}
	.notice--danger {
		border-color: var(--status-danger, #c0392b);
		color: var(--status-danger, #c0392b);
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.struck {
		text-decoration: line-through;
	}
	.host,
	.summary {
		color: var(--text-secondary);
	}
	.facts {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		div {
			display: flex;
			gap: var(--space-2);
			flex-wrap: wrap;
		}
		dt {
			font-weight: 600;
			font-size: var(--font-size-sm);
			min-width: 6rem;
		}
		dd {
			font-size: var(--font-size-sm);
			color: var(--text-secondary);
		}
	}
	.description p {
		white-space: pre-wrap;
	}
	.respond {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
	}
	.answers,
	.host-actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.primary {
		@include mix.button-primary;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.danger {
		@include mix.button-secondary;
		border-color: var(--status-danger, #c0392b);
		color: var(--status-danger, #c0392b);
	}
	.mine {
		font-weight: 600;
		color: var(--accent);
	}
	.blocked,
	.hint,
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.edit {
		@include mix.button-secondary;
		text-decoration: none;
	}
	.held {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	// A warning, not an error: nothing has gone wrong and nothing is refused — the reader is being
	// told about a collision only they can weigh up.
	.clash {
		@include mix.card-surface;
		padding: var(--space-3);
		font-size: var(--font-size-sm);
		border-color: var(--status-warning, #b7791f);
		color: var(--status-warning, #b7791f);
	}
	.error {
		color: var(--status-danger, #c0392b);
		font-size: var(--font-size-sm);
	}
	.roster {
		h2 {
			font-size: var(--font-size-lg);
			margin-bottom: var(--space-2);
		}
		ul {
			list-style: none;
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
		}
		li {
			display: flex;
			gap: var(--space-2);
			align-items: baseline;
			font-size: var(--font-size-sm);
		}
	}
	.declined {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
