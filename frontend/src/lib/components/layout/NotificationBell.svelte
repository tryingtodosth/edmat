<script lang="ts">
	// The navbar bell — same anchored-popover pattern RandomExerciseButton.svelte already
	// established (a bind:this container + a window click/keydown listener to close on outside
	// click/Escape), reused rather than invented a second way to do the same thing.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import NotificationCard from '$lib/components/notification/NotificationCard.svelte';

	let open = $state(false);
	let container: HTMLDivElement | undefined = $state();

	function toggle() {
		open = !open;
		if (open) notificationStore.refresh();
	}

	function handleWindowClick(event: MouseEvent) {
		if (!open || !container) return;
		// A real, found-live bug: `container.contains(event.target)` breaks the instant a click
		// INSIDE the popover causes its own target element to be removed from the DOM (e.g. "Mark
		// all read" — clicking it drives `unreadCount` to 0 synchronously, which un-renders the very
		// button just clicked via its own `{#if unreadCount > 0}` guard). By the time this bubbled
		// listener runs, `event.target` is already detached, so `.contains()` always returns false
		// and this misreads a legitimate INSIDE click as an outside one, slamming the popover shut.
		// `event.composedPath()` is captured once at dispatch time and stays accurate regardless of
		// any DOM mutation a listener along the way causes — the standard fix for this exact class
		// of bug, not a workaround specific to this one button.
		if (!event.composedPath().includes(container)) open = false;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}

	// The bell's own popover shows only the most recent handful — a deliberately short list, the
	// full history lives at /notifications (this popover's own "view all" link).
	let recent = $derived(notificationStore.items.slice(0, 8));
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<div class="notification-bell" bind:this={container}>
	<button
		type="button"
		class="notification-bell__toggle"
		onclick={toggle}
		aria-expanded={open}
		aria-label={m.notification_inboxHeading()}
	>
		🔔
		{#if notificationStore.unreadCount > 0}
			<span class="badge">{notificationStore.unreadCount}</span>
		{/if}
	</button>

	{#if open}
		<div class="menu" role="menu">
			<div class="menu__header">
				<h3>{m.notification_inboxHeading()}</h3>
				{#if notificationStore.unreadCount > 0}
					<button type="button" class="mark-all" onclick={() => notificationStore.markAllRead()}>
						{m.notification_markAllRead()}
					</button>
				{/if}
			</div>
			{#if !notificationStore.loaded}
				<p class="empty">{m.common_loading()}</p>
			{:else if recent.length === 0}
				<p class="empty">{m.notification_empty()}</p>
			{:else}
				<ul class="menu__list">
					{#each recent as notification (notification.id)}
						<li><NotificationCard {notification} /></li>
					{/each}
				</ul>
			{/if}
			<a class="view-all" href={resolve('/notifications')} onclick={() => (open = false)}>
				{m.notification_viewAll()}
			</a>
		</div>
	{/if}
</div>

<style lang="scss">
	.notification-bell {
		position: relative;
	}
	.notification-bell__toggle {
		position: relative;
		background: none;
		border: none;
		font-size: 18px;
		line-height: 1;
		padding: var(--space-1);
		cursor: pointer;
		color: var(--text-secondary);
		&:hover {
			color: var(--text-primary);
		}
	}
	.badge {
		position: absolute;
		top: -4px;
		right: -6px;
		min-width: 16px;
		height: 16px;
		padding: 0 3px;
		border-radius: 999px;
		background: var(--status-danger);
		color: white;
		font-size: 10px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.menu {
		position: absolute;
		top: calc(100% + var(--space-2));
		right: 0;
		width: min(340px, 90vw);
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-popover);
		z-index: var(--z-popover);
		display: flex;
		flex-direction: column;
		max-height: 420px;
	}
	// A real, found-live bug: `right: 0` anchors the popover to THIS BELL's own right edge, not the
	// viewport's — on mobile, the bell sits well short of the true right edge (other header actions,
	// e.g. the account name/logout link, come after it), so a wide (`90vw`) popover anchored there
	// overflowed past the LEFT edge of the screen entirely, leaving 0 of its notification cards
	// actually visible ("only half displayed" undersold it — the real fraction measured 0%).
	// `position: fixed` with viewport-relative left/right sidesteps the wrong-anchor problem
	// completely, regardless of exactly where the bell itself ends up in the header's own layout;
	// anchoring to the BOTTOM of the viewport (rather than computing a "below the header" offset
	// that would need to track the header's own height) needs no magic pixel value to stay correct
	// if the header's own content ever changes.
	@media (max-width: 480px) {
		.menu {
			position: fixed;
			left: var(--space-2);
			right: var(--space-2);
			top: auto;
			bottom: var(--space-2);
			width: auto;
			max-height: min(420px, 60vh);
		}
	}
	.menu__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-3);
		border-bottom: 1px solid var(--border-color);
		h3 {
			font-size: var(--font-size-sm);
			font-weight: 700;
		}
	}
	.mark-all {
		background: none;
		border: none;
		color: var(--accent);
		font-size: var(--font-size-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.menu__list {
		overflow-y: auto;
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
	}
	.empty {
		padding: var(--space-4) var(--space-3);
		text-align: center;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.view-all {
		display: block;
		text-align: center;
		padding: var(--space-2);
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--accent);
		border-top: 1px solid var(--border-color);
	}
</style>
