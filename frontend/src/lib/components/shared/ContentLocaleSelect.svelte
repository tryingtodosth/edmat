<script lang="ts">
	// "Which language is this written in?" — one control, for every form that asks.
	//
	// Built on the owner's instruction of 2026-10-08: *"adding it has en language text_input by
	// default even for pl interface (that's default for now btw), lets have a pick choose one from
	// for now"*. Two forms asked for the content language as a **free text box** — adding a hint or
	// a solution (`SolutionEntrySection`) and submitting a translation (`TranslateForm`) — and the
	// first of them seeded that box from the language the EXERCISE was being read in, so a reader
	// with a Polish interface looking at an English rendering got `en` pre-filled for the Polish
	// solution they were about to type. A typo there is a row filed under a language nobody reads.
	//
	// It also replaces three hand-written `<option value="pl">PL</option>` pairs (`/submit`,
	// `/submit-material`, `CatalogueForm`). Five call sites is well past house rule 13's three
	// strikes, and the thing they were duplicating — *which languages may content be in* — is
	// exactly the kind of list that drifts.
	//
	// **"For now" is in the owner's own words and is the honest limit.** A content locale is a free
	// string server-side and the root CLAUDE.md says the content axis is unbounded on purpose; this
	// control offers a bounded list because picking from one is better than typing into nothing. The
	// list is `SUPPORTED_CONTENT_LOCALES` (the interface locales, so a third one appears here the
	// day it is added) plus whatever extra languages this reader has opted into, plus whatever the
	// row is already in — the shape `ArticleEditor` worked out first and this now owns.
	import { SUPPORTED_CONTENT_LOCALES, contentLocalesStore } from '$lib/state/contentLocales.svelte';

	let {
		value = $bindable(),
		/** Languages this row already has, which there is no point offering again — a translation
		 *  into a language the exercise is already published in is not a translation. */
		exclude = [],
		disabled = false,
		id
	}: {
		value: string;
		exclude?: string[];
		disabled?: boolean;
		id?: string;
	} = $props();

	const all = $derived([
		...new Set([...SUPPORTED_CONTENT_LOCALES, ...contentLocalesStore.extras, value].filter(Boolean))
	]);

	// `exclude` narrows the list but may never empty it. An exercise that already has every language
	// this platform offers would otherwise get a select with NO options — which is what happened the
	// first time this was wired into `TranslateForm`, because the test exercise was published in both
	// `pl` and `en`. A re-translation of an existing language is a legitimate pending row anyway (the
	// backend's partial unique constraint only ever allows one PUBLISHED row per locale), so falling
	// back to the whole list is both the safe and the correct answer.
	const narrowed = $derived(
		all.filter((option) => option === value || !exclude.includes(option))
	);
	const options = $derived(narrowed.length > 0 ? narrowed : all);
</script>

<select {id} bind:value {disabled}>
	{#each options as option (option)}
		<option value={option}>{option.toUpperCase()}</option>
	{/each}
</select>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
		font: inherit;
	}
</style>
