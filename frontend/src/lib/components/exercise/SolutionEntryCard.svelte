<!-- One hint/solution from the pool: votes, badges, review (accept/deny), the author's own
     edit/delete, suggest-an-edit for everybody else, a lazy per-entry discussion thread, and a
     report button. The page owns the entry list; every action here reports back through
     onUpdated/onDeleted rather than mutating shared state. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Comment, EditSuggestion, SolutionEntry, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		deleteSolutionEntry,
		pinSolutionEntry,
		retractSolutionEntryVote,
		reviewSolutionEntry,
		updateSolutionEntry,
		voteSolutionEntry
	} from '$lib/services/exercises';
	import {
		decideEntryEditSuggestion,
		getEditSuggestionsForEntry,
		submitEntryEditSuggestion
	} from '$lib/services/editSuggestions';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import ReportButton from '$lib/components/shared/ReportButton.svelte';

	let {
		entry,
		canReview,
		onUpdated,
		onDeleted
	}: {
		entry: SolutionEntry;
		canReview: boolean;
		onUpdated: (entry: SolutionEntry) => void;
		onDeleted: (id: string) => void;
	} = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	let isOwn = $derived(
		!!authStore.user && !!entry.authorId && entry.authorId === authStore.user.id
	);
	let net = $derived(entry.voteSummary.netWeight);

	// --- votes -----------------------------------------------------------------------------------
	async function vote(value: 1 | -1) {
		if (!authStore.isAuthenticated || busy) return;
		busy = true;
		error = null;
		try {
			const updated =
				entry.voteSummary.currentUserVote === value
					? await retractSolutionEntryVote(entry.id)
					: await voteSolutionEntry(entry.id, value);
			onUpdated(updated);
		} catch {
			error = m.common_error_generic(); // "Something went wrong. Please try again."
		} finally {
			busy = false;
		}
	}

	// --- review (accept / deny with a required note) ---------------------------------------------
	let showDenyForm = $state(false);
	let denyNote = $state('');

	async function review(decision: 'approve' | 'reject') {
		if (busy) return;
		if (decision === 'reject' && !denyNote.trim()) {
			error = m.entry_denyNoteRequired(); // "Say what went wrong before declining."
			return;
		}
		busy = true;
		error = null;
		try {
			const updated = await reviewSolutionEntry(entry.id, decision, denyNote.trim());
			showDenyForm = false;
			denyNote = '';
			onUpdated(updated);
		} catch {
			error = m.common_error_generic(); // "Something went wrong. Please try again."
		} finally {
			busy = false;
		}
	}

	// --- pinning (staff/governors; server enforces) ----------------------------------------------
	async function togglePin() {
		if (busy) return;
		busy = true;
		error = null;
		try {
			onUpdated(await pinSolutionEntry(entry.id, !entry.pinned));
		} catch {
			error = m.common_error_generic(); // "Something went wrong. Please try again."
		} finally {
			busy = false;
		}
	}

	// --- author's own edit / delete --------------------------------------------------------------
	let showEditForm = $state(false);
	let editBody = $state('');

	function openEdit() {
		editBody = entry.body;
		showEditForm = !showEditForm;
	}

	async function saveEdit() {
		if (!editBody.trim() || busy) return;
		busy = true;
		error = null;
		try {
			const updated = await updateSolutionEntry(entry.id, { body: editBody });
			showEditForm = false;
			onUpdated(updated);
		} catch {
			error = m.common_error_generic(); // "Something went wrong. Please try again."
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (busy) return;
		busy = true;
		error = null;
		try {
			await deleteSolutionEntry(entry.id);
			onDeleted(entry.id);
		} catch {
			error = m.common_error_generic(); // "Something went wrong. Please try again."
			busy = false;
		}
	}

	// --- suggest an edit (anybody signed in, on somebody else's published entry) ------------------
	let showSuggestForm = $state(false);
	let suggestBody = $state('');
	let suggestReason = $state('');
	let suggestSent = $state(false);

	function openSuggest() {
		suggestBody = entry.body;
		suggestSent = false;
		showSuggestForm = !showSuggestForm;
	}

	async function sendSuggestion() {
		if (!suggestBody.trim() || busy) return;
		busy = true;
		error = null;
		try {
			await submitEntryEditSuggestion(entry.id, suggestBody, suggestReason);
			showSuggestForm = false;
			suggestBody = suggestReason = '';
			suggestSent = true;
		} catch {
			error = m.common_error_generic(); // "Something went wrong. Please try again."
		} finally {
			busy = false;
		}
	}

	// --- pending suggestions against this entry (author/staff decide) -----------------------------
	let suggestions = $state<EditSuggestion[]>([]);
	let suggestionsLoaded = $state(false);
	let showSuggestions = $state(false);

	async function toggleSuggestions() {
		showSuggestions = !showSuggestions;
		if (showSuggestions && !suggestionsLoaded) {
			try {
				suggestions = (await getEditSuggestionsForEntry(entry.id)).filter(
					(s) => s.status === 'pending'
				);
			} catch {
				suggestions = [];
			}
			suggestionsLoaded = true;
		}
	}

	async function decideSuggestion(s: EditSuggestion, decision: 'approve' | 'reject') {
		if (busy) return;
		busy = true;
		error = null;
		try {
			await decideEntryEditSuggestion(s.id, decision);
			suggestions = suggestions.filter((row) => row.id !== s.id);
			if (decision === 'approve') {
				onUpdated({ ...entry, body: s.proposedValue });
			}
		} catch {
			error = m.common_error_generic(); // "Something went wrong. Please try again."
		} finally {
			busy = false;
		}
	}

	// --- the entry's own discussion ---------------------------------------------------------------
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

	async function toggleComments() {
		showComments = !showComments;
		if (showComments && !commentsLoaded) {
			try {
				comments = await getCommentsForTarget('solutionEntry', entry.id);
				await resolveUsers(comments.map((c) => c.authorId));
			} catch {
				comments = [];
			}
			commentsLoaded = true;
		}
	}

	async function handleCommentSubmit(body: string, parentId?: string) {
		if (!authStore.user) return;
		const comment = await submitComment(
			'solutionEntry',
			entry.id,
			authStore.user.id,
			body,
			parentId
		);
		comments = [...comments, comment];
		await resolveUsers([comment.authorId]);
	}
</script>

<article class="entry" class:entry--pending={entry.status === 'pending'}>
	<div class="entry__votes" aria-hidden={entry.status !== 'published'}>
		<button
			type="button"
			class="vote-arrow"
			class:vote-arrow--active={entry.voteSummary.currentUserVote === 1}
			aria-pressed={entry.voteSummary.currentUserVote === 1}
			aria-label={m.comment_upvote()}
			disabled={!authStore.isAuthenticated || busy || entry.status !== 'published'}
			title={authStore.isAuthenticated ? m.comment_upvote() : m.comment_loginToVote()}
			onclick={() => vote(1)}>▲</button
		>
		<span class="entry__score" class:positive={net > 0} class:negative={net < 0}>{net}</span>
		<button
			type="button"
			class="vote-arrow"
			class:vote-arrow--active={entry.voteSummary.currentUserVote === -1}
			aria-pressed={entry.voteSummary.currentUserVote === -1}
			aria-label={m.comment_downvote()}
			disabled={!authStore.isAuthenticated || busy || entry.status !== 'published'}
			title={authStore.isAuthenticated ? m.comment_downvote() : m.comment_loginToVote()}
			onclick={() => vote(-1)}>▼</button
		>
	</div>

	<div class="entry__main">
		<header class="entry__meta">
			{#if entry.pinned}
				<span class="badge badge--pinned">{m.entry_pinnedBadge()}</span>
			{/if}
			{#if entry.status === 'pending'}
				<span class="badge badge--pending">{m.entry_pendingBadge()}</span>
			{:else if entry.status === 'rejected'}
				<span class="badge badge--rejected">{m.entry_rejectedBadge()}</span>
			{/if}
			<span class="badge badge--lang">{entry.locale.toUpperCase()}</span>
			{#if entry.authorId}
				<a class="entry__author" href={resolve('/users/[id]', { id: entry.authorId })}
					>{entry.authorDisplayName}</a
				>
			{:else}
				<span class="entry__author entry__author--corpus">{m.entry_corpusAuthor()}</span>
			{/if}
		</header>

		<MathContent source={entry.body} />

		{#if entry.status === 'rejected' && entry.reviewNote}
			<p class="entry__review-note">{m.entry_reviewNote({ note: entry.reviewNote })}</p>
		{/if}

		{#if error}
			<p class="entry__error">{error}</p>
		{/if}
		{#if suggestSent}
			<p class="entry__notice">{m.entry_suggestionSent()}</p>
		{/if}

		<footer class="entry__actions">
			{#if entry.status === 'pending' && canReview && !isOwn}
				<button
					type="button"
					class="action action--accept"
					disabled={busy}
					onclick={() => review('approve')}>{m.entry_accept()}</button
				>
				<button
					type="button"
					class="action action--deny"
					disabled={busy}
					onclick={() => (showDenyForm = !showDenyForm)}>{m.entry_deny()}</button
				>
			{/if}
			{#if authStore.canModerate && entry.status === 'published'}
				<button type="button" class="action" disabled={busy} onclick={togglePin}
					>{entry.pinned ? m.entry_unpin() : m.entry_pin()}</button
				>
			{/if}
			{#if isOwn || (authStore.user?.isModerator && entry.status !== 'published')}
				<button type="button" class="action" onclick={openEdit}>{m.common_edit()}</button>
				<button type="button" class="action action--deny" disabled={busy} onclick={remove}
					>{m.common_delete()}</button
				>
			{/if}
			{#if authStore.isAuthenticated && !isOwn && entry.status === 'published'}
				<button type="button" class="action" onclick={openSuggest}>{m.entry_suggestEdit()}</button>
			{/if}
			{#if isOwn || authStore.canModerate}
				<button type="button" class="action" onclick={toggleSuggestions}
					>{m.entry_suggestionsToggle()}</button
				>
			{/if}
			<button type="button" class="action" onclick={toggleComments}
				>{m.entry_commentsToggle({ count: entry.commentCount })}</button
			>
			<ReportButton kind="solution_entry" objectId={entry.id} />
		</footer>

		{#if showDenyForm}
			<div class="entry__form">
				<textarea rows="2" bind:value={denyNote} placeholder={m.entry_denyNotePlaceholder()}
				></textarea>
				<button
					type="button"
					class="action action--deny"
					disabled={busy}
					onclick={() => review('reject')}>{m.entry_denyConfirm()}</button
				>
			</div>
		{/if}

		{#if showEditForm}
			<div class="entry__form">
				<textarea rows="5" bind:value={editBody}></textarea>
				{#if isOwn && !authStore.user?.isVerifiedContributor && !authStore.canModerate}
					<p class="entry__hint">{m.entry_editRequeues()}</p>
				{/if}
				<button type="button" class="action" disabled={busy} onclick={saveEdit}
					>{m.common_save()}</button
				>
			</div>
		{/if}

		{#if showSuggestForm}
			<div class="entry__form">
				<textarea rows="5" bind:value={suggestBody}></textarea>
				<input
					type="text"
					bind:value={suggestReason}
					placeholder={m.editSuggestion_reasonPlaceholder()}
				/>
				<button type="button" class="action" disabled={busy} onclick={sendSuggestion}
					>{m.entry_sendSuggestion()}</button
				>
			</div>
		{/if}

		{#if showSuggestions}
			{#if suggestions.length === 0}
				<p class="entry__hint">{m.entry_noSuggestions()}</p>
			{:else}
				<ul class="entry__suggestions">
					{#each suggestions as s (s.id)}
						<li>
							<MathContent source={s.proposedValue} />
							{#if s.reason}<p class="entry__hint">{s.reason}</p>{/if}
							<div class="entry__actions">
								<button
									type="button"
									class="action action--accept"
									disabled={busy}
									onclick={() => decideSuggestion(s, 'approve')}
									>{m.entry_acceptSuggestion()}</button
								>
								<button
									type="button"
									class="action action--deny"
									disabled={busy}
									onclick={() => decideSuggestion(s, 'reject')}
									>{m.entry_declineSuggestion()}</button
								>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		{#if showComments}
			<div class="entry__discussion">
				<DiscussionThread {comments} {usersById} onSubmit={handleCommentSubmit} />
			</div>
		{/if}
	</div>
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.entry {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
	}
	.entry--pending {
		border-style: dashed;
	}
	.entry__votes {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		flex: 0 0 auto;
	}
	.vote-arrow {
		background: none;
		border: none;
		padding: 0 var(--space-1);
		cursor: pointer;
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.vote-arrow:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.vote-arrow--active {
		color: var(--accent);
	}
	.entry__score {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.entry__score.positive {
		color: var(--status-success);
	}
	.entry__score.negative {
		color: var(--status-danger);
	}
	.entry__main {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		flex: 1;
	}
	.entry__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
	}
	.badge {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
	.badge--pinned {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
	.badge--pending {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.badge--rejected {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.entry__author {
		color: var(--accent);
		font-weight: 600;
	}
	.entry__author--corpus {
		color: var(--text-secondary);
	}
	.entry__review-note,
	.entry__hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-style: italic;
	}
	.entry__error {
		font-size: var(--font-size-xs);
		color: var(--status-danger);
	}
	.entry__notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.entry__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
	.action {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
	}
	.action--accept {
		color: var(--status-success);
	}
	.action--deny {
		color: var(--status-danger);
	}
	.entry__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		textarea,
		input {
			width: 100%;
			font: inherit;
			padding: var(--space-1);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
		.action {
			align-self: flex-start;
		}
	}
	.entry__suggestions {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
	}
	.entry__discussion {
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-2);
	}
</style>
