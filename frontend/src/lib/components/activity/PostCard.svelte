<!-- One anchored micro-post: author, anchor chip (a link into the feed filtered to that anchor —
     the "thread around it"), the words (same math pipeline as everything), the optional image and
     content reference, a lazy comment thread, report, and the author's own delete. A tombstoned
     post renders its shell honestly ("removed") so permalinks and threads survive. -->
<script lang="ts">
	import type { Anchor, CommentExtras, ContentBlock } from '$lib/types/blocks';
	import BlockContent from '$lib/components/blocks/BlockContent.svelte';
	import { anchorCounts, type Annotate } from '$lib/components/blocks/anchoring';
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { localizedPath } from '$lib/utils/localizedPath';
	import type { Comment, Post, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatRelativeDate } from '$lib/utils/format';
	import { authStore } from '$lib/state/auth.svelte';
	import { deletePost } from '$lib/services/activity';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import ReportButton from '$lib/components/shared/ReportButton.svelte';

	let {
		post,
		linkTitle = true,
		expandThread = false,
		onDeleted
	}: {
		post: Post;
		/** false on the post's own page — a self-link is not navigation. */
		linkTitle?: boolean;
		/** true on the post's own page: the thread is the point there, no toggle. */
		expandThread?: boolean;
		onDeleted?: (id: string) => void;
	} = $props();

	let removedLocally = $state(false);
	let hidden = $derived(post.isRemoved || post.isAutoHidden || removedLocally);
	let isOwn = $derived(!!authStore.user && post.authorId === authStore.user.id);
	let busy = $state(false);
	let error = $state<string | null>(null);

	function anchorHref(): string {
		// A tag has a page of its own since WP15 — the questions asked in it. Every other anchor
		// still opens the feed filtered to it.
		if (post.tagSlug) return resolve('/tags/[slug]', { slug: encodeURIComponent(post.tagSlug) });
		const url = new URL(resolve('/activity'), 'http://x');
		if (post.topicId) url.searchParams.set('topic', post.topicId);
		else if (post.branchId) url.searchParams.set('branch', post.branchId);
		else if (post.disciplineId) url.searchParams.set('discipline', post.disciplineId);
		// The landing page shows the filter as a human name without a lookup of its own.
		url.searchParams.set('label', post.anchorLabel);
		return url.pathname + url.search;
	}

	async function remove() {
		if (busy) return;
		busy = true;
		error = null;
		try {
			await deletePost(post.id);
			removedLocally = true;
			onDeleted?.(post.id);
		} catch {
			error = m.common_error_generic(); // "Something went wrong."
		} finally {
			busy = false;
		}
	}

	// --- the thread ------------------------------------------------------------------------------
	let showComments = $state(false);
	let comments = $state<Comment[]>([]);
	let commentsLoaded = $state(false);
	let usersById = $state<Record<string, User>>({});

	async function resolveUsers(ids: string[]) {
		const unique = [...new Set(ids)].filter((id) => id && !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const u of found) if (u) next[u.id] = u;
		usersById = next;
	}

	async function loadComments() {
		try {
			comments = await getCommentsForTarget('post', post.id);
			await resolveUsers(comments.map((c) => c.authorId));
		} catch {
			comments = [];
		}
		commentsLoaded = true;
	}

	async function toggleComments() {
		showComments = !showComments;
		if (showComments && !commentsLoaded) await loadComments();
	}

	$effect(() => {
		if (expandThread) {
			showComments = true;
			if (!commentsLoaded) untrack(() => loadComments());
		}
	});

	// Commenting on ONE block of the post, or a passage in it (2026-11-04). A plain post is one
	// implicit block, `body`. The counts appear once the thread is open (it is fetched lazily).
	let commentAnchor = $state<Anchor | null>(null);
	let composingComment = $state(false);
	let focusBlock = $state<string | null>(null);
	const postBlocks = $derived<ContentBlock[]>(
		post.blocks.length > 0 ? post.blocks : [{ id: 'body', kind: 'markdown', body: post.body }]
	);
	const postAnnotate = $derived<Annotate | undefined>(
		authStore.isAuthenticated
			? {
					counts: anchorCounts(comments.filter((c) => !c.parentId)),
					onComment: async (anchor) => {
						commentAnchor = anchor;
						focusBlock = null;
						composingComment = true;
						if (!showComments) await toggleComments();
					},
					onShow: async (block) => {
						focusBlock = block;
						if (!showComments) await toggleComments();
					}
				}
			: undefined
	);

	async function handleCommentSubmit(
		body: string,
		parentId?: string,
		extras?: CommentExtras
	): Promise<Comment | void> {
		if (!authStore.user) return;
		const comment = await submitComment('post', post.id, authStore.user.id, body, parentId, extras);
		comments = [...comments, comment];
		await resolveUsers([comment.authorId]);
		return comment;
	}
