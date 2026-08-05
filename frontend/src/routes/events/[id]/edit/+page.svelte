<script lang="ts">
	// Editing an event. `EventWriteSerializer`, the PATCH route and the "this has moved" notification
	// all existed and were tested before this page did — a host could change the room over the API or
	// not at all, which is why CLAUDE.md §17V.7 called this the most obvious next thing.
	//
	// Deliberately the same shape as `classroom/[id]/edit`: load, refuse for the wrong person with a
	// sentence rather than a form that could only fail, otherwise hand the record to the shared form.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getEvent, updateEvent } from '$lib/services/events';
	import type { EdmatEvent, EventDraft } from '$lib/types/event';
	import EventForm from '$lib/components/event/EventForm.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';

	let event = $state<EdmatEvent | null>(null);
	let loading = $state(true);
	let submitting = $state(false);
	let error = $state('');

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		getEvent(id)
			.then((found) => (event = found ?? null))
			.catch(() => (event = null))
			.finally(() => (loading = false));
	});

	async function submit(draft: EventDraft) {
		submitting = true;
		error = '';
		try {
			await updateEvent(page.params.id!, draft);
			await goto(resolve('/events/[id]', { id: page.params.id! }));
		} catch (e) {
			// The API's own words are worth keeping: it refuses a capacity below the number of people
			// already holding a seat, and naming that number is the whole use of the message.
			error = e instanceof Error ? e.message : m.common_error_generic();
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.events_edit()} — {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="events">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if !event}
			<p class="status">{m.events_notFound()}</p>
		{:else if !event.isHost}
			<p class="status">{m.events_edit_notYours()}</p>
		{:else if event.status === 'cancelled'}
			<!-- The form always sends a status, and the API refuses to reopen a cancelled event — so this
			     form could only ever fail here. Saying why beats a rejected save. -->
			<p class="status">{m.events_edit_cancelled()}</p>
		{:else}
			<h1>{m.events_edit()}</h1>
			<p class="lead">{m.events_edit_lead()}</p>
			<EventForm
				initial={event}
				submitLabel={m.common_save()}
				{submitting}
				{error}
				onsubmit={submit}
			/>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.lead,
	.status {
		color: var(--text-secondary);
	}
</style>
