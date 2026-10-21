<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { ExercisePart } from '$lib/types';
	import { partRefusalMessage } from '$lib/utils/labels';

	let {
		currentValues,
		parts = [],
		onSubmit,
		onCancel
	}: {
		currentValues: Record<'title' | 'statement' | 'answer', string>;
		/** The parts of a set-shaped exercise: each adds its statement and answer to the choice
		 *  (`SUBEXERCISES-BRIEF.md` §2 — `field` stays statement|answer, `part` says whose). */
		parts?: ExercisePart[];
		onSubmit: (
			field: 'title' | 'statement' | 'answer',
			proposedValue: string,
			reason: string,
			partId?: string
		) => void | Promise<void>;
		onCancel: () => void;
	} = $props();

	// hint/solution left this form with the solution-pool feature: an edit to one of those targets
	// its own entry, right on the entry's card ("Suggest an edit"), never a translation field.
	const fields = ['title', 'statement', 'answer'] as const;
	const fieldLabels: Record<(typeof fields)[number], () => string> = {
		title: m.editSuggestion_field_title,
		statement: m.editSuggestion_field_statement,
		answer: m.editSuggestion_field_answer
	};

	// The select's value: a shared field ('statement') or a part's ('part:<id>:statement').
	let choice = $state<string>('statement');
	// Deliberate one-time read of the prop, not a live sync — the form pre-fills once, then the
	// user edits freely without the field snapping back if currentValues ever changed underneath it.
	let proposedValue = $state(untrack(() => currentValues.statement));
	let reason = $state('');
	let error = $state('');

	function parseChoice(value: string): {
		field: (typeof fields)[number];
		part?: ExercisePart;
	} {
		const [head, partId, partField] = value.split(':');
		if (head === 'part') {
			return {
				field: partField === 'answer' ? 'answer' : 'statement',
				part: parts.find((p) => p.id === partId)
			};
		}
		return { field: head as (typeof fields)[number] };
	}

	function onFieldChange(e: Event) {
		choice = (e.target as HTMLSelectElement).value;
		const { field, part } = parseChoice(choice);
		proposedValue = part ? part[field === 'answer' ? 'answer' : 'statement'] : currentValues[field];
	}

	async function submit() {
		if (!proposedValue.trim()) return;
		const { field, part } = parseChoice(choice);
		error = '';
		try {
			await onSubmit(field, proposedValue, reason, part?.id);
		} catch (e) {
			error = partRefusalMessage(e) ?? m.common_error_generic(); // "Something went wrong."
		}
	}
</script>

<form class="edit-suggestion-form" onsubmit={(e) => (e.preventDefault(), submit())}>
	<h3>{m.editSuggestion_heading()}</h3>

	<label class="field">
		<span>{m.editSuggestion_field()}</span>
		<select value={choice} onchange={onFieldChange} data-suggest-field>
			{#each fields as f (f)}
				<option value={f}>{fieldLabels[f]()}</option>
			{/each}
			<!-- A part's two texts, each named in full: a closed select shows the option alone, so
			     "Statement" under an optgroup would read exactly like the shared statement. -->
			{#each parts as p (p.id)}
				<option value="part:{p.id}:statement">{m.parts_suggestStatement({ label: p.label })}</option
				>
				<!-- "Part {label} — statement" -->
				<option value="part:{p.id}:answer">{m.parts_suggestAnswer({ label: p.label })}</option>
				<!-- "Part {label} — answer" -->
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

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
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
	.error {
		@include mix.status-message(danger);
	}
	.submit {
		@include mix.button-primary;
	}
	.cancel {
		@include mix.button-secondary;
	}
</style>
