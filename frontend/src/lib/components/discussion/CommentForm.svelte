<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	let {
		placeholder,
		submitLabel,
		onSubmit,
		onCancel,
		// Prefilled when this form is editing something that already exists rather than composing
		// something new — an edit box that starts empty is one that quietly invites you to retype
		// what you already wrote.
		initialBody = ''
	}: {
		placeholder: string;
		submitLabel: string;
		onSubmit: (body: string) => void;
		onCancel?: () => void;
		initialBody?: string;
	} = $props();

	// Seeded once, deliberately: an edit box is mounted fresh each time editing starts, so what is
	// wanted here is the value at that moment and not a live link back to the prop — which would
	// overwrite whatever the person had typed if the prop ever changed underneath them.
	// svelte-ignore state_referenced_locally
	let body = $state(initialBody);

	function submit() {
		const trimmed = body.trim();
		if (!trimmed) return;
		onSubmit(trimmed);
		body = '';
	}
</script>

<form class="comment-form" onsubmit={(e) => (e.preventDefault(), submit())}>
	<textarea rows="2" {placeholder} bind:value={body}></textarea>
	<div class="comment-form__actions">
		{#if onCancel}
			<button type="button" class="cancel" onclick={onCancel}>{m.common_cancel()}</button>
		{/if}
		<button type="submit" class="submit" disabled={!body.trim()}>{submitLabel}</button>
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

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
