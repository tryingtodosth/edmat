<script lang="ts">
	import { untrack } from 'svelte';
	import type { TranslationDraft } from '$lib/services/translations';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { SUPPORTED_CONTENT_LOCALES } from '$lib/state/contentLocales.svelte';
	import ContentLocaleSelect from '$lib/components/shared/ContentLocaleSelect.svelte';

	let {
		sourceValues,
		existingLocales = [],
		onSubmit,
		onCancel
	}: {
		sourceValues: Omit<TranslationDraft, 'locale'>;
		/** The languages this exercise is already published in. Offering one of them is offering to
		 *  translate something into the language it is already in, so the picker leaves them out. */
		existingLocales?: string[];
		onSubmit: (draft: TranslationDraft) => void;
		onCancel: () => void;
	} = $props();

	// Deliberate one-time read of the props (see EditSuggestionForm's identical note) — a real,
	// editable scaffold the translator then edits freely, not a live mirror of the source.
	//
	// The language was a free text box until 2026-10-08 (owner: *"lets have a pick choose one
	// from"*). It opens on the reader's own interface language when that is one this exercise does
	// not have yet — you most often translate INTO the language you are reading the site in — and
	// otherwise on the first language it is missing.
	let locale = $state(
		untrack(() => {
			const missing = SUPPORTED_CONTENT_LOCALES.filter((one) => !existingLocales.includes(one));
			const reader = getLocale();
			if (missing.includes(reader)) return reader;
			// Nothing missing — this exercise already has every language on offer. The picker then
			// shows the whole list (see `ContentLocaleSelect`), so this has to land on a real value
			// rather than on `''`, which would have rendered a select with nothing selected.
			return missing[0] ?? reader;
		})
	);
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
		<ContentLocaleSelect bind:value={locale} exclude={existingLocales} />
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
