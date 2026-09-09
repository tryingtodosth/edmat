<script lang="ts">
	/** A session's Q&A — the generic Comment thread with the votes it already has, so a question
	 * asked from the room can be upvoted by the rest of it. Lazy: fetched on first open. */
	import { m } from '$lib/paraglide/messages.js';
	import type { Comment } from '$lib/types';
	import type { User } from '$lib/types/user';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { authStore } from '$lib/state/auth.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';

	let { sessionId }: { sessionId: string } = $props();
	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});
	let loading = $state(true);

	async function resolveUsers(ids: string[]) {
		const unique = [...new Set(ids)].filter((id) => id && !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const u of found) if (u) next[u.id] = u;
		usersById = next;
	}
	async function load() {
		loading = true;
		try {
			comments = await getCommentsForTarget('eventSession', sessionId);
			await resolveUsers(comments.map((c) => c.authorId));
		} finally {
			loading = false;
		}
	}
	load();
	async function handleComment(body: string, parentId?: string) {
		if (!authStore.user) return;
		const c = await submitComment('eventSession', sessionId, authStore.user.id, body, parentId);
		comments = [...comments, c];
		await resolveUsers([c.authorId]);
	}
</script>

<div class="qa">
	<h4>{m.events_sessionQA()}</h4>
	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else}
		<DiscussionThread {comments} {usersById} onSubmit={handleComment} />
	{/if}
</div>

<style lang="scss">
	.qa {
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px dashed var(--border);
	}
	h4 {
		margin: 0 0 0.4rem;
		font-size: 0.95rem;
	}
	.status {
		color: var(--text-secondary);
		font-size: 0.85rem;
	}
</style>
