<script lang="ts">
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
	function pick(e: Event) {
		fileError = '';
		const input = e.currentTarget as HTMLInputElement;
		const chosen = Array.from(input.files ?? []);
		if (chosen.some((f) => f.size > MAX_BYTES)) fileError = m.comment_fileTooBig();
		files = [...files, ...chosen.filter((f) => f.size <= MAX_BYTES)].slice(0, MAX_FILES);
		input.value = '';
	}

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
	<textarea rows="2" {placeholder} bind:value={body}></textarea>
	{#if allowFiles}
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
			{#if files.length < MAX_FILES}
				<label class="attach">
					<input
						type="file"
						accept="image/png,image/jpeg,image/webp,application/pdf"
						multiple
						onchange={pick}
					/>
					<span>{m.comment_attach()}</span>
				</label>
			{/if}
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
	.attach {
		position: relative;
		cursor: pointer;
		color: var(--accent);
		min-height: 36px;
		display: inline-flex;
		align-items: center;
	}
	.attach input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.file-error {
		color: var(--status-danger);
	}

	.comment-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		resize: vertical;
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
