<script lang="ts">
	// One shared row, reused by both NotificationPopover (the bell's own quick list) and the full
	// /notifications inbox page — the same "one card, two mount points" economy this app's own
	// ReportButton/CoveragePopover already follow for their own shared pieces.
	import { resolve } from '$app/paths';
	import type { Notification } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatRelativeDate } from '$lib/utils/format';
	import { notificationStore } from '$lib/state/notifications.svelte';

	let { notification }: { notification: Notification } = $props();

	// One line per type, each interpolating whatever real context that event actually has
	// (actorDisplayName/targetLabel) — no generic "something happened" fallback, since every type
	// this app creates always carries enough to say something concrete.
	const MESSAGE_BY_TYPE: Record<Notification['type'], () => string> = {
		submissionApproved: () =>
			m.notification_submissionApproved({ title: notification.targetLabel }),
		submissionRejected: () =>
			m.notification_submissionRejected({ title: notification.targetLabel }),
		editSuggestionApproved: () =>
			m.notification_editSuggestionApproved({ title: notification.targetLabel }),
		editSuggestionRejected: () =>
			m.notification_editSuggestionRejected({ title: notification.targetLabel }),
		translationApproved: () =>
			m.notification_translationApproved({ title: notification.targetLabel }),
		translationRejected: () =>
			m.notification_translationRejected({ title: notification.targetLabel }),
		commentReply: () =>
			m.notification_commentReply({
				actor: notification.actorDisplayName || m.notification_someone(),
				title: notification.targetLabel
			}),
		contentAutoHidden: () => m.notification_contentAutoHidden({ title: notification.targetLabel }),
		contentRestored: () => m.notification_contentRestored({ title: notification.targetLabel }),
		contentRemoved: () => m.notification_contentRemoved({ title: notification.targetLabel }),
		// `note` already carries the tag itself (`#slug`, see notify_tag_followers) and renders in
		// its own quoted line just below — this message only needs to say WHAT happened, not repeat
		// which tag, the same "don't duplicate what the note line already shows" restraint every
		// other type's own message already follows for its own `note`.
		newTaggedContent: () =>
			m.notification_newTaggedContent({
				actor: notification.actorDisplayName || m.notification_someone(),
				title: notification.targetLabel
			})
	};

	let message = $derived(MESSAGE_BY_TYPE[notification.type]());
	// ✅ Phase 4 — a newTaggedContent notification can target a Material instead of an Exercise;
	// this used to have nowhere real to link to at all (no routes/materials/[id] existed), so that
	// case fell through to the same non-navigating, mark-as-read-only card the "a rejected
	// submission has no exercise to link to" case still correctly uses below. Now resolves to the
	// real material detail page (materials/[id]/+page.svelte) instead.
	let href = $derived(
		notification.exerciseId
			? resolve('/exercises/[id]', { id: notification.exerciseId })
			: notification.materialId
				? resolve('/materials/[id]', { id: notification.materialId })
				: undefined
	);

	function handleClick() {
		if (!notification.isRead) notificationStore.markRead(notification.id);
	}

	// The unread-badge notifications this app creates always resolve to a real exercise (only a
	// REJECTED submission has none, see mappers.ts's own note) — but when `href` is genuinely
	// absent, this still needs to read as an interactive element to a screen reader, not a silent
	// clickable div; `role`/`tabindex`/`onkeydown` only apply in that branch, an `<a href>` already
	// has all three for free.
	function handleKeydown(event: KeyboardEvent) {
		if (!href && (event.key === 'Enter' || event.key === ' ')) {
			event.preventDefault();
			handleClick();
		}
	}
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	{href}
	class="notification-card"
	class:notification-card--unread={!notification.isRead}
	role={href ? undefined : 'button'}
	tabindex={href ? undefined : 0}
	onclick={handleClick}
	onkeydown={handleKeydown}
>
	<span class="notification-card__dot" aria-hidden="true"></span>
	<div class="notification-card__body">
		<p class="notification-card__message">{message}</p>
		{#if notification.note}
			<p class="notification-card__note">&ldquo;{notification.note}&rdquo;</p>
		{/if}
		<span class="notification-card__date">
			{formatRelativeDate(notification.createdAt, getLocale())}
		</span>
	</div>
</svelte:element>

<style lang="scss">
	.notification-card {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		cursor: pointer;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.notification-card__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-top: 6px;
		flex-shrink: 0;
		background: transparent;
	}
	.notification-card--unread .notification-card__dot {
		background: var(--accent);
	}
	.notification-card__body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.notification-card__message {
		font-size: var(--font-size-sm);
	}
	.notification-card--unread .notification-card__message {
		font-weight: 600;
	}
	.notification-card__note {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-style: italic;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.notification-card__date {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
