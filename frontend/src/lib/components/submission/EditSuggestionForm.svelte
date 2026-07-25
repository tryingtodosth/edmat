<script lang="ts">
	import { untrack } from 'svelte';
	import type { EditableField } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';

	let {
		currentValues,
		onSubmit,
		onCancel
	}: {
		currentValues: Record<EditableField, string>;
		onSubmit: (field: EditableField, proposedValue: string, reason: string) => void;
		onCancel: () => void;
	} = $props();

	const fields: EditableField[] = ['title', 'statement', 'hint', 'answer', 'solution'];
	const fieldLabels: Record<EditableField, () => string> = {
		title: m.editSuggestion_field_title,
		statement: m.editSuggestion_field_statement,
		hint: m.editSuggestion_field_hint,
		answer: m.editSuggestion_field_answer,
		solution: m.editSuggestion_field_solution
	};

	let field = $state<EditableField>('statement');
	// Deliberate one-time read of the prop, not a live sync — the form pre-fills once, then the
	// user edits freely without the field snapping back if currentValues ever changed underneath it.
	let proposedValue = $state(untrack(() => currentValues.statement));
	let reason = $state('');

	function onFieldChange(e: Event) {
		field = (e.target as HTMLSelectElement).value as EditableField;
		proposedValue = currentValues[field];
	}

	function submit() {
		if (!proposedValue.trim()) return;
		onSubmit(field, proposedValue, reason);
	}
</script>

<form class="edit-suggestion-form" onsubmit={(e) => (e.preventDefault(), submit())}>
	<h3>{m.editSuggestion_heading()}</h3>

	<label class="field">
		<span>{m.editSuggestion_field()}</span>
		<select value={field} onchange={onFieldChange}>
			{#each fields as f (f)}
				<option value={f}>{fieldLabels[f]()}</option>
			{/each}
		</select>
	</label>

	<label class="field">
		<span>{m.editSuggestion_proposedValue()}</span>
		<textarea rows="4" bind:value={proposedValue}></textarea>
	</label>

	<label class="field">
		<span>{m.editSuggestion_reason()}</span>
		<textarea rows="2" bind:value={reason}></textarea>
	</label>

	<div class="edit-suggestion-form__actions">
		<button type="button" class="cancel" onclick={onCancel}>{m.common_cancel()}</button>
		<button type="submit" class="submit">{m.editSuggestion_submit()}</button>
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.edit-suggestion-form {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h3 {
		font-size: var(--font-size-base);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	select,
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
		resize: vertical;
	}
	.edit-suggestion-form__actions {
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
