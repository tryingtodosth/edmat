<script lang="ts">
	// The lost ticket. Two mandatory fields and one optional note — and the copy says, in both
	// languages, that a document NUMBER is never written down (CONFERENCE-BRIEF.md §3.F, research
	// decision 5). The clerk records what the item looks like and what KIND of thing they were
	// shown; the server refuses the rest.
	//
	// Confirming this cancels the ticket somebody lost, so it is a deliberate second step rather
	// than a button on the rack grid.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { CLOAKROOM_IDENTITY_KINDS, CLOAKROOM_IDENTITY_KIND_LABELS } from '$lib/utils/labels';
	import type { CloakroomIdentityKind, CloakroomItem } from '$lib/types/cloakroom';

	let {
		item,
		busy = false,
		error = '',
		onconfirm,
		oncancel
	}: {
		item: CloakroomItem;
		busy?: boolean;
		error?: string;
		onconfirm: (description: string, identityKind: CloakroomIdentityKind, note: string) => void;
		oncancel: () => void;
	} = $props();

	// `untrack`, deliberately: the dialog is created fresh for one item and destroyed when it
	// closes, so reading the item's own description ONCE is exactly what is wanted — and saying so
	// here is what tells svelte-check the same (`state_referenced_locally`).
	let description = $state(untrack(() => item.description));
	let identityKind = $state<CloakroomIdentityKind>('student_card');
	let note = $state('');
</script>

<div class="scrim">
	<section class="dialog" data-cloakroom-exception>
		<h3>{m.cloakroom_exceptionHeading()}</h3>
		<p class="item">
			{m.cloakroom_exceptionItem({
				rack: item.rackLabel,
				description: item.description ? ` — ${item.description}` : ''
			})}
		</p>
		<p class="lead">{m.cloakroom_exceptionLead()}</p>

		<label>
			<span>{m.cloakroom_exceptionDescription()}</span>
			<input type="text" bind:value={description} name="description" />
		</label>
		<label>
			<span>{m.cloakroom_exceptionIdentity()}</span>
			<select bind:value={identityKind} name="identity_kind">
				{#each CLOAKROOM_IDENTITY_KINDS as kind (kind)}
					<option value={kind}>{CLOAKROOM_IDENTITY_KIND_LABELS[kind]()}</option>
				{/each}
			</select>
		</label>
		<label>
			<span>{m.cloakroom_exceptionNote()}</span>
			<input type="text" bind:value={note} name="note" />
		</label>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<div class="actions">
			<button type="button" class="ghost" onclick={oncancel} disabled={busy}>
				{m.cloakroom_cancel()}
			</button>
			<button
				type="button"
				class="primary"
				disabled={busy}
				onclick={() => onconfirm(description, identityKind, note)}
			>
				{m.cloakroom_exceptionConfirm()}
			</button>
		</div>
	</section>
</div>

<style lang="scss">
	.scrim {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal-scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		background: var(--backdrop);
	}
	.dialog {
		z-index: var(--z-modal);
		width: min(520px, 100%);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--bg-elevated);
		box-shadow: var(--shadow-modal);
	}
	h3 {
		margin: 0 0 var(--space-1);
	}
	.item {
		margin: 0 0 var(--space-2);
		font-weight: 600;
	}
	.lead {
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	label {
		display: block;
		margin-bottom: var(--space-3);
	}
	label span {
		display: block;
		margin-bottom: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	input,
	select {
		width: 100%;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.error {
		margin: 0 0 var(--space-3);
		color: var(--status-danger);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	button {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-color);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
	}
	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-contrast);
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
