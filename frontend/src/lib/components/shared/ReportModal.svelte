<script lang="ts">
	// The reporting dialog, split out of ReportButton so it can be opened by something other than
	// that one button. It had been welded to its own trigger, which was fine while "report this"
	// was always its own little link — a comment's action menu needs the dialog without the link.
	// ReportButton now renders this too, so there is still exactly one report form in the app.
	import type { ReportKind } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { submitReport } from '$lib/services/reports';
	import ModalShell from './ModalShell.svelte';

	let { kind, objectId, onClose }: { kind: ReportKind; objectId: string; onClose: () => void } =
		$props();

	let reason = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);
	let done = $state(false);

	async function submit() {
		submitting = true;
		error = null;
		try {
			await submitReport(kind, objectId, reason);
			done = true;
		} catch (e) {
			error =
				e instanceof ApiError && e.status === 400
					? m.report_alreadyReported()
					: m.common_error_generic();
		} finally {
			submitting = false;
		}
	}
</script>

<ModalShell title={m.report_modalTitle()} {onClose}>
	{#if done}
		<p class="success">{m.report_thanks()}</p>
		<button type="button" class="close-btn" onclick={onClose}>{m.common_close()}</button>
	{:else}
		<form class="report-form" onsubmit={(e) => (e.preventDefault(), submit())}>
			<p class="intro">{m.report_intro()}</p>
			<label class="field">
				<span class="visually-hidden">{m.report_reasonPlaceholder()}</span>
				<textarea rows="3" placeholder={m.report_reasonPlaceholder()} bind:value={reason}
				></textarea>
			</label>
			{#if error}<p class="error">{error}</p>{/if}
			<div class="actions">
				<button type="button" class="cancel" onclick={onClose}>{m.common_cancel()}</button>
				<button type="submit" class="submit" disabled={submitting}>{m.report_submit()}</button>
			</div>
		</form>
	{/if}
</ModalShell>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.report-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.intro {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.field {
		display: flex;
		flex-direction: column;
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
		resize: vertical;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.success {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.submit {
		@include mix.button-primary;
	}
	.cancel,
	.close-btn {
		@include mix.button-secondary;
	}
</style>
