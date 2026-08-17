<script lang="ts">
	// The other half of the "⋯" on a comment: what you kept, all in one place.
	//
	// Same "a dedicated editor embedded as its own settings section" shape `DonationLinksEditor` and
	// `TagFollowsEditor` already established — a list with per-row actions, no separate route and no
	// nav link, because this is something you come back to occasionally rather than a place you work.
	//
	// The reason it has to exist at all: saving from the thread is easy and finding it again is not.
	// A comment has no page of its own, so without this list a saved comment is a row in the database
	// and nothing more.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatRelativeDate } from '$lib/utils/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import { commentAnchorId } from '$lib/utils/contentLinks';
	import { getSavedComments, unsaveComment, type SavedComment } from '$lib/services/comments';

	let rows = $state<SavedComment[]>([]);
	let loaded = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		// Once, on mount — nothing it reads is reactive. The settings page is only ever reached by
		// somebody signed in, so there is no auth flag to wait on here.
		getSavedComments()
			.then((result) => (rows = result))
			.catch(() => (error = m.common_error_generic()))
			.finally(() => (loaded = true));
	});

	/** Where the thread is read. The same resolution the course page does for a linked thread, and
	 * for the same reason: a comment hangs off whatever its target hangs off, so the server names the
	 * target and this turns it into a route plus the anchor `CommentNode` renders. A target this app
	 * has no page for — a course's private thread, reached from here rather than from the course —
	 * returns null and the row renders without a link rather than with a broken one. */
	function href(row: SavedComment): string | null {
		const anchor = `#${commentAnchorId(row.comment.id)}`;
		switch (row.targetType) {
			case 'exercise':
				return resolve('/exercises/[id]', { id: row.targetId }) + anchor;
			case 'material':
			case 'materialCoverage':
				return resolve('/materials/[id]', { id: row.targetId }) + anchor;
			case 'service':
				return resolve('/services/[id]', { id: row.targetId }) + anchor;
			case 'taughtCourse':
				return resolve('/courses/[id]', { id: row.targetId }) + anchor;
			default:
				return null;
		}
	}

	async function remove(row: SavedComment) {
		error = null;
		try {
			await unsaveComment(row.comment.id);
			rows = rows.filter((r) => r.id !== row.id);
		} catch {
			error = m.common_error_generic();
		}
	}
</script>

<div class="saved-comments">
	{#if !loaded}
		<p class="hint">{m.common_loading()}</p>
	{:else if rows.length === 0}
		<p class="hint">{m.savedComments_none()}</p>
	{:else}
		<ul>
			{#each rows as row (row.id)}
				<li>
					<p class="body">{row.comment.body}</p>
					<p class="meta">
						<span>{formatRelativeDate(row.createdAt, getLocale())}</span>
						{#if href(row)}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built by `href()`, which calls resolve() itself; the rule only sees the attribute -->
							<a href={href(row)}>{m.savedComments_open()}</a>
						{/if}
						<button type="button" class="link danger" onclick={() => remove(row)}>
							{m.savedComments_remove()}
						</button>
					</p>
				</li>
			{/each}
		</ul>
	{/if}
	{#if error}<p class="error">{error}</p>{/if}
</div>

<style lang="scss">
	ul {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	li {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.body {
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
