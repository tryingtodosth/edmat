<script lang="ts">
	import type { CommentAttachment } from '$lib/types/comment';
	import { uploadCommentAttachment } from '$lib/services/comments';
	import { ApiError } from '$lib/api/client';
	import { resolve } from '$app/paths';
	import type { Comment, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { buildCommentTree } from '$lib/utils/commentTree';
	import { authStore } from '$lib/state/auth.svelte';
	import type { Anchor, CommentExtras } from '$lib/types/blocks';
	import { ANCHOR_REFUSAL_LABELS } from '$lib/components/blocks/labels';
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
		composing = $bindable(false),
		// Whose blocks a top-level comment's anchor names (`blocks/anchoring.ts`): `exercise-12`,
		// `solutionEntry-7`. Without it a top-level comment's "On: …" line has nowhere to jump.
		scope = '',
		// Set by a host whose content was just asked to be commented on (`BlockContent`'s "Comment
		// on this"): the composer opens with this as what the comment is about. Set `composing` too.
		anchor = $bindable(null),
		// The name of what `anchor` points into, for the composer's "Commenting on …" line.
		anchorLabel = undefined,
		// Narrows the list to the comments about ONE block (a block's "💬 2" was pressed). Bindable,
		// so the "Show all" in the bar can clear it.
		focusBlock = $bindable(null),
		// Offer "Write as a notebook". Every thread endpoint saves through `CommentSerializer`, so
		// every one accepts blocks; a host whose submit handler does not forward `extras` must pass
		// false, or a notebook would be posted as an empty body.
		notebook = true
	}: {
		comments: Comment[];
		usersById: Record<string, User>;
		/** Returning the created comment is what lets attachments be uploaded onto it. `extras` is
		 *  the notebook and the anchor — forward it to the service (`submitComment`'s last argument). */
		onSubmit: (
			body: string,
			parentId?: string,
			extras?: CommentExtras
		) => void | Promise<Comment | void>;
		canPost?: boolean;
		composing?: boolean;
		scope?: string;
		anchor?: Anchor | null;
		anchorLabel?: string;
		focusBlock?: string | null;
		notebook?: boolean;
	} = $props();

	// Attachments uploaded in this session, overlaid on the comments the parent owns — so none of
	// the eleven pages that render a thread has to learn about files.
	let extra = $state<Record<string, CommentAttachment[]>>({});
	let fileError = $state('');
	let tree = $derived(
		buildCommentTree(comments.map((c) => (extra[c.id] ? { ...c, attachments: extra[c.id] } : c)))
	);
	const shown = $derived(
		focusBlock ? tree.filter((n) => n.comment.anchor?.block === focusBlock) : tree
	);

	async function submit(
		body: string,
		parentId?: string,
		files: File[] = [],
		extras: CommentExtras = {}
	) {
		fileError = '';
		let created: Comment | void;
		try {
			created = await onSubmit(body, parentId, extras);
		} catch (e) {
			// An anchor refused between selecting and posting — its block was deleted meanwhile —
			// is said in words (house rule 6); anything else keeps the behaviour it always had.
			const word =
				e instanceof ApiError
					? ((e.body as Record<string, unknown> | null)?.anchor as string[] | undefined)?.[0]
					: undefined;
			if (word && ANCHOR_REFUSAL_LABELS[word]) {
				fileError = ANCHOR_REFUSAL_LABELS[word]();
				return;
			}
			throw e;
		}
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
			allowNotebook={notebook}
			bind:anchor
			{anchorLabel}
			onSubmit={(body, files, extras) => submit(body, undefined, files, extras)}
		/>
		<!-- "Write a comment" -->
	{:else}
		<p class="login-prompt">
			<a href={resolve('/login')}>{m.discussion_loginToComment()}</a>
		</p>
	{/if}

	{#if focusBlock}
		<div class="discussion__focus" role="status">
			<span>{m.notebook_filtered({ count: shown.length })}</span>
			<!-- "{count} comments about this part" -->
			<button type="button" onclick={() => (focusBlock = null)}>{m.notebook_showAll()}</button>
			<!-- "Show all comments" -->
		</div>
	{/if}

	{#if shown.length === 0}
		<p class="empty">{m.discussion_noComments()}</p>
	{:else}
		<ul class="discussion__roots">
			{#each shown as node (node.comment.id)}
				<CommentNode
					{node}
					{usersById}
					targetScope={scope}
					allowNotebook={notebook}
					canReply={authStore.isAuthenticated && canPost}
					onReply={(parentId, body, files, extras) => submit(body, parentId, files, extras)}
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
	.discussion__focus {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-sm);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--accent-soft);

		button {
			border: 0;
			background: none;
			color: var(--accent);
			font: inherit;
			font-weight: 600;
			cursor: pointer;
			text-decoration: underline;
		}
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
