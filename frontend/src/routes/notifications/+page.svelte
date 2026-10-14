<script lang="ts">
	// The full inbox — the bell popover's own "view all" destination. No +page.ts: this reads the
	// already-authenticated authStore/notificationStore directly, the same "plain +page.svelte over
	// client-side auth state" precedent /settings already establishes, rather than a server load
	// function this app has no server-rendered auth story to back (Phase 3's own token-based auth is
	// entirely client-side, CLAUDE.md Section 16).
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { messagesStore } from '$lib/state/messages.svelte';
	import { displayPrefs } from '$lib/state/displayPrefs.svelte';
	import NotificationCard from '$lib/components/notification/NotificationCard.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	onMount(() => {
		if (authStore.isAuthenticated) notificationStore.refresh();
	});
</script>

<svelte:head>
	<title>{pageTitle(m.notification_inboxHeading())}</title>
</svelte:head>

<div class="page">
	<div class="page__header">
		<h1>{m.notification_inboxHeading()}</h1>
		{#if notificationStore.unreadCount > 0}
			<button type="button" class="mark-all" onclick={() => notificationStore.markAllRead()}>
				{m.notification_markAllRead()}
			</button>
		{/if}
	</div>

	<!-- One inbox or two (2026-10-01, a per-account preference, default split). With it on, the
	     unread conversations sit above the notifications so there is one page to look at. It is a
	     LINK, not the conversations themselves: this page reads `notificationStore`, and
	     reproducing the thread list here would be a second messages page to keep in step with the
	     real one. The header's envelope disappears at the same time, so this line is what replaces
	     it — if it were not here, turning the preference on would simply hide an inbox. -->
	{#if displayPrefs.combinedInbox && authStore.isAuthenticated}
		<section class="messages-strip">
			<h2>{m.inbox_messagesHeading()}</h2>
			{#if messagesStore.unreadCount > 0}
				<a href={resolve('/messages')}
					>{m.inbox_unreadMessages({ count: messagesStore.unreadCount })}</a
				>
			{:else}
				<a href={resolve('/messages')}>{m.inbox_openMessages()}</a>
			{/if}
		</section>
	{/if}

	{#if authStore.restoring}
		<p class="session-restoring">{m.common_loading()}</p>
	{:else if !authStore.isAuthenticated}
		<p data-session-hidden class="login-prompt">
			<a href={resolve('/login')}>{m.settings_loginRequired()}</a>
		</p>
	{:else if !notificationStore.loaded}
		<p class="empty">{m.common_loading()}</p>
	{:else if notificationStore.items.length === 0}
		<EmptyState
			name="notifications"
			message={m.empty_notifications()}
			action={{ label: m.empty_notificationsSettings(), href: resolve('/settings') }}
			guide="messages"
		/>
		<!-- "Replies to your comments, reviews of what you have added, and news from the courses and tags you follow will show up here." / "Choose what you are told about" -->
	{:else}
		<ul class="list">
			{#each notificationStore.items as notification (notification.id)}
				<li><NotificationCard {notification} /></li>
			{/each}
		</ul>
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;
	.messages-strip {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
	}
	.messages-strip h2 {
		margin: 0;
		font-size: var(--font-size-base);
	}
	.messages-strip a {
		color: var(--accent);
	}

	.page {
		max-width: 620px;
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
	.mark-all {
		@include mix.button-secondary;
	}
	.login-prompt a,
	.empty {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.login-prompt a {
		color: var(--accent);
		font-weight: 600;
	}
	.list {
		@include mix.card-surface;
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
	}
</style>
