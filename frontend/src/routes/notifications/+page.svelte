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
	import NotificationCard from '$lib/components/notification/NotificationCard.svelte';

	onMount(() => {
		if (authStore.isAuthenticated) notificationStore.refresh();
	});
</script>

<svelte:head>
	<title>{m.notification_inboxHeading()} — {m.common_appName()}</title>
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

	{#if !authStore.isAuthenticated}
		<p class="login-prompt"><a href={resolve('/login')}>{m.settings_loginRequired()}</a></p>
	{:else if !notificationStore.loaded}
		<p class="empty">{m.common_loading()}</p>
	{:else if notificationStore.items.length === 0}
		<p class="empty">{m.notification_empty()}</p>
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
