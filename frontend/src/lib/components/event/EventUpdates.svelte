<script lang="ts">
	// The event's feed of updates, plus the composer when the reader is the host.
	//
	// Loaded by this component rather than by the page, and failing quietly on its own: an event page
	// whose main content vanished because a secondary list 404'd would be a worse page than one
	// showing the event with no updates under it.
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDateTime } from '$lib/utils/datetime';
	import {
		createEventPost,
		deleteEventPost,
		getEventPosts,
		updateEventPost
	} from '$lib/services/events';
	import type { EventPost, EventPostDraft } from '$lib/types/event';
	import EventPostForm from './EventPostForm.svelte';

	let { eventId, isHost = false }: { eventId: string; isHost?: boolean } = $props();

	let posts = $state<EventPost[]>([]);
	let loading = $state(true);
	let composing = $state(false);
	let editingId = $state<string | null>(null);
	let busy = $state(false);
	let formError = $state('');

	onMount(async () => {
		try {
			posts = await getEventPosts(eventId);
		} catch {
			// A draft nobody may read answers 404 here, which is the rule working rather than a fault
			// worth showing. Either way the section simply renders empty.
			posts = [];
		} finally {
			loading = false;
		}
	});

	async function create(draft: EventPostDraft) {
		busy = true;
		formError = '';
		try {
			const post = await createEventPost(eventId, draft);
			// Prepended rather than refetched: the list is newest-first, so the new post's place is
			// known without asking, and a refetch would throw away the scroll position for nothing.
			posts = [post, ...posts];
			composing = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	async function save(postId: string, draft: EventPostDraft) {
		busy = true;
		formError = '';
		try {
			const updated = await updateEventPost(eventId, postId, draft);
			posts = posts.map((p) => (p.id === postId ? updated : p));
			editingId = null;
		} catch (e) {
			formError = e instanceof Error ? e.message : m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	async function withdraw(postId: string) {
		if (!confirm(m.eventPosts_deleteConfirm())) return;
		busy = true;
		try {
			await deleteEventPost(eventId, postId);
			posts = posts.filter((p) => p.id !== postId);
		} catch {
			// Left in place on failure rather than optimistically removed — a post that vanishes and
			// comes back on the next load is worse than one that did not move.
		} finally {
			busy = false;
		}
	}

	/** What a link is shown as. The host and path, without the scheme and without a trailing slash —
	 * enough to tell a Drive folder from an arXiv paper at a glance, which is the decision somebody
	 * makes before clicking. Falls back to the raw string for anything that will not parse, since a
	 * link that cannot be displayed is still one that should be clickable. */
	function linkLabel(url: string): string {
		try {
			const parsed = new URL(url);
			const shown = `${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
			return shown.length > 60 ? `${shown.slice(0, 59)}…` : shown;
		} catch {
			return url;
		}
	}
</script>

<section class="updates">
	<div class="head">
		<h2>{m.eventPosts_heading()}</h2>
		{#if isHost && !composing}
			<button type="button" class="new" onclick={() => (composing = true)}>
				{m.eventPosts_new()}
			</button>
		{/if}
	</div>

	{#if isHost && composing}
		<div class="composer">
			<EventPostForm
				submitting={busy}
				error={formError}
				submitLabel={m.eventPosts_publish()}
				onsubmit={create}
				oncancel={() => {
					composing = false;
					formError = '';
				}}
			/>
		</div>
	{/if}

	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if posts.length === 0}
		<p class="status">
			{isHost ? m.eventPosts_emptyForHost() : m.eventPosts_empty()}
		</p>
	{:else}
		<ol class="list">
			{#each posts as post (post.id)}
				<li class="post">
					{#if editingId === post.id}
						<EventPostForm
							initial={post}
							submitting={busy}
							error={formError}
							submitLabel={m.common_save()}
							onsubmit={(draft) => save(post.id, draft)}
							oncancel={() => {
								editingId = null;
								formError = '';
							}}
						/>
					{:else}
						<div class="meta">
							<time datetime={post.createdAt}>{formatDateTime(post.createdAt)}</time>
							{#if post.isEdited}
								<span class="edited">{m.eventPosts_edited()}</span>
							{/if}
							{#if isHost}
								<span class="controls">
									<button
										type="button"
										class="link-button"
										disabled={busy}
										onclick={() => {
											editingId = post.id;
											formError = '';
										}}
									>
										{m.events_edit()}
									</button>
									<button
										type="button"
										class="link-button"
										disabled={busy}
										onclick={() => withdraw(post.id)}
									>
										{m.common_delete()}
									</button>
								</span>
							{/if}
						</div>

						{#if post.body}
							<p class="body">{post.body}</p>
						{/if}

						{#if post.imageUrl}
							<!-- No alt text is available: the host uploads a picture, and this app never asks
							     them for a description. An empty alt marks it decorative to a screen reader,
							     which is the honest answer — inventing one ("event picture") would be noise
							     read aloud on every post. -->
							<img class="picture" src={post.imageUrl} alt="" loading="lazy" />
						{/if}

						{#if post.links.length > 0}
							<ul class="links">
								{#each post.links as link (link)}
									<li>
										<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a host-supplied external URL, deliberately not an internal route -->
										<a href={link} target="_blank" rel="noopener noreferrer nofollow">
											{linkLabel(link)}
										</a>
									</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.updates {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		h2 {
			font-size: var(--font-size-lg);
		}
	}
	.new {
		@include mix.button-secondary;
	}
	.composer {
		@include mix.card-surface;
		padding: var(--space-3);
	}
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.post {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.meta {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.controls {
		display: flex;
		gap: var(--space-2);
		margin-left: auto;
	}
	.link-button {
		@include mix.focus-ring;
		background: none;
		border: none;
		padding: 0;
		color: var(--text-secondary);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
	}
	.body {
		// The host wrote line breaks on purpose — "room 5" on its own line is a different message
		// from the same words run into a paragraph.
		white-space: pre-wrap;
	}
	.picture {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-color);
	}
	.links {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		a {
			// A long URL must wrap rather than widen the card and give the whole page a horizontal
			// scrollbar.
			overflow-wrap: anywhere;
		}
	}
</style>
