<script lang="ts">
	// "It isn't in the list" — the missing half of every taxonomy picker in this app.
	//
	// Somebody submitting an exercise on measure theory, finding no `teoria-miary` topic, previously
	// had two options: file it under the wrong topic, or give up. The backend has taken proposals
	// for a while (`POST /api/taxonomy/propose/`); nothing in the interface ever offered one, which
	// made the whole feature unreachable.
	//
	// A modal rather than an inline form, because this sits INSIDE other forms — an exercise
	// submission, an event, a tutoring listing — and a nested <form> is invalid HTML that silently
	// submits the wrong one. The dialog is also the honest shape: proposing is a detour from what
	// you were doing, and you come back to it.
	//
	// What comes back is `pending` for an ordinary user and `approved` for a moderator, and the
	// proposal is usable EITHER WAY — so the caller can select it immediately. A word you cannot use
	// until somebody wakes up is no use to whoever needed it.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import { proposeTaxonomyNode } from '$lib/services/taxonomy';
	import { taxonomyStore } from '$lib/state/taxonomy.svelte';

	let {
		kind,
		parent,
		onproposed
	}: {
		kind: 'discipline' | 'branch' | 'topic';
		/** Slug of the containing node — a discipline for a branch, a branch for a topic. */
		parent?: string;
		/** Called with the new slug so the caller can select what was just proposed. */
		onproposed?: (slug: string, status: 'pending' | 'approved') => void;
	} = $props();

	let open = $state(false);
	let name = $state('');
	let busy = $state(false);
	let error = $state('');
	let result = $state<'pending' | 'approved' | null>(null);

	const label = $derived(
		kind === 'discipline'
			? m.taxonomy_propose_discipline()
			: kind === 'branch'
				? m.taxonomy_propose_branch()
				: m.taxonomy_propose_topic()
	);

	function reset() {
		name = '';
		error = '';
		result = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		busy = true;
		error = '';
		try {
			const created = await proposeTaxonomyNode({ kind, name: trimmed, parent });
			result = created.status;
			// A discipline or a branch also lives in the preloaded tree (`taxonomy.svelte.ts`), which
			// backs the disciplines index and every picker reading the store. Without this, something
			// proposed here is missing from those surfaces until a hard reload — the caller's own
			// `onproposed` only ever refreshes its own local copy, so the two sources of truth would
			// disagree about a node somebody just created.
			//
			// Done here rather than in each of the four call sites, for the reason
			// `notifications.svelte.ts` already records for its own live stream: one integration point
			// cannot drift, four that each have to remember can. A topic is skipped because the tree
			// holds disciplines and branches only, so refreshing it would be a round trip for nothing.
			if (kind !== 'topic') await taxonomyStore.refresh();
			onproposed?.(created.slug, created.status);
			// Left open on success so the outcome is readable — an approved proposal and one waiting
			// for review are different answers, and a dialog that vanishes tells you neither.
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<button
	type="button"
	class="propose-trigger"
	onclick={() => {
		reset();
		open = true;
	}}
>
	{m.taxonomy_propose_missing()}
</button>

{#if open}
	<ModalShell title={label} onClose={() => (open = false)}>
		{#if result}
			<p class="outcome">
				{result === 'approved' ? m.taxonomy_propose_added() : m.taxonomy_propose_pendingNotice()}
			</p>
			<button type="button" class="primary" onclick={() => (open = false)}>
				{m.common_close()}
			</button>
		{:else}
			<form onsubmit={submit}>
				<label class="field">
					<span>{m.taxonomy_propose_name()}</span>
					<!-- No slug input: the server derives one, and asking somebody proposing "teoria
					     miary" to also invent a URL fragment is a question with one right answer. -->
					<input type="text" bind:value={name} maxlength="200" required />
				</label>
				{#if error}<p class="error">{error}</p>{/if}
				<button type="submit" class="primary" disabled={busy || !name.trim()}>
					{m.taxonomy_propose_submit()}
				</button>
			</form>
		{/if}
	</ModalShell>
{/if}

<style lang="scss">
	.propose-trigger {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-sm);
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-3);
	}
	.field input {
		width: 100%;
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
		margin-bottom: var(--space-2);
	}
	.outcome {
		margin-bottom: var(--space-3);
	}
</style>
