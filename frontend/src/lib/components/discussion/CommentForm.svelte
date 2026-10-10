<script lang="ts">
	import { tick } from 'svelte';
	import type { Snippet } from 'svelte';
	import RichEditor from '$lib/components/editor/RichEditor.svelte';
	import InsertStrip from '$lib/components/editor/InsertStrip.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let {
		placeholder,
		submitLabel,
		onSubmit,
		onCancel,
		// Offer the PDF picker (AUDIENCE-BRIEF.md §6). Off for edits, where there is no new comment
		// to attach to. Pictures are NOT behind this any more: they are uploaded by the insert
		// strip and go into the body itself, so they work in an edit box too.
		allowFiles = false,
		// Prefilled when this form is editing something that already exists rather than composing
		// something new — an edit box that starts empty is one that quietly invites you to retype
		// what you already wrote.
		initialBody = '',
		// Given a label, the box itself is NOT on the page until somebody asks for it: one quiet
		// button carrying this label stands in its place, and the box comes back after posting
		// (owner, 2026-10-09: *"i want inputs of comments to be disappearing unless clicking
		// comment or reply buttons"*). The collapse lives here rather than in each host because
		// this is the component that owns the input — a host that renders a composer gets the
		// behaviour by passing one prop, and the reply and edit boxes, which are already mounted
		// by a button, pass nothing and are unchanged.
		collapsedLabel = undefined,
		// Bound by a host that has its own path to the composer: the "Reply" item on a statement,
		// a solution or a review opens the thread, and it has to open the box too, or the reader
		// who chose "reply" lands on a button that says "write a comment".
		composing = $bindable(false),
		// Drawn inside the form, above the editor, only while the box is open — the standing-page
		// composer's "your name (optional)" field, which is part of the input and must disappear
		// with it rather than sitting there alone over a button.
		aboveEditor = undefined
	}: {
		placeholder: string;
		submitLabel: string;
		onSubmit: (body: string, files?: File[]) => void;
		onCancel?: () => void;
		initialBody?: string;
		allowFiles?: boolean;
		collapsedLabel?: string;
		composing?: boolean;
		aboveEditor?: Snippet;
	} = $props();

	let files = $state<File[]>([]);
	let fileError = $state('');
	const MAX_FILES = 3;
	const MAX_BYTES = 5 * 1024 * 1024;
	// The picker itself lives on the insert strip; the list, the size cap and the limit of three
	// stay here, where the upload happens. Documents only now — a picture goes into the body
	// through `/inline-images/` instead of into this row, so the two things a reader sees are the
	// text (with its pictures in it) and a short list of papers hanging off the bottom.
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
		// Back to the quiet button, so a posted comment leaves the page it is now part of looking
		// the way it did before — a composer that stays open after a post reads as if the post had
		// not gone through.
		if (collapsedLabel) composing = false;
	}

	async function reveal() {
		composing = true;
		// `tick()` and not a microtask: the editor does not exist until Svelte has flushed this
		// reveal, and `RichEditor.focus()` itself holds the request if its lazy Tiptap import is
		// still in flight.
		await tick();
		editorRef?.focus();
	}

	// A collapsible composer always has a way back to its button; a reply or an edit box uses the
	// host's own cancel, which unmounts it.
	const cancel = $derived(onCancel ?? (collapsedLabel ? () => (composing = false) : undefined));
</script>

{#if collapsedLabel && !composing}
	<button type="button" class="comment-form__open" onclick={reveal}>{collapsedLabel}</button>
{:else}
	<form class="comment-form" onsubmit={(e) => (e.preventDefault(), submit())}>
		{#if aboveEditor}{@render aboveEditor()}{/if}
		<RichEditor
			bind:this={editorRef}
			bind:value={body}
			{placeholder}
			rows={2}
			onChemEdit={(id) => strip?.editChem(id)}
			onSketchEdit={(id) => strip?.editSketch(id)}
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
			{#if cancel}
				<button type="button" class="cancel" onclick={cancel}>{m.common_cancel()}</button>
			{/if}
			<button type="submit" class="submit" disabled={!body.trim()}>{submitLabel}</button>
		</div>
	</form>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	// `SolutionEntrySection`'s composer draws the same pending-file row with the same two classes
	// (house rule 13: this is strike two, so the pair is flagged in both files rather than
	// extracted). A third one earns a shared component.
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

	// The quiet button that stands in for the box. Plainly a control — a composer nobody can find
	// is worse than one that is always open — but not the page's loudest thing, because the
	// comments above it are what a reader came for.
	.comment-form__open {
		@include mix.button-secondary;
		align-self: flex-start;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
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
