<script lang="ts">
	// Compose a brand-new, top-level message. Reads `?to=` (a real recipient User id — most commonly
	// a Service listing's own provider, via ServiceCard's own "Contact" link) and an optional
	// `?subject=` from the URL to pre-fill the form; both are just a starting point the sender can
	// still edit before sending; getUserById's own resolved display name confirms who `?to=` actually
	// is, since a bare id in a URL is otherwise opaque to a human reader.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { getUserById } from '$lib/services/users';
	import { sendMessage } from '$lib/services/messaging';
	import { messagesStore } from '$lib/state/messages.svelte';

	let recipient = $state<User | undefined>(undefined);
	let recipientNotFound = $state(false);
	let subject = $state('');
	let body = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');

	async function init() {
		const to = page.url.searchParams.get('to');
		subject = page.url.searchParams.get('subject') ?? '';
		if (!to) return;
		const found = await getUserById(to);
		if (!found) {
			recipientNotFound = true;
			return;
		}
		recipient = found;
	}
	init();

	let canSubmit = $derived(Boolean(recipient && subject.trim()));

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!recipient || !canSubmit) return;
		submitting = true;
		errorMessage = '';
		try {
			const sent = await sendMessage(recipient.id, subject.trim(), body.trim());
			messagesStore.refresh();
			goto(resolve('/messages/[id]', { id: sent.id }));
		} catch {
			errorMessage = m.messages_sendFailed();
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.messages_compose()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.messages_compose()}</h1>

	{#if !authStore.isAuthenticated}
		<p class="login-prompt"><a href={resolve('/login')}>{m.messages_loginRequired()}</a></p>
	{:else if recipientNotFound}
		<p class="empty">{m.messages_recipientNotFound()}</p>
	{:else if !recipient}
		<p class="empty">{m.messages_noRecipient()}</p>
	{:else}
		<p class="to-line">{m.messages_toLabel({ name: recipient.displayName })}</p>

		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}

		<form class="compose-form" onsubmit={handleSubmit}>
			<label class="field">
				<span>{m.messages_field_subject()}</span>
				<input type="text" bind:value={subject} required maxlength="255" />
			</label>
			<label class="field">
				<span>{m.messages_field_body()}</span>
				<textarea rows="6" bind:value={body}></textarea>
			</label>
			<button type="submit" class="submit" disabled={!canSubmit || submitting}>
				{submitting ? m.common_loading() : m.messages_send()}
			</button>
		</form>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.login-prompt a {
		color: var(--accent);
		font-weight: 600;
	}
	.empty {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.to-line {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.compose-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	input,
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
	.submit {
		@include mix.button-primary;
		align-self: flex-start;
	}
</style>
