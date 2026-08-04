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
							<button type="button" class="danger" disabled={busy} onclick={callOff}>
								{m.events_cancel()}
							</button>
						{/if}
					</div>
				{:else}
					{#if event.myAttendance === 'going'}
						<p class="mine">{m.events_youAreGoing()}</p>
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
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
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
