<script lang="ts">
	import { untrack } from 'svelte';
	import type { TranslationDraft } from '$lib/services/translations';
	import { m } from '$lib/paraglide/messages.js';

	let {
		sourceValues,
		onSubmit,
		onCancel
	}: {
		sourceValues: Omit<TranslationDraft, 'locale'>;
		onSubmit: (draft: TranslationDraft) => void;
		onCancel: () => void;
	} = $props();

	// Deliberate one-time read of the props (see EditSuggestionForm's identical note) — a real,
	// editable scaffold the translator then edits freely, not a live mirror of the source.
	let locale = $state('');
	let title = $state(untrack(() => sourceValues.title));
	let statement = $state(untrack(() => sourceValues.statement));
	let answer = $state(untrack(() => sourceValues.answer));

	function submit() {
		if (!locale.trim() || !title.trim() || !statement.trim()) return;
		// hint/solution are deliberately absent: a solution rendered into another language is a NEW
		// entry in the pool ("Add a solution" on the exercise page), not part of a translation.
		onSubmit({ locale: locale.trim().toLowerCase(), title, statement, answer });
	}
</script>

<form class="translate-form" onsubmit={(e) => (e.preventDefault(), submit())}>
	<h3>{m.translate_heading()}</h3>
	<p class="hint">{m.translate_subtitle()}</p>
	<p class="hint">{m.translate_prefillNote()}</p>

	<label class="field">
		<span>{m.translate_field_locale()}</span>
		<input type="text" maxlength="8" bind:value={locale} required />
	</label>
	<label class="field">
		<span>{m.submit_field_title()}</span>
		<input type="text" bind:value={title} required />
	</label>
	<label class="field">
		<span>{m.exercise_statement()}</span>
		<textarea rows="4" bind:value={statement} required></textarea>
	</label>
	<label class="field">
		<span>{m.exercise_answer()}</span>
		<textarea rows="2" bind:value={answer}></textarea>
	</label>
	<p class="hint">{m.translate_solutionsNote()}</p>

	<div class="translate-form__actions">
		<button type="button" class="cancel" onclick={onCancel}>{m.common_cancel()}</button>
		<button type="submit" class="submit">{m.translate_submit()}</button>
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.translate-form {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h3 {
		font-size: var(--font-size-base);
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	input,
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
		resize: vertical;
	}
	.translate-form__actions {
		display: flex;
		gap: var(--space-2);
	}
	.submit {
		@include mix.button-primary;
	}
	.cancel {
		@include mix.button-secondary;
	}
</style>
