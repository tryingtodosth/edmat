<script lang="ts">
	// "Previous version not available" for a comment edited before this feature existed is not a
	// fallback string standing in for a missing fetch — it's the honest truth: no CommentRevision
	// row was ever created for it (community/models.py's own docstring). The masking itself (a
	// moderator-hidden or superuser-sealed body) already happened server-side by the time this
	// list arrives — `revision.body === null` is what tells the two apart from `isHiddenByModerator`
	// / `isSealed`, never something this component decides on its own.
	import type { CommentRevision } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { formatRelativeDate } from '$lib/utils/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		getCommentRevisions,
		hideCommentRevision,
		sealCommentRevision
	} from '$lib/services/comments';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import Loading from '$lib/components/shared/Loading.svelte';

	let { commentId, onClose }: { commentId: string; onClose: () => void } = $props();

	let revisions = $state<CommentRevision[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let busyId = $state<string | null>(null);

	$effect(() => {
		let cancelled = false;
		loading = true;
		error = null;
		getCommentRevisions(commentId)
			.then((rows) => {
				if (!cancelled) revisions = rows;
			})
			.catch(() => {
				if (!cancelled) error = m.common_error_generic();
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	async function hide(revision: CommentRevision) {
		// A native prompt for the note, the same low-ceremony pattern this app already uses for a
		// single short value (the rich editor's own link button) — a full sub-form would be a lot
		// of new surface for a moderator action used rarely.
		const note = window.prompt(m.comment_history_hideNotePrompt());
		if (note === null) return;
		busyId = revision.id;
		error = null;
		try {
			const updated = await hideCommentRevision(revision.id, note);
			revisions = revisions.map((r) => (r.id === revision.id ? updated : r));
		} catch {
			error = m.common_error_generic();
		} finally {
			busyId = null;
		}
	}

	async function seal(revision: CommentRevision) {
		const note = window.prompt(m.comment_history_sealNotePrompt());
		if (note === null) return;
		if (!window.confirm(m.comment_history_sealConfirm())) return;
		busyId = revision.id;
		error = null;
		try {
			const updated = await sealCommentRevision(revision.id, note);
			revisions = revisions.map((r) => (r.id === revision.id ? updated : r));
		} catch {
			error = m.common_error_generic();
		} finally {
			busyId = null;
		}
	}
</script>

<ModalShell title={m.comment_history_title()} {onClose}>
	{#if loading}
		<Loading variant="list" count={2} label={m.comment_history_loading()} />
	{:else if error}
		<p class="history-error">{error}</p>
	{:else if revisions.length === 0}
		<p class="history-empty">{m.comment_history_none()}</p>
	{:else}
		<ul class="history-list">
			{#each revisions as revision (revision.id)}
				<li class="history-item">
					<div class="history-item__meta">
						<span class="history-item__date"
							>{formatRelativeDate(revision.createdAt, getLocale())}</span
						>
						{#if revision.editedByDisplayName}
							<span class="history-item__author">{revision.editedByDisplayName}</span>
						{/if}
					</div>
					{#if revision.isSealed}
						<p class="history-item__placeholder">{m.comment_history_sealed()}</p>
					{:else if revision.isHiddenByModerator}
						<p class="history-item__placeholder">{m.comment_history_hiddenByModerator()}</p>
					{:else if revision.body === null}
						<p class="history-item__placeholder">{m.comment_history_unavailable()}</p>
					{:else}
						<div class="history-item__body"><MathContent source={revision.body} /></div>
					{/if}
					{#if authStore.isModerator || authStore.user?.isSuperuser}
						<div class="history-item__actions">
							{#if authStore.isModerator && !revision.isHiddenByModerator && !revision.isSealed}
								<button
									type="button"
									class="history-action"
									disabled={busyId === revision.id}
									onclick={() => hide(revision)}>{m.comment_history_hideAction()}</button
								>
							{/if}
							{#if authStore.user?.isSuperuser && !revision.isSealed}
								<button
									type="button"
									class="history-action history-action--danger"
									disabled={busyId === revision.id}
									onclick={() => seal(revision)}>{m.comment_history_sealAction()}</button
								>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</ModalShell>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.history-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.history-item {
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--border-color);
		&:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}
	}
	.history-item__meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		margin-bottom: var(--space-1);
	}
	.history-item__author {
		font-weight: 600;
	}
	.history-item__body {
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
	}
	.history-item__placeholder {
		font-size: var(--font-size-sm);
		font-style: italic;
		color: var(--text-secondary);
	}
	.history-item__actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.history-action {
		@include mix.focus-ring;
		min-height: 44px;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
		font-size: var(--font-size-xs);
		cursor: pointer;
		&:disabled {
			opacity: 0.5;
			cursor: default;
		}
	}
	.history-action--danger {
		color: var(--status-danger);
		border-color: var(--status-danger);
	}
	.history-error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.history-empty {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
