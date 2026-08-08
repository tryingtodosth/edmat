<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { createEvent } from '$lib/services/events';
	import { authStore } from '$lib/state/auth.svelte';
	import type { EventDraft } from '$lib/types/event';
	import EventForm from '$lib/components/event/EventForm.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';

	let submitting = $state(false);
	let error = $state('');

	async function submit(draft: EventDraft) {
		submitting = true;
		error = '';
		try {
			const created = await createEvent(draft);
			await goto(resolve('/events/[id]', { id: created.id }));
		} catch (e) {
			error = e instanceof Error ? e.message : m.common_error_generic();
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.events_hostAnEvent()} — {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="events">
	<div class="page">
		<h1>{m.events_hostAnEvent()}</h1>
		{#if authStore.restoring}
			<p class="session-restoring">{m.common_loading()}</p>
		{:else if !authStore.isAuthenticated}
			<p data-session-hidden class="status">{m.events_block_sign_in()}</p>
			<a href={resolve('/login')}>{m.nav_login()}</a>
		{:else}
			<p class="lead">{m.events_newLead()}</p>
			<EventForm submitLabel={m.events_create()} {submitting} {error} onsubmit={submit} />
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
	.lead,
	.status {
		color: var(--text-secondary);
	}
</style>
