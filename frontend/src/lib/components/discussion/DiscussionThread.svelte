<script lang="ts">
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
		onSubmit
	}: {
		comments: Comment[];
		usersById: Record<string, User>;
		onSubmit: (body: string, parentId?: string) => void;
	} = $props();

	let tree = $derived(buildCommentTree(comments));
</script>

<div class="discussion">
	{#if authStore.isAuthenticated}
		<CommentForm
			placeholder={m.discussion_composerPlaceholder()}
			submitLabel={m.discussion_post()}
			onSubmit={(body) => onSubmit(body)}
		/>
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
				<CommentNode {node} {usersById} onReply={(parentId, body) => onSubmit(body, parentId)} />
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
