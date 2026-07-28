<script lang="ts">
	// A single conversation's thread — every message that shares this one's `threadId` (or just
	// itself, if nobody's replied yet), oldest first. Same "$effect keyed off page.params, with an
	// id-changed idempotency guard" pattern the exercise/material/user detail pages already
	// establish. Opening the thread also marks every message addressed to the current user read
	// (getMessage's own retrieve-marks-read side effect, called once per still-unread row here,
	// then the unread badge is refreshed) — a real webmail's own "opening a conversation clears its
	// unread state" behavior, not just the one row that happened to be clicked from the inbox list.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Message } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/utils/format';
	import { authStore } from '$lib/state/auth.svelte';
	import { getMessage, getThread, replyToMessage } from '$lib/services/messaging';
	import { messagesStore } from '$lib/state/messages.svelte';

	let thread = $state<Message[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let replyBody = $state('');
	let sending = $state(false);
	let errorMessage = $state('');

	async function loadThread(id: string) {
		loading = true;
		notFound = false;

		const opened = await getMessage(id);
		if (!opened) {
			notFound = true;
			loading = false;
			return;
		}

		const rows = await getThread(id);
		thread = rows;
		loading = false;

		// Mark every OTHER still-unread row addressed to the current user read too, not just the one
		// that was opened directly — the natural "viewing this conversation clears it" expectation.
		// Fire-and-forget relative to rendering: isRead/readAt aren't rendered anywhere in this
		// thread view, so there's no need to re-fetch and re-render once these settle.
		const currentUserId = authStore.user?.id;
		const stillUnread = rows.filter(
			(row) => row.id !== opened.id && row.recipientId === currentUserId && !row.isRead
		);
		if (stillUnread.length > 0) {
			await Promise.all(stillUnread.map((row) => getMessage(row.id)));
		}
		messagesStore.refresh();
	}

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadThread(id);
	});

	async function handleReply(event: SubmitEvent) {
		event.preventDefault();
		if (!replyBody.trim() || thread.length === 0) return;
		sending = true;
		errorMessage = '';
		try {
			const last = thread[thread.length - 1];
			const created = await replyToMessage(last.id, replyBody.trim());
			thread = [...thread, created];
			replyBody = '';
		} catch {
			errorMessage = m.messages_sendFailed();
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>{thread[0]?.subject ?? m.messages_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<a class="back" href={resolve('/messages')}>&larr; {m.messages_backToInbox()}</a>

	{#if loading}
		<p class="empty">{m.common_loading()}</p>
	{:else if notFound}
		<p class="empty">{m.messages_notFound()}</p>
	{:else}
		<h1>{thread[0]?.subject}</h1>

		<ul class="bubbles">
			{#each thread as message (message.id)}
				{@const isOwn = message.senderId === authStore.user?.id}
				<li class="bubble" class:bubble--own={isOwn}>
					<div class="bubble__meta">
						<span class="author">{message.senderDisplayName}</span>
						<span class="date">{formatDate(message.sentAt, getLocale())}</span>
					</div>
					<p class="body">{message.body}</p>
				</li>
			{/each}
		</ul>

		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}

		<form class="reply-form" onsubmit={handleReply}>
			<textarea rows="3" bind:value={replyBody} placeholder={m.messages_field_body()} required
			></textarea>
			<button type="submit" class="submit" disabled={!replyBody.trim() || sending}>
				{sending ? m.common_loading() : m.messages_send()}
			</button>
		</form>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.back {
		align-self: flex-start;
		font-size: var(--font-size-sm);
		color: var(--accent);
		font-weight: 600;
	}
	.empty {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	h1 {
		font-size: var(--font-size-lg);
	}
	.bubbles {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.bubble {
		@include mix.card-surface;
		padding: var(--space-3);
		max-width: 80%;
		align-self: flex-start;
	}
	.bubble--own {
		align-self: flex-end;
		background: var(--accent-soft);
		border-color: var(--accent);
	}
	.bubble__meta {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		margin-bottom: var(--space-1);
	}
	.body {
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.reply-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
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
	.submit {
		@include mix.button-primary;
		align-self: flex-start;
	}
</style>
