<!-- The "Hints" / "Solutions" reveal section of the exercise page — the pool, filtered to one
     kind. Progressive reveal is unchanged pedagogy (nothing renders until asked); once revealed,
     entries in the CURRENT content locale show by default, and everything else sits behind an
     explicit "N more in other languages" action — the owner's "don't overwhelm the main
     interface" call. Adding an entry is right here too, since "I solved it differently" happens
     exactly where you've just read the existing solutions. -->
<script lang="ts">
	import type { SolutionEntry, SolutionEntryKind } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { submitSolutionEntry } from '$lib/services/exercises';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import SolutionEntryCard from './SolutionEntryCard.svelte';

	let {
		kind,
		exerciseId,
		entries,
		contentLocale,
		onUpdated,
		onDeleted,
		onCreated
	}: {
		kind: SolutionEntryKind;
		exerciseId: string;
		entries: SolutionEntry[];
		contentLocale: string;
		onUpdated: (entry: SolutionEntry) => void;
		onDeleted: (id: string) => void;
		onCreated: (entry: SolutionEntry) => void;
	} = $props();

	let revealed = $state(false);
	let showOtherLocales = $state(false);
	let showComposer = $state(false);
	let composerBody = $state('');
	let composerLocale = $state('');
	let composerPreview = $state(false);
	let composerBusy = $state(false);
	let composerError = $state<string | null>(null);
	let composerNotice = $state<'published' | 'pending' | null>(null);

	// The reviewer circle, coarsely — the server is the real gate; this only decides whether the
	// accept/deny affordances render at all (same split every moderation surface here uses).
	let canReview = $derived(
		(authStore.user?.isVerifiedContributor ?? false) || authStore.canModerate
	);

	let localEntries = $derived(entries.filter((e) => e.locale === contentLocale));
	let otherEntries = $derived(entries.filter((e) => e.locale !== contentLocale));
	let shown = $derived(showOtherLocales ? entries : localEntries);
	let publishedCount = $derived(localEntries.filter((e) => e.status === 'published').length);

	function labelShow(): string {
		return kind === 'hint'
			? m.entry_showHints({ count: publishedCount }) // "Show hints ({count})"
			: m.entry_showSolutions({ count: publishedCount }); // "Show solutions ({count})"
	}
	function labelHide(): string {
		return kind === 'hint' ? m.entry_hideHints() : m.entry_hideSolutions(); // "Hide hints" / "Hide solutions"
	}

	async function submitEntry() {
		if (!composerBody.trim() || composerBusy) return;
		composerBusy = true;
		composerError = null;
		try {
			const entry = await submitSolutionEntry(exerciseId, {
				kind,
				locale: (composerLocale || contentLocale).trim(),
				body: composerBody
			});
			onCreated(entry);
			composerNotice = entry.status === 'published' ? 'published' : 'pending';
			composerBody = '';
			showComposer = false;
			revealed = true;
		} catch {
			composerError = m.common_error_generic(); // "Something went wrong."
		} finally {
			composerBusy = false;
		}
	}
</script>

{#if entries.length > 0 || authStore.isAuthenticated}
	<section class="content-section">
		<div class="section-head">
			{#if entries.length > 0}
				<button type="button" class="reveal-toggle" onclick={() => (revealed = !revealed)}>
					{revealed ? labelHide() : labelShow()}
				</button>
			{/if}
			{#if authStore.isAuthenticated}
				<button
					type="button"
					class="add-toggle"
					onclick={() => {
						showComposer = !showComposer;
						composerNotice = null;
						if (!composerLocale) composerLocale = contentLocale;
					}}
				>
					{kind === 'hint' ? m.entry_addHint() : m.entry_addSolution()}
				</button>
			{/if}
		</div>

		{#if composerNotice === 'published'}
			<p class="notice">{m.entry_submittedLive()}</p>
		{:else if composerNotice === 'pending'}
			<p class="notice notice--pending">{m.entry_submittedPending()}</p>
		{/if}

		{#if showComposer}
			<div class="composer">
				<label>
					<span>{m.entry_composerLanguage()}</span>
					<input type="text" bind:value={composerLocale} maxlength="8" />
				</label>
				<textarea rows="6" bind:value={composerBody} placeholder={m.entry_composerPlaceholder()}
				></textarea>
				<div class="composer__actions">
					<button
						type="button"
						class="secondary"
						onclick={() => (composerPreview = !composerPreview)}
						>{composerPreview ? m.entry_hidePreview() : m.entry_showPreview()}</button
					>
					<button type="button" class="primary" disabled={composerBusy} onclick={submitEntry}
						>{m.entry_submit()}</button
					>
				</div>
				{#if composerPreview && composerBody.trim()}
					<div class="composer__preview"><MathContent source={composerBody} /></div>
				{/if}
				{#if composerError}
					<p class="error">{composerError}</p>
				{/if}
			</div>
		{/if}

		{#if revealed}
			<div class="entry-list">
				{#each shown as entry (entry.id)}
					<SolutionEntryCard {entry} {canReview} {onUpdated} {onDeleted} />
				{/each}
				{#if otherEntries.length > 0}
					<button
						type="button"
						class="other-locales"
						onclick={() => (showOtherLocales = !showOtherLocales)}
					>
						{showOtherLocales
							? m.entry_hideOtherLanguages()
							: m.entry_showOtherLanguages({ count: otherEntries.length })}
					</button>
				{/if}
			</div>
		{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.content-section {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.section-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.reveal-toggle {
		@include mix.button-secondary;
		align-self: flex-start;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-3);
	}
	.add-toggle,
	.other-locales {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
	}
	.other-locales {
		align-self: flex-start;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.notice--pending {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		label {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			font-size: var(--font-size-xs);
			color: var(--text-secondary);
			input {
				width: 5rem;
			}
		}
		textarea,
		input {
			font: inherit;
			padding: var(--space-1);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.composer__actions {
		display: flex;
		gap: var(--space-2);
	}
	.primary {
		@include mix.button-primary;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-3);
	}
	.secondary {
		@include mix.button-secondary;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-3);
	}
	.composer__preview {
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}
	.error {
		font-size: var(--font-size-xs);
		color: var(--status-danger);
	}
	.entry-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
</style>
