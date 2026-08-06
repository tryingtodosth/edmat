<script lang="ts">
	// Self-imports for recursion — one component renders both a comment and its nested replies.
	import type { CommentNode as CommentNodeT } from '$lib/utils/commentTree';
	import type { Comment, User } from '$lib/types';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatRelativeDate } from '$lib/utils/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import { authStore } from '$lib/state/auth.svelte';
	import { deleteComment, updateComment } from '$lib/services/comments';
	import MeatballsMenu from '$lib/components/shared/MeatballsMenu.svelte';
	import ReportModal from '$lib/components/shared/ReportModal.svelte';
	import CommentForm from './CommentForm.svelte';
	import CommentNode from './CommentNode.svelte';

	let {
		node,
		usersById,
		onReply
	}: {
		node: CommentNodeT;
		usersById: Record<string, User>;
		onReply: (parentId: string, body: string) => void;
	} = $props();

	// MeatballsMenu declares this shape in its own instance script, which cannot be imported as a
	// type — so it is restated here rather than left unannotated.
	type MenuItem = { label: string; onselect: () => void; danger?: boolean; disabled?: boolean };

	let replying = $state(false);
	let editing = $state(false);
	let confirmingDelete = $state(false);
	let reporting = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	// An edit or a delete changes this one comment and nothing else about the tree — the row
	// survives a delete (it is a tombstone, so replies keep their place). So the updated version is
	// held here rather than pushed up through every page that renders a thread: no call site of
	// DiscussionThread has to grow a prop, and the next real fetch replaces it with the same thing
	// the server already has.
	let local = $state<Comment | null>(null);
	let comment = $derived(local ?? node.comment);

	let isAuthor = $derived(authStore.user?.id === comment.authorId);
	// Both are "the content genuinely isn't here anymore," with different finality and now a
	// different author: a moderator's decision, the community-report threshold firing, or the
	// person themselves taking it down.
	let hidden = $derived(comment.isRemoved || comment.isAutoHidden);

	let menuItems = $derived.by<MenuItem[]>(() => {
		if (!authStore.isAuthenticated || hidden) return [];
		const items: MenuItem[] = [
			{ label: m.discussion_reply(), onselect: () => ((editing = false), (replying = true)) }
		];
		if (isAuthor) {
			items.push({
				label: m.comment_edit(),
				onselect: () => ((replying = false), (editing = true))
			});
			items.push({
				label: m.comment_delete(),
				danger: true,
				// Two steps rather than one: MeatballsMenu deliberately confirms nothing itself, and
				// this is not undoable — the body is gone even though the row stays as a tombstone.
				onselect: () => (confirmingDelete = true)
			});
		} else {
			// Reporting your own comment is not a thing anybody means to do, so it is left out
			// rather than offered and then refused.
			items.push({ label: m.report_action(), onselect: () => (reporting = true) });
		}
		return items;
	});

	async function saveEdit(body: string) {
		busy = true;
		error = null;
		try {
			local = await updateComment(comment.id, body, comment.targetType, comment.targetId);
			editing = false;
		} catch {
			error = m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	async function confirmDelete() {
		busy = true;
		error = null;
		try {
			local = await deleteComment(comment.id, comment.targetType, comment.targetId);
			confirmingDelete = false;
		} catch {
			error = m.common_error_generic();
		} finally {
			busy = false;
		}
	}
</script>

<li class="comment">
	<div class="comment__top">
		{#if usersById[comment.authorId] && !hidden}
			<a class="comment__author" href={resolve('/users/[id]', { id: comment.authorId })}>
				{usersById[comment.authorId].displayName}
			</a>
		{:else}
			<span class="comment__author">—</span>
		{/if}
		<span class="comment__date">{formatRelativeDate(comment.createdAt, getLocale())}</span>
		{#if comment.isEdited && !hidden}
			<!-- "(edited)" — a reply may have been written in answer to what this used to say. -->
			<span class="comment__edited">{m.comment_editedMarker()}</span>
		{/if}
		{#if menuItems.length > 0}
			<span class="comment__menu">
				<MeatballsMenu items={menuItems} label={m.comment_actionsLabel()} />
			</span>
		{/if}
	</div>

	{#if comment.isRemoved}
		<p class="comment__body comment__body--hidden">
			{comment.removedByAuthor
				? m.comment_deletedByAuthorPlaceholder()
				: m.comment_removedPlaceholder()}
		</p>
	{:else if comment.isAutoHidden}
		<p class="comment__body comment__body--hidden">{m.comment_autoHiddenPlaceholder()}</p>
	{:else if editing}
		<div class="comment__edit-form">
			<CommentForm
				placeholder={m.discussion_composerPlaceholder()}
				submitLabel={m.comment_saveEdit()}
				initialBody={comment.body}
				onSubmit={saveEdit}
				onCancel={() => (editing = false)}
			/>
		</div>
	{:else}
		<p class="comment__body">{comment.body}</p>
	{/if}

	{#if error}<p class="comment__error">{error}</p>{/if}

	{#if confirmingDelete}
		<div class="comment__confirm">
			<span>{m.comment_deleteConfirm()}</span>
			<button type="button" class="confirm-yes" disabled={busy} onclick={confirmDelete}>
				{m.comment_delete()}
			</button>
			<button type="button" class="confirm-no" onclick={() => (confirmingDelete = false)}>
				{m.common_cancel()}
			</button>
		</div>
	{/if}

	{#if replying}
		<div class="comment__reply-form">
			<CommentForm
				placeholder={m.discussion_replyPlaceholder()}
				submitLabel={m.discussion_post()}
				onSubmit={(body) => {
					onReply(comment.id, body);
					replying = false;
				}}
				onCancel={() => (replying = false)}
			/>
		</div>
	{/if}

	{#if node.replies.length > 0}
		<ul class="comment__replies">
			{#each node.replies as reply (reply.comment.id)}
				<CommentNode node={reply} {usersById} {onReply} />
			{/each}
		</ul>
	{/if}
</li>

{#if reporting}
	<ReportModal kind="comment" objectId={comment.id} onClose={() => (reporting = false)} />
{/if}

<style lang="scss">
	.comment {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.comment__top {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.comment__author {
		font-weight: 600;
		font-size: var(--font-size-sm);
		&:hover {
			text-decoration: underline;
		}
	}
	.comment__date {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.comment__edited {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-style: italic;
	}
	.comment__menu {
		margin-left: auto;
		// Out of the way until you are looking at this comment — a "⋯" on every row at all times
		// turns a thread into a column of controls. Revealed by hover, by keyboard focus landing
		// anywhere in the comment, and while its own menu is open (or it would vanish from under
		// the pointer the moment the menu opened below it).
		opacity: 0;
		transition: opacity 120ms ease;
		// Direct-child selectors on purpose: replies are `.comment`s nested inside this one, so a
		// descendant match would light up every ancestor's menu at once while the pointer sits on a
		// reply deep in the thread.
		.comment:hover > .comment__top > &,
		.comment:focus-within > .comment__top > & {
			opacity: 1;
		}
	}
	// A touch screen has no hover at all, so the same rule would make this permanently unreachable
	// there. Shown outright instead.
	@media (hover: none) {
		.comment__menu {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.comment__menu {
			transition: none;
		}
	}
	.comment__body {
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
	}
	.comment__body--hidden {
		color: var(--text-secondary);
		font-style: italic;
	}
	.comment__error {
		font-size: var(--font-size-xs);
		color: var(--status-danger);
	}
	.comment__confirm {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.confirm-yes {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--status-danger);
		cursor: pointer;
	}
	.confirm-no {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
	}
	.comment__edit-form,
	.comment__reply-form {
		margin-top: var(--space-1);
	}
	.comment__replies {
		list-style: none;
		margin: var(--space-2) 0 0 var(--space-4);
		padding-left: var(--space-3);
		border-left: 2px solid var(--border-color);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
</style>
