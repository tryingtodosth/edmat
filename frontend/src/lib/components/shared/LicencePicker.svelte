<script lang="ts">
	/** "Who else may reuse this?" — the licence choice every create form for licensed content
	 * carries (backend `licensing/`, 2026-10-14): `/submit`, the material submit form, a hint or
	 * solution, a concept article.
	 *
	 * Radio cards rather than a select, because the summary IS the decision: "CC BY-NC-SA 4.0" means
	 * nothing to most people choosing it, and a select hides every summary but the chosen one.
	 * Defaults to `edmat-only` — nothing is opened without the author choosing it. `unknown` is
	 * never offered (`SELECTABLE_LICENCES`). `compact` folds the list behind a disclosure for the
	 * hint/solution composer, where the form is small and most people keep the default.
	 *
	 * **A suggestion, not a default** (owner, 2026-10-14: "for exercises without a source and
	 * materials created from scratch on edmat CC-BY should be suggested"). The parent passes
	 * `suggested` — what this particular piece of work looks like it should be — and `reason`, which
	 * line explains it. Until the author touches the list, the selection FOLLOWS the suggestion (so
	 * naming a source mid-form moves it back to "EdMat only"); after a click it is theirs and never
	 * moves again. The server default stays `edmat-only`: a client that sends nothing opens
	 * nothing — the suggestion exists only where a person can see it. */
	import type { Licence } from '$lib/types/licence';
	import {
		LICENCE_FACTS,
		LICENCE_NAMES,
		LICENCE_SUMMARIES,
		SELECTABLE_LICENCES,
		licenceShort
	} from '$lib/utils/labels';
	import { getLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';

	let {
		value = $bindable('edmat-only'),
		name = 'licence',
		compact = false,
		suggested = undefined,
		reason = undefined
	}: {
		value: Licence;
		name?: string;
		compact?: boolean;
		/** What the form suggests for this work; followed until the author picks. */
		suggested?: Licence;
		/** Why: their own work (`own`), it names a source (`source`), or it is a file or a link
		 *  rather than something written here (`notFromScratch`). */
		reason?: 'own' | 'source' | 'notFromScratch';
	} = $props();

	// Set by the author's own click, never by the suggestion. Reading it here and writing `value`
	// (which this effect never reads) is what keeps it from re-running itself (frontend trap 4).
	let touched = $state(false);
	$effect(() => {
		if (!touched && suggested) value = suggested;
	});

	function legalCode(licence: Licence): string {
		const facts = LICENCE_FACTS[licence];
		return getLocale() === 'pl' && facts.legalcodePl ? facts.legalcodePl : facts.legalcodeEn;
	}

	function deed(licence: Licence): string {
		const facts = LICENCE_FACTS[licence];
		return facts.deedUrl ? `${facts.deedUrl}deed.${getLocale()}` : '';
	}
</script>

{#snippet options()}
	<p class="licence-picker__hint">{m.licence_pickerHint()}</p>
	<!-- "Who else may reuse what you publish here? …" -->
	{#if reason === 'own'}
		<p class="licence-picker__why" data-testid="licence-why">{m.licence_suggestOwn()}</p>
		<!-- "Suggested: CC BY 4.0, because this is your own work written on EdMat …" -->
	{:else if reason === 'source'}
		<p class="licence-picker__why" data-testid="licence-why">{m.licence_suggestSource()}</p>
		<!-- "It names a source, so it may be somebody else’s work …" -->
	{:else if reason === 'notFromScratch'}
		<p class="licence-picker__why" data-testid="licence-why">{m.licence_suggestNotFromScratch()}</p>
		<!-- "A file or a link may be somebody else’s work …" -->
	{/if}
	<div class="licence-picker__options" role="radiogroup" aria-label={m.licence_field_label()}>
		{#each SELECTABLE_LICENCES as licence (licence)}
			<label class="licence-option" class:licence-option--chosen={value === licence}>
				<input
					type="radio"
					{name}
					value={licence}
					bind:group={value}
					onchange={() => (touched = true)}
				/>
				<span class="licence-option__text">
					<span class="licence-option__name">
						<strong>{licenceShort(licence)}</strong>
						{#if suggested === licence && suggested !== 'edmat-only'}
							<span class="licence-option__suggested" data-testid="licence-suggested"
								>{m.licence_suggestedTag()}</span
							>
							<!-- "Suggested" -->
						{/if}
						{#if LICENCE_FACTS[licence].code}
							<span class="licence-option__full">{LICENCE_NAMES[licence]()}</span>
						{/if}
					</span>
					<span class="licence-option__summary">{LICENCE_SUMMARIES[licence]()}</span>
					{#if deed(licence)}
						<!-- eslint-disable svelte/no-navigation-without-resolve -- creativecommons.org, not an app route -->
						<span class="licence-option__links">
							<a href={deed(licence)} target="_blank" rel="noopener noreferrer"
								>{m.licence_readDeed()}</a
							>
							<!-- "What it means" -->
							<a href={legalCode(licence)} target="_blank" rel="noopener noreferrer"
								>{m.licence_legalCode()}</a
							>
							<!-- "Legal code" -->
						</span>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
				</span>
			</label>
		{/each}
	</div>
	{#if reason !== 'own'}
		<p class="licence-picker__default">{m.licence_pickerDefaultNote()}</p>
		<!-- "If you are not sure, keep “EdMat only” …" -->
	{/if}
{/snippet}

<fieldset class="licence-picker" data-testid="licence-picker">
	{#if compact}
		<details>
			<summary>
				{m.licence_field_label()}: <strong>{licenceShort(value)}</strong>
				<!-- "Licence" -->
			</summary>
			{@render options()}
		</details>
	{:else}
		<legend>{m.licence_field_label()}</legend>
		<!-- "Licence" -->
		{@render options()}
	{/if}
</fieldset>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.licence-picker {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem;
		margin: 0;
		min-width: 0;
	}

	legend {
		font-weight: 600;
		padding: 0 0.25rem;
	}

	summary {
		cursor: pointer;
	}

	.licence-picker__hint,
	.licence-picker__default {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		margin: 0.25rem 0 0.5rem;
	}

	.licence-picker__why {
		font-size: var(--font-size-sm);
		margin: 0 0 0.5rem;
	}

	.licence-option__suggested {
		@include mix.neutral-pill;
		font-size: var(--font-size-xs);
	}

	.licence-picker__options {
		display: grid;
		gap: 0.5rem;
	}

	.licence-option {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		cursor: pointer;
		min-width: 0;

		input {
			margin-top: 0.25rem;
			flex: none;
		}
	}

	.licence-option--chosen {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.licence-option__text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.licence-option__name {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: baseline;
	}

	.licence-option__full,
	.licence-option__summary {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	.licence-option__summary {
		color: var(--text-primary);
	}

	.licence-option__links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: var(--font-size-sm);
	}
</style>
