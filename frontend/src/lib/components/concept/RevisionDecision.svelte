<script lang="ts">
	/**
	 * Accepting or rejecting a revision — and withdrawing your own.
	 *
	 * The deciding circle here is wider than staff: a governor of any branch the concept is
	 * attached to, and **the article's own author** for revisions of their article (the
	 * `can_decide_entry_suggestion` precedent — the author of a text is the natural first reviewer
	 * of a change to it). Which of those applies is the server's answer, `canDecide`, never
	 * re-derived here.
	 *
	 * Reject stays disabled until a note has been typed — the entries-tab precedent, and the reason
	 * house rule 6 states for refusals generally: "no" without a reason is not a decision anybody
	 * can act on, and the server refuses it anyway (`note_required`).
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { decideRevision, withdrawRevision } from '$lib/services/concepts';
	import type { ConceptRevision } from '$lib/types/concept';
	import { messageForError } from './labels';

	let {
		revision,
		ondecided = undefined
	}: {
		revision: ConceptRevision;
		ondecided?: (revision: ConceptRevision) => void;
	} = $props();

	let note = $state('');
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	async function run(action: () => Promise<ConceptRevision>, done: string) {
		busy = true;
		error = '';
		notice = '';
		try {
			const updated = await action();
			notice = done;
			note = '';
			ondecided?.(updated);
		} catch (e) {
			error = messageForError(e);
		} finally {
			busy = false;
		}
	}
</script>

<section class="decision">
	{#if revision.canDecide}
		<h2>{m.concept_decision_heading()}</h2>
		<!-- "Decide" -->
		<label class="field">
			<span>{m.concept_decision_noteLabel()}</span>
			<!-- "Note" -->
			<textarea rows="3" maxlength="2000" bind:value={note}></textarea>
			<span class="hint">{m.concept_decision_noteHint()}</span>
			<!-- "Needed to reject: whoever wrote this reads it." -->
		</label>
		<div class="actions">
			<button
				type="button"
				class="primary"
				disabled={busy}
				onclick={() =>
					run(
						() => decideRevision(revision.id, 'accept', note.trim()),
						m.concept_decision_accepted() // "Accepted and published."
					)}
			>
				{m.concept_decision_accept()}
				<!-- "Accept and publish" -->
			</button>
			<button
				type="button"
				class="danger"
				disabled={busy || !note.trim()}
				onclick={() =>
					run(
						() => decideRevision(revision.id, 'reject', note.trim()),
						m.concept_decision_rejected() // "Rejected."
					)}
			>
				{m.concept_decision_reject()}
				<!-- "Reject" -->
			</button>
		</div>
	{/if}

	{#if revision.canWithdraw}
		<button
			type="button"
			class="ghost"
			disabled={busy}
			onclick={() => run(() => withdrawRevision(revision.id), m.concept_decision_withdrawn())}
		>
			{m.concept_decision_withdraw()}
			<!-- "Withdraw" -->
		</button>
	{/if}

	{#if error}<p class="error">{error}</p>{/if}
	{#if notice}<p class="notice">{notice}</p>{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.decision {
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
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
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
	.danger,
	.ghost {
		@include mix.button-secondary;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		align-self: flex-start;
	}
	.danger:not(:disabled):hover {
		color: var(--status-danger);
		border-color: var(--status-danger);
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
