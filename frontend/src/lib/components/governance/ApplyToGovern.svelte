<script lang="ts">
	/**
	 * "Apply to look after this" — the way somebody who is not staff earns the right to curate.
	 *
	 * Shown on a material once there is something to look after. It says the queue is first come,
	 * first served AND that there is no way to jump it, because the honest version of "transparent
	 * queue tracking" is telling people the position is real rather than implying it is negotiable.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import { applyToGovern, getMyApplications } from '$lib/services/governorApplications';
	import type { GovernorApplication, GovernorNodeKind } from '$lib/types/governorApplication';
	import { ApiError } from '$lib/api/client';

	let {
		kind,
		nodeRef,
		nodeLabel,
		alreadyCurates = false
	}: {
		kind: GovernorNodeKind;
		nodeRef: string;
		nodeLabel: string;
		alreadyCurates?: boolean;
	} = $props();

	let open = $state(false);
	let statement = $state('');
	let busy = $state(false);
	let error = $state('');
	let existing = $state<GovernorApplication | undefined>(undefined);
	let loadedFor = $state('');

	$effect(() => {
		const key = `${kind}:${nodeRef}:${authStore.isAuthenticated}`;
		if (key === loadedFor) return;
		loadedFor = key;
		existing = undefined;
		if (!authStore.isAuthenticated) return;
		void (async () => {
			const mine = await getMyApplications().catch(() => []);
			existing = mine.find(
				(row) => row.kind === kind && row.nodeRef === nodeRef && row.status !== 'withdrawn'
			);
		})();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			existing = await applyToGovern(kind, nodeRef, statement.trim());
			open = false;
			statement = '';
		} catch (e) {
			// The API answers with `{statement: [...]}` for a too-short application and
			// `{detail: [...]}` for "you already applied" / "you already look after this" — both are
			// worth showing verbatim, since each names something the person can act on.
			const body =
				e instanceof ApiError
					? ((e.body as { detail?: string[]; statement?: string[] } | undefined) ?? {})
					: {};
			error = body.statement?.[0] ?? body.detail?.[0] ?? m.govapp_error_generic();
		} finally {
			busy = false;
		}
	}
</script>

{#if authStore.isAuthenticated}
	<div class="govapp">
		{#if alreadyCurates}
			<p class="govapp__state">{m.govapp_alreadyCurate()}</p>
		{:else if existing?.status === 'pending'}
			<p class="govapp__state">
				{m.govapp_status_pending()}
				{#if existing.queuePosition !== null}
					— {m.govapp_position({ position: existing.queuePosition })}
				{/if}
			</p>
			<p class="govapp__note">{m.govapp_noPriority()}</p>
		{:else if existing?.status === 'declined'}
			<p class="govapp__state">{m.govapp_status_declined()}</p>
			{#if existing.decisionNote}
				<p class="govapp__note">{existing.decisionNote}</p>
			{/if}
		{:else if existing?.status === 'approved'}
			<p class="govapp__state">{m.govapp_status_approved()}</p>
		{:else}
			<button type="button" class="govapp__trigger" onclick={() => (open = true)}>
				{m.govapp_apply()}
			</button>
		{/if}
	</div>
{/if}

{#if open}
	<ModalShell title={m.govapp_applyHeading({ name: nodeLabel })} onClose={() => (open = false)}>
		<form class="govapp-form" onsubmit={submit}>
			<p class="govapp-form__explain">{m.govapp_explain()}</p>
			<label class="field">
				<span>{m.govapp_statementLabel()}</span>
				<textarea rows="5" maxlength="4000" bind:value={statement} required></textarea>
			</label>
			<p class="govapp-form__explain">{m.govapp_noPriority()}</p>
			{#if error}
				<p class="govapp-form__error">{error}</p>
			{/if}
			<button
				type="submit"
				class="govapp-form__submit"
				disabled={busy || statement.trim().length < 20}
			>
				{busy ? m.common_loading() : m.govapp_submit()}
			</button>
		</form>
	</ModalShell>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.govapp {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.govapp__state {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.govapp__note {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.govapp__trigger {
		@include mix.button-secondary;
		align-self: flex-start;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
	}
	.govapp-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.govapp-form__explain {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.govapp-form__error {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--status-danger-text, #b3261e);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		textarea {
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.govapp-form__submit {
		@include mix.button-primary;
		align-self: flex-start;
		min-height: 44px;
		padding: var(--space-2) var(--space-4);
	}
</style>
