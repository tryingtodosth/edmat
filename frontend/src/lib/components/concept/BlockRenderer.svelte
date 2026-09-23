<script lang="ts">
	/**
	 * An article's content: its ordered blocks, drawn one after another.
	 *
	 * Each kind is rendered by whatever this app already uses for that kind of thing, and nothing
	 * here is a second rendering pipeline — a `markdown` block goes through `MathContent` exactly
	 * like an exercise statement, so `[[mentions]]`, inline maths, inline pictures and inline
	 * chemistry all behave the same way they do everywhere else.
	 *
	 * A `latex` block is wrapped in `\[ … \]` here rather than stored that way: the source is
	 * stored raw (`blocks.py`), which is what makes it impossible for a formula to carry HTML.
	 *
	 * The PDF preview is the material page's precedent: `PdfViewer` (and the ~420 KB of pdf.js
	 * behind it) is imported dynamically AND only mounted once the reader presses the button, so an
	 * article with a PDF in it costs nothing to read until somebody wants to look at the PDF (root
	 * CLAUDE.md house rule 11).
	 */
	import { SvelteSet } from 'svelte/reactivity';
	import { m } from '$lib/paraglide/messages.js';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import type { ConceptBlock } from '$lib/types/concept';
	import { formatBytes } from './labels';

	let { blocks }: { blocks: ConceptBlock[] } = $props();

	// A plain `Set` in `$state` is the `svelte/prefer-svelte-reactivity` trap (frontend/CLAUDE.md
	// trap 7) — mutating one does not notify anybody.
	const openPreviews = new SvelteSet<number>();

	function togglePreview(index: number) {
		if (openPreviews.has(index)) openPreviews.delete(index);
		else openPreviews.add(index);
	}
</script>

<div class="blocks">
	{#each blocks as block, index (index)}
		{#if block.kind === 'markdown'}
			<MathContent source={block.body} />
		{:else if block.kind === 'latex'}
			<MathContent source={`\\[${block.source}\\]`} />
		{:else if block.kind === 'chem'}
			<figure class="block-figure">
				{#if block.drawing?.imageUrl}
					<img
						class="chem-drawing"
						src={block.drawing.imageUrl}
						alt={block.drawing.label || block.caption}
						width={block.drawing.width || undefined}
						height={block.drawing.height || undefined}
						loading="lazy"
					/>
				{/if}
				{#if block.caption}<figcaption>{block.caption}</figcaption>{/if}
			</figure>
		{:else if block.kind === 'image'}
			<figure class="block-figure">
				{#if block.asset?.url}
					<img
						src={block.asset.url}
						alt={block.alt}
						width={block.asset.width || undefined}
						height={block.asset.height || undefined}
						loading="lazy"
					/>
				{/if}
				{#if block.caption}<figcaption>{block.caption}</figcaption>{/if}
			</figure>
		{:else if block.kind === 'pdf'}
			<div class="pdf">
				<div class="pdf__row">
					<span class="pdf__name">{block.asset?.originalName || m.concept_block_pdf()}</span>
					<!-- "PDF" -->
					{#if block.asset?.sizeBytes}
						<span class="pdf__size">{formatBytes(block.asset.sizeBytes)}</span>
					{/if}
					{#if block.asset?.url}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- our own media server, not an app route -->
						<a href={block.asset.url} download>{m.concept_pdf_download()}</a>
						<!-- "Download" -->
						<button type="button" onclick={() => togglePreview(index)}>
							{openPreviews.has(index) ? m.entry_hidePreview() : m.entry_showPreview()}
							<!-- "Hide preview" / "Show preview" -->
						</button>
					{/if}
				</div>
				{#if block.caption}<p class="pdf__caption">{block.caption}</p>{/if}
				{#if openPreviews.has(index) && block.asset?.url}
					{@const url = block.asset.url}
					{#await import('$lib/components/material/PdfViewer.svelte') then { default: PdfViewer }}
						<PdfViewer {url} />
					{/await}
				{/if}
			</div>
		{/if}
	{/each}
</div>

<style lang="scss">
	.blocks {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.block-figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		align-items: flex-start;

		img {
			max-width: 100%;
			height: auto;
			border-radius: var(--radius-sm);
		}
		// A chemistry drawing sits on white so its black bond lines read in the dark theme too —
		// the same treatment `MathContent` gives an inline one.
		img.chem-drawing {
			background: #fff;
			padding: 4px;
		}
		figcaption {
			font-size: var(--font-size-xs);
			color: var(--text-secondary);
		}
	}
	.pdf {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
	}
	.pdf__row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-sm);
	}
	.pdf__name {
		font-weight: 600;
	}
	.pdf__size,
	.pdf__caption {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		margin: 0;
	}
	.pdf a {
		color: var(--accent);
	}
	.pdf button {
		min-height: 32px;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: var(--font-size-xs);
		cursor: pointer;
	}
</style>
