<script lang="ts">
	/** "Who else may reuse this?" — the licence choice every create form for licensed content
	 * carries (backend `licensing/`, 2026-10-14): `/submit`, the material submit form, a hint or
	 * solution, a concept article.
	 *
	 * Radio cards rather than a select, because the summary IS the decision: "CC BY-NC-SA 4.0" means
	 * nothing to most people choosing it, and a select hides every summary but the chosen one.
	 * Defaults to `edmat-only` — nothing is opened without the author choosing it. `unknown` is
	 * never offered (`SELECTABLE_LICENCES`). `compact` folds the list behind a disclosure for the
	 * hint/solution composer, where the form is small and most people keep the default. */
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
		compact = false
	}: { value: Licence; name?: string; compact?: boolean } = $props();

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
	<div class="licence-picker__options" role="radiogroup" aria-label={m.licence_field_label()}>
		{#each SELECTABLE_LICENCES as licence (licence)}
			<label class="licence-option" class:licence-option--chosen={value === licence}>
				<input type="radio" {name} value={licence} bind:group={value} />
				<span class="licence-option__text">
					<span class="licence-option__name">
						<strong>{licenceShort(licence)}</strong>
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
	<p class="licence-picker__default">{m.licence_pickerDefaultNote()}</p>
	<!-- "If you are not sure, keep “EdMat only” …" -->
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