</script>

<article class="post" class:post--hidden={hidden}>
	<header class="post__meta">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- anchorHref() builds on resolve('/activity') and only appends a query -->
		<a class="post__anchor" href={anchorHref()}>{post.anchorLabel}</a>
		{#if !hidden && post.authorId}
			<a class="post__author" href={resolve('/users/[id]', { id: post.authorId })}
				>{post.authorDisplayName}</a
			>
		{/if}
		<span class="post__when">{formatRelativeDate(post.createdAt, getLocale())}</span>
		{#if linkTitle && !hidden}
			<a class="post__permalink" href={resolve('/posts/[id]', { id: post.id })}>{m.post_open()}</a>
		{/if}
	</header>

	{#if hidden}
		<p class="post__tombstone">{m.post_removed()}</p>
	{:else}
		<BlockContent blocks={postBlocks} scope={`post-${post.id}`} annotate={postAnnotate} />
		{#if post.imageUrl}
			<!-- Empty alt on purpose: the author is never asked for a description, and an invented
			     one read aloud on every post would be worse than marking it decorative — the same
			     call the event-post image already made. -->
			<img class="post__image" src={post.imageUrl} alt="" loading="lazy" />
		{/if}
		{#if post.refExerciseId}
			<a class="post__ref" href={resolve('/exercises/[id]', { id: post.refExerciseId })}
				>{m.post_refExercise({ title: post.refExerciseTitle ?? '' })}</a
			>
		{:else if post.refMaterialId}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call so a localized route renders its Polish address; the rule only sees a bare `resolve()` without type-aware linting, which this project does not run. Prettier puts the href on its own line here, where a next-line comment cannot reach it. See lib/utils/localizedPath.ts. -->
			<a
				class="post__ref"
				href={localizedPath(resolve('/materials/[id]', { id: post.refMaterialId }))}
				>{m.post_refMaterial({ title: post.refMaterialTitle ?? '' })}</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{:else if post.refCourseId}
			<a class="post__ref" href={resolve('/courses/[id]', { id: post.refCourseId })}
				>{m.post_refCourse({ title: post.refCourseTitle ?? '' })}</a
			>
		{/if}
	{/if}

	{#if error}
		<p class="post__error">{error}</p>
	{/if}

	<footer class="post__actions">
		{#if !expandThread}
			<button type="button" class="action" onclick={toggleComments}
				>{m.entry_commentsToggle({ count: post.commentCount })}</button
			>
		{/if}
		{#if !hidden && post.attachmentCount > 0 && linkTitle}
			<!-- Files, pictures, notes and links on the post live on its own page (2026-10-21). -->
			<a class="action" href={resolve('/posts/[id]', { id: post.id })}
				>{m.post_attachments({ count: post.attachmentCount })}</a
			>
			<!-- "{count} attached" -->
		{/if}
		{#if !hidden}
			<ReportButton kind="post" objectId={post.id} />
			{#if isOwn || authStore.user?.isModerator}
				<button type="button" class="action action--danger" disabled={busy} onclick={remove}
					>{m.common_delete()}</button
				>
			{/if}
		{/if}
	</footer>

	{#if showComments}
		<div class="post__discussion">
			<DiscussionThread
				{comments}
				{usersById}
				bind:composing={composingComment}
				bind:anchor={commentAnchor}
				bind:focusBlock
				scope={`post-${post.id}`}
				anchorLabel={m.notebook_thisPost()}
				onSubmit={handleCommentSubmit}
			/>
		</div>
	{/if}
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.post {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
	}
	// Hidden drops the whole card to the secondary text colour — never opacity on content (at .72
	// `--text-secondary` falls to 3.51:1).
	.post--hidden {
		color: var(--text-secondary);
	}
	.post--hidden .post__author,
	.post--hidden .post__ref {
		color: inherit;
	}
	.post__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
	}
	.post__anchor {
		@include mix.neutral-pill;
		font-weight: 600;
	}
	.post__author {
		color: var(--text-primary);
		font-weight: 600;
	}
	.post__when {
		color: var(--text-secondary);
	}
	.post__permalink {
		margin-left: auto;
		color: var(--text-secondary);
	}
	.post__tombstone {
		font-size: var(--font-size-sm);
		font-style: italic;
		color: var(--text-secondary);
	}
	.post__image {
		max-width: 100%;
		border-radius: var(--radius-sm);
		align-self: flex-start;
	}
	.post__ref {
		font-size: var(--font-size-sm);
		color: var(--accent);
		font-weight: 600;
	}
	.post__error {
		font-size: var(--font-size-xs);
		color: var(--status-danger);
	}
	.post__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}
	.action {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
		cursor: pointer;
		&:hover {
			color: var(--accent);
		}
	}
	.action--danger {
		color: var(--status-danger);
	}
	.post__discussion {
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-2);
	}
</style>
