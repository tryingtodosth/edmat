<script lang="ts">
	import type { CommentAttachment } from '$lib/types/comment';
	import { uploadCommentAttachment } from '$lib/services/comments';
	import { ApiError } from '$lib/api/client';
	import { resolve } from '$app/paths';
	import type { Comment, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { buildCommentTree } from '$lib/utils/commentTree';
	import { authStore } from '$lib/state/auth.svelte';
	import CommentForm from './CommentForm.svelte';
	import CommentNode from './CommentNode.svelte';

	let {
		comments,
		usersById,
		onSubmit,
		// A thread somebody may read but not post into (a public course discussion for a non-member)
		// renders no composer rather than one whose submit silently does nothing.
		canPost = true,
		// Bound by a host that has another way in: the "Reply" item on a statement, a solution or a
		// review opens the thread, and a reader who chose "reply" has to arrive at a box rather
		// than at a button asking them to click again. Set it before (or as) the thread mounts.
		composing = $bindable(false)
	}: {
		comments: Comment[];
		usersById: Record<string, User>;
		/** Returning the created comment is what lets attachments be uploaded onto it. */
		onSubmit: (body: string, parentId?: string) => void | Promise<Comment | void>;
		canPost?: boolean;
		composing?: boolean;
	} = $props();

	// Attachments uploaded in this session, overlaid on the comments the parent owns — so none of
	// the eleven pages that render a thread has to learn about files.
	let extra = $state<Record<string, CommentAttachment[]>>({});
	let fileError = $state('');
	let tree = $derived(
		buildCommentTree(comments.map((c) => (extra[c.id] ? { ...c, attachments: extra[c.id] } : c)))
	);
	async function submit(body: string, parentId?: string, files: File[] = []) {
		fileError = '';
		const created = await onSubmit(body, parentId);
		if (files.length === 0) return;
		if (!created) {
			fileError = m.comment_filesNotAdded();
			return;
		}
		const added: CommentAttachment[] = [];
		for (const f of files) {
			try {
				added.push(await uploadCommentAttachment(created.id, f));
			} catch (e) {
				fileError =
					e instanceof ApiError
						? Object.values((e.body as Record<string, unknown>) ?? {})
								.flat()
								.join(' ') || m.comment_filesNotAdded()
						: m.comment_filesNotAdded();
			}
		}
		extra = { ...extra, [created.id]: [...(created.attachments ?? []), ...added] };
	}
</script>

<div class="discussion">
	{#if fileError}<p class="file-error" role="alert">{fileError}</p>{/if}
	{#if authStore.isAuthenticated && canPost}
		<!-- Collapsed behind its own button (owner, 2026-10-09: the input is not on the page until
		     somebody asks for it). Eighteen pages render this thread and none of them had to change
		     for it, which is the whole reason the collapse lives in `CommentForm`. -->
		<CommentForm
			collapsedLabel={m.discussion_startComment()}
			bind:composing
			placeholder={m.discussion_composerPlaceholder()}
			submitLabel={m.discussion_post()}
			allowFiles={true}
			onSubmit={(body, files) => submit(body, undefined, files)}
		/>
		<!-- "Write a comment" -->
	{:else}
		<p class="login-prompt">
			<a href={resolve('/login')}>{m.discussion_loginToComment()}</a>
		</p>
	{/if}

	{#if tree.length === 0}
		<p class="empty">{m.discussion_noComments()}</p>
	{:else}
		<ul class="discussion__roots">
			{#each tree as node (node.comment.id)}
				<CommentNode
					{node}
					{usersById}
					canReply={authStore.isAuthenticated && canPost}
					onReply={(parentId, body, files) => submit(body, parentId, files)}
				/>
			{/each}
		</ul>
	{/if}
</div>

<style lang="scss">
	.discussion {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.empty {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.login-prompt {
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.discussion__roots {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
