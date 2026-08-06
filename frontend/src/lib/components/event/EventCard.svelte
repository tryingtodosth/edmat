<script lang="ts">
	// The browse/grid card, matching `CourseCard`'s own economy: one component, reused wherever a list
	// of events renders (the events page, the homepage tab, somebody's own "my events").
	//
	// It leads with the DATE rather than the title, unlike every other card in this app. That is the
	// one thing an event is that a branch, a material and a listing are not: it happens once, at a
	// time, and "when" is the question a reader is scanning for. A grid of events sorted soonest-first
	// with the date buried in a meta line underneath makes the reader work for the only fact that
	// decides whether the rest is worth reading.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDateTime } from '$lib/utils/datetime';
	import type { EdmatEvent } from '$lib/types/event';

	let { event }: { event: EdmatEvent } = $props();

	const LOCATION_LABEL = {
		onsite: () => m.events_locationKind_onsite(),
		online: () => m.events_locationKind_online(),
		hybrid: () => m.events_locationKind_hybrid()
	};

	// "3 of 12 places left" only means something when there is a cap; an uncapped event should say how
	// many people are coming rather than invent a limit to count down from — the same choice
	// `CourseCard` makes, for the same reason.
	let seatsLine = $derived(
		event.seatsLeft === null
			? m.events_goingCount({ count: event.goingCount })
			: m.events_seatsLeft({ count: event.seatsLeft, capacity: event.capacity })
	);
</script>

<a class="event-card" href={resolve('/events/[id]', { id: event.id })}>
	<p class="when">{formatDateTime(event.startsAt)}</p>
	<div class="head">
		<h3>{event.title}</h3>
		{#if event.status !== 'published'}
			<span class="status status--{event.status}">
				{event.status === 'cancelled' ? m.events_status_cancelled() : m.events_status_draft()}
			</span>
		{/if}
	</div>
	{#if event.summary}
		<p class="summary">{event.summary}</p>
	{/if}
	<p class="meta">
		{m.events_byHost({ name: event.host.displayName })}
		· {LOCATION_LABEL[event.locationKind]()}
		· {seatsLine}
	</p>
	{#if event.isHost}
		<span class="mine">{m.events_youAreHosting()}</span>
	{:else if event.myAttendance === 'going'}
		<span class="mine">{m.events_youAreGoing()}</span>
	{/if}
</a>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.event-card {
		@include mix.card-surface;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		color: inherit;
		&:hover {
			border-color: var(--accent);
		}
	}
	.when {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accent);
		font-weight: 600;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		align-items: baseline;
	}
	h3 {
		font-size: var(--font-size-md);
	}
	.status {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.status--cancelled {
		color: var(--status-danger, #c0392b);
	}
	.summary,
	.meta {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.mine {
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-weight: 600;
	}
</style>
