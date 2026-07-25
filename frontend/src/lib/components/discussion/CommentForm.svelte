<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	let {
		placeholder,
		submitLabel,
		onSubmit,
		onCancel
	}: {
		placeholder: string;
		submitLabel: string;
		onSubmit: (body: string) => void;
		onCancel?: () => void;
	} = $props();

	let body = $state('');

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
