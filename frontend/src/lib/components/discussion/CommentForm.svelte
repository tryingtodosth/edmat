<script lang="ts">
	import RichEditor from '$lib/components/editor/RichEditor.svelte';
	import InsertStrip from '$lib/components/editor/InsertStrip.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let {
		placeholder,
		submitLabel,
		onSubmit,
		onCancel,
		// Offer the picture/PDF picker (AUDIENCE-BRIEF.md §6). Off for edits, where there is no new
		// comment to attach to.
		allowFiles = false,
		// Prefilled when this form is editing something that already exists rather than composing
		// something new — an edit box that starts empty is one that quietly invites you to retype
		// what you already wrote.
		initialBody = ''
	}: {
		placeholder: string;
		submitLabel: string;
		onSubmit: (body: string, files?: File[]) => void;
		onCancel?: () => void;
		initialBody?: string;
		allowFiles?: boolean;
	} = $props();

	let files = $state<File[]>([]);
	let fileError = $state('');
	const MAX_FILES = 3;
	const MAX_BYTES = 5 * 1024 * 1024;
	// The picker itself lives on the insert strip (PDF and Picture are two of its seven kinds);
	// the list, the size cap and the limit of three stay here, where the upload happens.
	function addFiles(chosen: File[]) {
		fileError = '';
		if (chosen.some((f) => f.size > MAX_BYTES)) fileError = m.comment_fileTooBig();
		files = [...files, ...chosen.filter((f) => f.size <= MAX_BYTES)].slice(0, MAX_FILES);
	}
	let editorRef = $state<RichEditor | null>(null);
	let strip = $state<InsertStrip | null>(null);

	// Seeded once, deliberately: an edit box is mounted fresh each time editing starts, so what is
	// wanted here is the value at that moment and not a live link back to the prop — which would
	// overwrite whatever the person had typed if the prop ever changed underneath them.
	// svelte-ignore state_referenced_locally
	let body = $state(initialBody);

	function submit() {
		const trimmed = body.trim();
		if (!trimmed) return;
		onSubmit(trimmed, files);
		body = '';
		files = [];
	}
</script>

<form class="comment-form" onsubmit={(e) => (e.preventDefault(), submit())}>
	<RichEditor
		bind:this={editorRef}
		bind:value={body}
		{placeholder}
		rows={2}
		onChemEdit={(id) => strip?.editChem(id)}
	/>
	<InsertStrip
		bind:this={strip}
		editor={editorRef}
		allowFiles={allowFiles && files.length < MAX_FILES}
		onFiles={addFiles}
	/>
	{#if allowFiles && (files.length > 0 || fileError)}
		<div class="comment-form__files">
			{#each files as f, i (i)}
				<span class="file-chip"
					>{f.name}<button
						type="button"
						aria-label={m.common_remove()}
						onclick={() => (files = files.filter((_, j) => j !== i))}>×</button
					></span
				>
			{/each}
			{#if fileError}<span class="file-error">{fileError}</span>{/if}
		</div>
	{/if}
	<div class="comment-form__actions">
		{#if onCancel}
			<button type="button" class="cancel" onclick={onCancel}>{m.common_cancel()}</button>
		{/if}
		<button type="submit" class="submit" disabled={!body.trim()}>{submitLabel}</button>
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.comment-form__files {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
		margin: 0.3rem 0;
		font-size: 0.85rem;
	}
	.file-chip {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--bg-surface-alt);
	}
	.file-chip button {
		border: 0;
		background: none;
		cursor: pointer;
		color: var(--text-secondary);
	}
	.file-error {
		color: var(--status-danger);
	}

	.comment-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.comment-form__actions {
		display: flex;
		gap: var(--space-2);
	}
	.submit {
		@include mix.button-primary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
	.cancel {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
</style>
