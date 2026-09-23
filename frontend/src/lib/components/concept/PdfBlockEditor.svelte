<script lang="ts">
	/**
	 * A PDF block: pick a file, and it is uploaded straight away through `/concept-assets/`, where
	 * it is sniffed, size-capped and scanned (house rule 7 — what cannot be re-encoded gets the
	 * sniff and the scan). What comes back is a `ConceptAsset` id; the bytes that were uploaded are
	 * never what gets stored.
	 *
	 * The preview mounts `PdfViewer` only on the button, and `PdfViewer` imports pdf.js itself
	 * dynamically — so adding a PDF to an article costs nothing until somebody looks at it.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { uploadConceptAsset } from '$lib/services/concepts';
	import type { ConceptPdfBlock } from '$lib/types/concept';
	import { formatBytes, messageForError } from './labels';

	let { block }: { block: ConceptPdfBlock } = $props();

	/** Same cap the comment attachment picker states. The real check is server-side either way. */
	const MAX_BYTES = 5 * 1024 * 1024;

	let busy = $state(false);
	let error = $state('');
	let showPreview = $state(false);

	async function pick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		error = '';
		if (file.size > MAX_BYTES) {
			error = m.concept_file_tooBig(); // "That file is bigger than 5 MB."
			return;
		}
		busy = true;
		try {
			const asset = await uploadConceptAsset(file);
			block.assetId = asset.id;
			block.asset = {
				url: asset.url,
				originalName: asset.originalName,
				sizeBytes: asset.sizeBytes,
				width: asset.width,
				height: asset.height
			};
			showPreview = false;
		} catch (e) {
			error = messageForError(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="pdf-block">
	<label class="field">
		<span>{m.concept_pdf_field()}</span>
		<!-- "PDF" -->
		<input type="file" accept="application/pdf" disabled={busy} onchange={pick} />
		<span class="hint">{m.concept_pdf_hint()}</span>
		<!-- "A PDF, up to 5 MB." -->
	</label>

	{#if busy}
		<p class="hint">{m.concept_uploading()}</p>
		<!-- "Uploading…" -->
	{/if}
	{#if error}<p class="error">{error}</p>{/if}

	{#if block.asset?.url}
		{@const url = block.asset.url}
		<div class="picked">
			<span class="picked__name">{block.asset.originalName || m.concept_block_pdf()}</span>
			{#if block.asset.sizeBytes}
				<span class="hint">{formatBytes(block.asset.sizeBytes)}</span>
			{/if}
			<button type="button" class="ghost" onclick={() => (showPreview = !showPreview)}>
				{showPreview ? m.entry_hidePreview() : m.entry_showPreview()}
				<!-- "Hide preview" / "Show preview" -->
			</button>
		</div>
		{#if showPreview}
			{#await import('$lib/components/material/PdfViewer.svelte') then { default: PdfViewer }}
				<PdfViewer {url} />
			{/await}
		{/if}
	{/if}

	<label class="field">
		<span>{m.concept_caption()} <em>({m.common_optional()})</em></span>
		<!-- "Caption" / "optional" -->
		<input
			type="text"
			maxlength="300"
			bind:value={() => block.caption, (v) => (block.caption = v)}
		/>
	</label>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.pdf-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);

		input[type='text'] {
			@include mix.focus-ring;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.picked {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-sm);
	}
	.picked__name {
		font-weight: 600;
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.ghost {
		@include mix.button-secondary;
		min-height: 32px;
		padding: 0 var(--space-2);
		font-size: var(--font-size-xs);
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin: 0;
		align-self: flex-start;
		white-space: normal;
	}
</style>
