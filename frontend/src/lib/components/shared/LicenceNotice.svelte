<script lang="ts">
	/** The licence line under a work — "© author · Licensed under CC BY-SA 4.0 since …" — and, for
	 * its author, the control that widens it (backend `licensing/`, 2026-10-14).
	 *
	 * Three honest shapes, because they are three different facts:
	 *  - a public licence: the attribution line a reuser has to copy, with the licence linked;
	 *  - `edmat-only`: "all rights reserved by the author", so nobody mistakes it for open content;
	 *  - `unknown`: "rights not yet clarified — shown for study only" (LEGAL.md §3, the corpus).
	 *
	 * The key arrives with the content (`licence`), so the line paints with the page; the reading
	 * (since when, may I change it) is fetched once on mount and only adds to it. */
	import { onMount } from 'svelte';
	import type { Licence, LicenceReading, LicenceTargetKind } from '$lib/types/licence';
	import { changeLicence, getLicence, LicenceChangeError } from '$lib/services/licences';
	import {
		LICENCE_FACTS,
		LICENCE_NAMES,
		LICENCE_SUMMARIES,
		licenceReasonLabel,
		licenceShort
	} from '$lib/utils/labels';
	import { formatDate } from '$lib/utils/datetime';
	import { getLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';

	let {
		kind,
		id,
		licence,
		author = '',
		textLicence = undefined,
		onChanged = undefined
	}: {
		kind: LicenceTargetKind;
		id: string;
		licence: Licence;
		/** The name a reuser credits. Empty for content nobody here wrote. */
		author?: string;
		/** The licence of the text actually shown, when it is somebody else's translation. */
		textLicence?: Licence;
		onChanged?: (licence: Licence) => void;
	} = $props();

	let reading = $state<LicenceReading | null>(null);
	let current = $derived<Licence>(reading?.licence ?? licence);
	let editing = $state(false);
	let choice = $state<Licence | ''>('');
	let note = $state('');
	let error = $state('');
	let saved = $state(false);
	let busy = $state(false);

	onMount(() => {
		getLicence(kind, id)
			.then((r) => (reading = r))
			.catch(() => {
				// The line still paints from `licence`; only "since" and the control are lost.
			});
	});

	function deed(key: Licence): string {
		const url = LICENCE_FACTS[key].deedUrl;
		return url ? `${url}deed.${getLocale()}` : '';
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!choice) return;
		busy = true;
		error = '';
		try {
			reading = await changeLicence(kind, id, choice, note.trim());
			editing = false;
			saved = true;
			note = '';
			onChanged?.(reading.licence);
		} catch (e) {
			error = licenceReasonLabel(e instanceof LicenceChangeError ? e.reason : '');
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="licence-notice licence-notice--{current}"
	data-testid="licence-notice"
	data-licence={current}
>
	{#if current === 'unknown'}
		<p class="licence-notice__line">{m.licence_unknownNotice()}</p>
		<!-- "Rights not yet clarified — shown here for study only. Do not copy it elsewhere." -->
	{:else if current === 'edmat-only'}
		<p class="licence-notice__line">
			{#if author}<span>{m.licence_byAuthor({ author })}</span> ·{/if}
			<!-- "© {author}" -->
			{m.licence_edmatOnlyNotice()}
			<!-- "All rights reserved by the author. Published on EdMat under the terms of use; …" -->
		</p>
	{:else}
		<p class="licence-notice__line">
			{#if author}<span>{m.licence_byAuthor({ author })}</span> ·{/if}
			<!-- "© {author}" -->
			{m.licence_licensedUnder()}
			<!-- "Licensed under" -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -- creativecommons.org, not an app route -->
			<a
				href={deed(current)}
				target="_blank"
				rel="license noopener noreferrer"
				title={LICENCE_NAMES[current]()}>{licenceShort(current)}</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{#if reading?.since}
				<span class="licence-notice__since"
					>{m.licence_since({ date: formatDate(reading.since) })}</span
				>
				<!-- "since {date}" -->
			{/if}
		</p>
		<p class="licence-notice__summary">{LICENCE_SUMMARIES[current]()}</p>
	{/if}
	<!-- Compared with the licence the page LOADED with, not `current`: widening the exercise from
	     here moves its original-language text too (`licensing.rules._carry_to_own_text`), so a
	     difference that appears only after a change is not a translation's. -->
	{#if textLicence && textLicence !== licence}
		<p class="licence-notice__summary">
			{m.licence_translationNotice({ licence: licenceShort(textLicence) })}
			<!-- "This translation is licensed under {licence}, the licence it was written under." -->
		</p>
	{/if}

	{#if saved}
		<p class="licence-notice__saved" role="status">{m.licence_changed()}</p>
		<!-- "Licence updated." -->
	{/if}

	{#if reading?.canChange}
		{#if !editing}
			<button
				type="button"
				class="link-button"
				onclick={() => {
					editing = true;
					saved = false;
					choice = reading?.allowed[0] ?? '';
				}}>{m.licence_change()}</button
			>
			<!-- "Change licence" -->
		{:else}
			<form class="licence-notice__form" onsubmit={save}>
				<p class="licence-notice__summary">{m.licence_changeHint()}</p>
				<!-- "A licence can only be made more open. …" -->
				{#if reading.allowed.length === 0}
					<p>{m.licence_noWider()}</p>
					<!-- "You cannot change this licence here." -->
				{:else}
					<label class="field">
						<span>{m.licence_changeChoose()}</span>
						<!-- "New licence" -->
						<select bind:value={choice} data-testid="licence-change-select">
							{#each reading.allowed as key (key)}
								<option value={key}>{licenceShort(key)} — {LICENCE_NAMES[key]()}</option>
							{/each}
						</select>
					</label>
					{#if choice}
						<p class="licence-notice__summary">{LICENCE_SUMMARIES[choice]()}</p>
					{/if}
					<label class="field">
						<span>{m.licence_changeNote()}</span>
						<!-- "Reason (a staff change needs one)" -->
						<input type="text" bind:value={note} maxlength="500" />
					</label>
				{/if}
				{#if error}<p class="licence-notice__error" role="alert">{error}</p>{/if}
				<div class="licence-notice__actions">
					{#if reading.allowed.length > 0}
						<button type="submit" class="button-primary" disabled={busy || !choice}
							>{m.licence_changeSubmit()}</button
						>
						<!-- "Save licence" -->
					{/if}
					<button type="button" class="link-button" onclick={() => (editing = false)}
						>{m.licence_changeCancel()}</button
					>
					<!-- "Cancel" -->
				</div>
			</form>
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.licence-notice {
		border-top: 1px solid var(--border-color);
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}

	.licence-notice__line,
	.licence-notice__summary {
		margin: 0.15rem 0;
	}

	.licence-notice--unknown .licence-notice__line {
		color: var(--status-warning);
	}

	.licence-notice__saved {
		color: var(--status-success);
		margin: 0.25rem 0;
	}

	.licence-notice__error {
		color: var(--status-danger);
	}

	.licence-notice__form {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.5rem;
		max-width: 40rem;

		select,
		input {
			width: 100%;
			max-width: 100%;
		}
	}

	.licence-notice__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}

	.link-button {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
		font: inherit;
		text-decoration: underline;
	}

	.button-primary {
		@include mix.button-primary;
	}
</style>
