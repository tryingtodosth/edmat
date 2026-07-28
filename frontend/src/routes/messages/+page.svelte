<script lang="ts">
	// The messaging inbox — folder tabs (Inbox/Sent), a flat list of individual messages (matching
	// django-postman's own inbox()/sent() manager methods, which return one row per message, not
	// one row per conversation — see messaging/views.py's own doc comment). Clicking a row opens
	// that specific message's own thread at /messages/[id].
	import { resolve } from '$app/paths';
	import type { Message, MessageFolder } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/utils/format';
	import { authStore } from '$lib/state/auth.svelte';
	import { getMessages } from '$lib/services/messaging';

	let folder = $state<MessageFolder>('inbox');
	let messages = $state<Message[]>([]);
	let loading = $state(true);
	let loadedOnce = $state(false);

	async function load(next: MessageFolder) {
		folder = next;
		loading = true;
		messages = await getMessages(next);
		loading = false;
	}

	// A real, found-during-verification bug: getMessages() is authenticated-only
	// (messaging/views.py's MessageViewSet), and a bare top-level call (unlike this app's own
	// PUBLIC-endpoint eager-fetch precedent, e.g. submit-material's getAllCourses()) also runs
	// during SERVER-SIDE RENDERING, where there's no browser-stored token at all — the resulting
	// 401 ApiError was never caught, and an uncaught rejection during SSR crashed the ENTIRE dev
	// server process outright, not just this one page.
	//
	// A plain `onMount` guarding on `authStore.isAuthenticated` isn't enough either — it only
	// checks once, synchronously, at mount time, but a hard reload/direct visit re-runs the root
	// layout's own async `authStore.init()` from scratch, which hasn't necessarily resolved yet
	// the instant THIS page's onMount fires. A real `$effect` — re-running whenever
	// `authStore.isAuthenticated` itself changes — is what routes/moderation/+page.svelte already
	// uses to solve the identical problem (`$effect(() => { if (authStore.canModerate) load(); })`);
	// `loadedOnce` keeps it from re-firing and resetting the folder tab back to "inbox" on some
	// later, unrelated reactive change once the real fetch has already happened.
	$effect(() => {
		if (authStore.isAuthenticated && !loadedOnce) {
			loadedOnce = true;
			load('inbox');
		}
	});

	function otherParty(message: Message): string {
		return folder === 'sent' ? message.recipientDisplayName : message.senderDisplayName;
	}
</script>

<svelte:head>
	<title>{m.messages_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<div class="page__header">
		<h1>{m.messages_heading()}</h1>
		<a class="compose" href={resolve('/messages/new')}>{m.messages_compose()}</a>
	</div>

	{#if !authStore.isAuthenticated}
		<p class="login-prompt"><a href={resolve('/login')}>{m.messages_loginRequired()}</a></p>
	{:else}
		<div class="tabs" role="tablist">
			<button
				type="button"
				role="tab"
				aria-selected={folder === 'inbox'}
				class:active={folder === 'inbox'}
				onclick={() => load('inbox')}
			>
				{m.messages_tab_inbox()}
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={folder === 'sent'}
				class:active={folder === 'sent'}
				onclick={() => load('sent')}
			>
				{m.messages_tab_sent()}
			</button>
		</div>

		{#if loading}
			<p class="empty">{m.common_loading()}</p>
		{:else if messages.length === 0}
			<p class="empty">{m.messages_empty()}</p>
		{:else}
			<ul class="list">
				{#each messages as message (message.id)}
					<li>
						<a
							class="row"
							class:row--unread={folder === 'inbox' && !message.isRead}
							href={resolve('/messages/[id]', { id: message.id })}
						>
							<span class="party">{otherParty(message)}</span>
							<span class="subject">{message.subject}</span>
							<span class="date">{formatDate(message.sentAt, getLocale())}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.page__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.compose {
		@include mix.button-primary;
	}
	.login-prompt a {
		color: var(--accent);
		font-weight: 600;
	}
	.tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 1px solid var(--border-color);
		button {
			@include mix.focus-ring;
			background: none;
			border: none;
			padding: var(--space-2) var(--space-1);
			font-size: var(--font-size-sm);
			font-weight: 500;
			color: var(--text-secondary);
			border-bottom: 2px solid transparent;
			cursor: pointer;
			&.active {
				color: var(--accent);
				border-bottom-color: var(--accent);
			}
		}
	}
	.empty {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.list {
		@include mix.card-surface;
		display: flex;
		flex-direction: column;
	}
	.row {
		display: grid;
		grid-template-columns: 160px 1fr auto;
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--text-primary);
		border-bottom: 1px solid var(--border-color);
		&:last-child {
			border-bottom: none;
		}
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.row--unread {
		font-weight: 700;
		.subject::before {
			content: '● ';
			color: var(--accent);
		}
	}
	.party {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.subject {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.date {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		white-space: nowrap;
	}
</style>
