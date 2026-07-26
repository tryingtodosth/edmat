<script lang="ts">
	// Self-imports for recursion — one component renders both a comment and its nested replies.
	import type { CommentNode as CommentNodeT } from '$lib/utils/commentTree';
	import type { User } from '$lib/types';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatRelativeDate } from '$lib/utils/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import { authStore } from '$lib/state/auth.svelte';
	import ReportButton from '$lib/components/shared/ReportButton.svelte';
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

	let replying = $state(false);
	// Both are "content genuinely isn't here anymore," just with different finality — isRemoved is
	// a moderator's own permanent decision, isAutoHidden is the community-report threshold firing
	// automatically, reversible via a moderator's later "restore" (CLAUDE.md's own reporting-system
	// note). Neither used to render as anything beyond a silently-empty body/author before this —
	// a real, found gap, not something being changed for its own sake.
	let hidden = $derived(node.comment.isRemoved || node.comment.isAutoHidden);
</script>

<li class="comment">
	<div class="comment__top">
		{#if usersById[node.comment.authorId]}
			<a class="comment__author" href={resolve('/users/[id]', { id: node.comment.authorId })}>
				{usersById[node.comment.authorId].displayName}
			</a>
		{:else}
			<span class="comment__author">—</span>
		{/if}
		<span class="comment__date">{formatRelativeDate(node.comment.createdAt, getLocale())}</span>
	</div>
	{#if node.comment.isRemoved}
		<p class="comment__body comment__body--hidden">{m.comment_removedPlaceholder()}</p>
	{:else if node.comment.isAutoHidden}
		<p class="comment__body comment__body--hidden">{m.comment_autoHiddenPlaceholder()}</p>
	{:else}
		<p class="comment__body">{node.comment.body}</p>
	{/if}
	{#if !hidden}
		<div class="comment__actions">
			{#if authStore.isAuthenticated}
				<button type="button" class="reply-toggle" onclick={() => (replying = !replying)}
					>{m.discussion_reply()}</button
				>
				<ReportButton kind="comment" objectId={node.comment.id} />
			{/if}
		</div>
	{/if}

	{#if replying}
		<div class="comment__reply-form">
			<CommentForm
				placeholder={m.discussion_replyPlaceholder()}
				submitLabel={m.discussion_post()}
				onSubmit={(body) => {
					onReply(node.comment.id, body);
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
	.comment__body {
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
	}
	.comment__body--hidden {
		color: var(--text-secondary);
		font-style: italic;
	}
	.comment__actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.reply-toggle {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-weight: 600;
	}
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
