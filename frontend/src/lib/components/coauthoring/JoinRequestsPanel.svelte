<script lang="ts">
	// Both halves of "can I work on this?": the form for somebody asking, and the list for the
	// people who decide.
	//
	// One component rather than two, because a project page shows exactly one of them to any given
	// reader and which one is a permission question, not a layout one. A decline needs a note for
	// the same reason a rejected version does — it is read by a person who cannot otherwise tell
	// what would have made the answer different.
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import {
		createJoinRequest,
		decideJoinRequest,
		withdrawJoinRequest
	} from '$lib/services/materialProjects';
	import type { JoinBlockReason, ProjectJoinRequest } from '$lib/types/materialProject';
	import { JOIN_BLOCK_LABELS, JOIN_STATUS_LABELS, messageForError } from './labels';

	let {
		projectId,
		requests = [],
		canManage = false,
		/** `null` means the viewer may ask; anything else is the sentence saying why not. */
		blockReason = null,
		mine = null,
		onchanged = undefined
	}: {
		projectId: string;
		requests?: ProjectJoinRequest[];
		canManage?: boolean;
		blockReason?: JoinBlockReason | null;
		/** The viewer's own pending request, when they have one. */
		mine?: ProjectJoinRequest | null;
		onchanged?: () => void;
	} = $props();

	let statement = $state('');
	let notes = $state<Record<string, string>>({});
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	let pending = $derived(requests.filter((row) => row.status === 'pending'));

	async function run(action: () => Promise<unknown>, done = '') {
		busy = true;
		error = '';
		notice = '';
		try {
			await action();
			notice = done;
			onchanged?.();
		} catch (e) {
			error = messageForError(e);
		} finally {
			busy = false;
		}
	}

	/** `mine` is a prop, so narrowing it in the template does not survive into an event handler —
	 *  the check belongs in the handler itself. */
	function withdrawMine() {
		const request = mine;
		if (!request) return;
		run(() => withdrawJoinRequest(request.id), m.coauth_withdrawn()); // "Withdrawn."
	}

	function ask(event: SubmitEvent) {
		event.preventDefault();
		run(async () => {
			await createJoinRequest(projectId, statement.trim());
			statement = '';
		}, m.coauth_join_sent()); // "Sent. A co-author reads it and decides."
	}
</script>

<section class="join">
	<!-- The heading says which of the two halves this reader is looking at: a manager sees the queue,
	     everybody else sees the way in. -->
	<h2>{canManage ? m.coauth_join_heading() : m.coauth_join_ask()}</h2>
	<!-- "Requests to join" / "Ask to join" -->

	{#if canManage}
		{#if pending.length === 0}
			<p class="hint">{m.coauth_join_empty()}</p>
			<!-- "Nobody is waiting." -->
		{:else}
			<ul>
				{#each pending as request (request.id)}
					<li>
						<div class="row">
							<strong>{request.displayName}</strong>
							<span class="when">{formatDate(request.createdAt)}</span>
							<span class="status">{JOIN_STATUS_LABELS[request.status]()}</span>
						</div>
						<p class="statement">{request.statement}</p>
						<label class="field">
							<span>{m.coauth_decision_noteLabel()}</span>
							<!-- "Note" -->
							<textarea
								rows="2"
								maxlength="2000"
								value={notes[request.id] ?? ''}
								oninput={(e) => (notes = { ...notes, [request.id]: e.currentTarget.value })}
							></textarea>
							<span class="hint">{m.coauth_join_declineNote()}</span>
							<!-- "Needed to decline: the person who asked reads it." -->
						</label>
						<div class="actions">
							<button
								type="button"
								class="primary"
								disabled={busy}
								onclick={() =>
									run(() =>
										decideJoinRequest(request.id, 'accept', (notes[request.id] ?? '').trim())
									)}
							>
								{m.coauth_join_accept()}
								<!-- "Accept" -->
							</button>
							<button
								type="button"
								class="secondary"
								disabled={busy || !(notes[request.id] ?? '').trim()}
								onclick={() =>
									run(() =>
										decideJoinRequest(request.id, 'decline', (notes[request.id] ?? '').trim())
									)}
							>
								{m.coauth_join_decline()}
								<!-- "Decline" -->
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if mine && mine.status === 'pending'}
		<p class="hint">{m.coauth_join_sent()}</p>
		<!-- "Sent. A co-author reads it and decides." -->
		<button type="button" class="secondary" disabled={busy} onclick={withdrawMine}>
			{m.coauth_join_withdraw()}
			<!-- "Withdraw the request" -->
		</button>
	{:else if blockReason}
		<p class="hint">{JOIN_BLOCK_LABELS[blockReason]()}</p>
	{:else}
		<form onsubmit={ask}>
			<label class="field">
				<span>{m.coauth_join_statementLabel()}</span>
				<!-- "Why do you want to work on this?" -->
				<textarea rows="4" maxlength="4000" bind:value={statement} required></textarea>
				<span class="hint">{m.coauth_join_statementHint()}</span>
				<!-- "At least 20 characters — a co-author reads it." -->
			</label>
			<button type="submit" class="primary" disabled={busy || statement.trim().length < 20}>
				{m.coauth_join_send()}
				<!-- "Send the request" -->
			</button>
		</form>
	{/if}

	{#if error}<p class="error">{error}</p>{/if}
	{#if notice}<p class="notice">{notice}</p>{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.join {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	li {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.statement {
		margin: 0;
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
	}
	.when,
	.status,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);

		textarea {
			@include mix.focus-ring;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.primary {
		@include mix.button-primary;
		min-height: 44px;
		padding: var(--space-2) var(--space-4);
	}
	.secondary {
		@include mix.button-secondary;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		align-self: flex-start;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
		white-space: normal;
	}
</style>
