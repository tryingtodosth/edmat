<!-- The "Hints" / "Solutions" reveal section of the exercise page — the pool, filtered to one
     kind. Progressive reveal is unchanged pedagogy (nothing renders until asked); once revealed,
     entries in the CURRENT content locale show by default, and everything else sits behind an
     explicit "N more in other languages" action — the owner's "don't overwhelm the main
     interface" call. Adding an entry is right here too, since "I solved it differently" happens
     exactly where you've just read the existing solutions. -->
<script lang="ts">
	import RichEditor from '$lib/components/editor/RichEditor.svelte';
	import InsertStrip from '$lib/components/editor/InsertStrip.svelte';
	import type { SolutionEntry, SolutionEntryKind } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { submitSolutionEntry, uploadEntryAttachment } from '$lib/services/exercises';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import SolutionEntryCard from './SolutionEntryCard.svelte';
	import ContentLocaleSelect from '$lib/components/shared/ContentLocaleSelect.svelte';
	import LicencePicker from '$lib/components/shared/LicencePicker.svelte';
	import type { Licence } from '$lib/types/licence';
	import { getLocale } from '$lib/paraglide/runtime';

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
	// Its own licence (backend licensing/) — `edmat-only` unless the author opens it.
	let composerLicence = $state<Licence>('edmat-only');
	let composerPreview = $state(false);
	let composerBusy = $state(false);
	let composerError = $state<string | null>(null);
	let composerNotice = $state<'published' | 'pending' | null>(null);
	// The insert strip and the editor it inserts into. Everything the strip offers EXCEPT a PDF
	// goes straight into the body — a picture through `/inline-images/`, a chemistry structure
	// through `/chem-drawings/`, a sketch through `/sketches/`, LaTeX as a real maths node. A PDF
	// has nothing to be embedded as, so it is held here and uploaded against the entry once the
	// entry exists, exactly as a comment's attachments are (`DiscussionThread.svelte`).
	let editorRef = $state<RichEditor | null>(null);
	let strip = $state<InsertStrip | null>(null);
	let composerFiles = $state<File[]>([]);
	let fileError = $state('');
	const MAX_ENTRY_FILES = 3; // mirrors MAX_ATTACHMENTS_PER_COMMENT, which the endpoint enforces
	const MAX_ENTRY_FILE_BYTES = 5 * 1024 * 1024; // mirrors MAX_ATTACHMENT_BYTES

	function addFiles(chosen: File[]) {
		fileError = '';
		if (chosen.some((f) => f.size > MAX_ENTRY_FILE_BYTES)) fileError = m.comment_fileTooBig();
		composerFiles = [
			...composerFiles,
			...chosen.filter((f) => f.size <= MAX_ENTRY_FILE_BYTES)
		].slice(0, MAX_ENTRY_FILES);
	}

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
				body: composerBody,
				licence: composerLicence
			});
			// The files go up one at a time against the entry that now exists. A failed upload must
			// NOT lose the entry — the words are the valuable part and they are already saved — so
			// each failure is collected and said out loud instead of throwing the whole submit away.
			const attached = [];
			let failed = 0;
			for (const file of composerFiles) {
				try {
					attached.push(await uploadEntryAttachment(entry.id, file));
				} catch {
					failed += 1;
				}
			}
			onCreated({ ...entry, attachments: [...entry.attachments, ...attached] });
			composerNotice = entry.status === 'published' ? 'published' : 'pending';
			fileError = failed > 0 ? m.entry_attachmentFailed({ count: failed }) : '';
			composerBody = '';
			composerFiles = [];
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
	<section class="content-section content-section--stage">
		<h2>{kind === 'hint' ? m.entry_hintsHeading() : m.entry_solutionsHeading()}</h2>
		<!-- "Hints" / "Solutions" -->
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
						// The INTERFACE language, not `contentLocale` (owner, 2026-10-08). The old
						// default was the language the exercise happened to be being read in, so a
						// reader with a Polish interface looking at the English rendering got `en`
						// pre-filled for the Polish solution they were about to type. What somebody
						// is about to write is far better guessed by the language they are reading
						// the site in — and it is a picker now, so a wrong guess costs one click.
						if (!composerLocale) composerLocale = getLocale();
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
					<ContentLocaleSelect bind:value={composerLocale} />
				</label>
				<RichEditor
					bind:this={editorRef}
					bind:value={composerBody}
					placeholder={m.entry_composerPlaceholder()}
					rows={6}
					onChemEdit={(id) => strip?.editChem(id)}
					onSketchEdit={(id) => strip?.editSketch(id)}
				/>
				<InsertStrip
					bind:this={strip}
					editor={editorRef}
					allowFiles={composerFiles.length < MAX_ENTRY_FILES}
					onFiles={addFiles}
				/>
				<LicencePicker bind:value={composerLicence} name="licence-{kind}" compact />
				{#if composerFiles.length > 0 || fileError}
					<div class="composer__files">
						{#each composerFiles as f, i (i)}
							<span class="file-chip"
								>{f.name}<button
									type="button"
									aria-label={m.common_remove()}
									onclick={() => (composerFiles = composerFiles.filter((_, j) => j !== i))}
									>×</button
								></span
							>
						{/each}
						{#if fileError}<span class="error">{fileError}</span>{/if}
					</div>
				{/if}
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
	// The learning flow's reveal layer — the same block the exercise page's Answer section carries
	// (Svelte scopes styles per component, so the selector name is shared and the rule is copied;
	// two strikes, house rule 13). The heading is the page's own uppercase style, copied for the same
	// reason: without it the hint and solution cards were the only stage cards with no word, and
	// four reviewers read the three cards as two shapes. Hints and solutions get the SAME hue: the
	// word says which. Background stays --bg-surface: never a tint behind MathContent.
	h2 {
		margin: 0;
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.content-section--stage {
		border-left: 3px solid var(--stage);
		h2 {
			color: var(--stage);
		}
		.reveal-toggle {
			border-color: var(--stage);
			color: var(--stage);
		}
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
	// A submitted entry waits for a verdict — pending, not a warning.
	.notice--pending {
		@include mix.pending-pill;
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		// The language row. Its control is `ContentLocaleSelect` since 2026-10-08 and that component
		// styles its own `<select>`, so the `input` rules that used to sit here (a 5rem text box and
		// its border) now match nothing and are gone — `svelte-check`'s unused-selector warning is
		// what said so, and this file is held at zero warnings.
		label {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			font-size: var(--font-size-xs);
			color: var(--text-secondary);
		}
	}
	// The pending-file row, the same shape `CommentForm` draws — three strikes before extracting a
	// shared utility (house rule 13); this is the second, so the two are flagged in each other's
	// comments instead. If a third composer grows one, extract it then.
	.composer__files {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
		margin: 0.3rem 0;
		font-size: 0.85rem;
	}
	.file-chip {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--bg-surface-alt);
	}
	.file-chip button {
		border: 0;
		background: none;
		cursor: pointer;
		color: var(--text-secondary);
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
