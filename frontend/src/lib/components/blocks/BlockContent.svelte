<script lang="ts">
	/**
	 * A notebook's content — or any plain text given an implicit block id — drawn one block after
	 * another, and, when the host passes `annotate`, open to comments on ONE block or on a passage
	 * selected inside it (owner, 2026-11-04: "for others to be able to attach a comment also to one
	 * of these blocks (maybe be even more specific)").
	 *
	 * Each kind is drawn by whatever this app already uses for that kind of thing; nothing here is a
	 * second rendering pipeline — a paragraph goes through `MathContent` exactly like an exercise
	 * statement, a formula is wrapped in `\[ … \]` (it is stored raw, so it can never carry HTML),
	 * and code is a TEXT node in a `<pre>`, never `{@html}`, which is the whole of why a listing
	 * with a `<script>` in it is safe.
	 *
	 * **The markup is the anchoring contract** (`anchoring.ts`): the container carries
	 * `data-anchor-scope`, and every block is a DIRECT child with `data-block-id`. A comment's
	 * "On: …" chip finds its block by exactly that selector, so neither half can be restyled into a
	 * different shape without the other.
	 *
	 * **Commenting**, when `annotate` is given: every block has a quiet "Comment" control in its
	 * gutter (always visible once something is said about it, as a count), and selecting text inside
	 * one block raises a small "Comment on this" button beside the selection. Both call
	 * `annotate.onComment` with an anchor and leave the rest — opening a composer, scrolling to it —
	 * to the host, because only the host knows where its thread is.
	 *
	 * The PDF preview keeps the material page's discipline: pdf.js is imported only when a reader
	 * presses the button (house rule 11).
	 */
	import { SvelteSet } from 'svelte/reactivity';
	import { m } from '$lib/paraglide/messages.js';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import type { Anchor, ContentBlock } from '$lib/types/blocks';
	import type { ConceptBlock } from '$lib/types/concept';
	import { formatBytes } from '$lib/components/concept/labels';
	import { anchorFromSelection, blockOf, type Annotate } from './anchoring';

	let {
		blocks,
		scope,
		annotate = undefined
	}: {
		blocks: (ContentBlock | ConceptBlock)[];
		/** Whose blocks these are (`comment-12`, `exercise-40`) — what an anchor chip looks for. */
		scope: string;
		annotate?: Annotate;
	} = $props();

	const openPreviews = new SvelteSet<string>();
	let container = $state<HTMLElement | null>(null);

	/** Where the floating "Comment on this" button sits, relative to the container, or null. */
	let pending = $state<{ anchor: Anchor; top: number; left: number } | null>(null);
	let tooLong = $state(false);

	function readSelection() {
		if (!annotate || !container) return;
		const selection = window.getSelection();
		const result = anchorFromSelection(selection, container);
		tooLong = result.tooLong;
		if (!result.anchor || !selection || selection.rangeCount === 0) {
			pending = null;
			return;
		}
		const rect = selection.getRangeAt(0).getBoundingClientRect();
		const box = container.getBoundingClientRect();
		pending = {
			anchor: result.anchor,
			top: rect.bottom - box.top + 4,
			left: Math.max(0, Math.min(rect.left - box.left, box.width - 180))
		};
	}

	// A touch screen's long-press selection fires no `mouseup` on some browsers, so a selection that
	// settles inside these blocks is read once it has stopped changing as well — `mouseup` is the
	// fast path, this is the one that works everywhere.
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	function onSelectionChange() {
		if (!annotate || !container) return;
		const selection = window.getSelection();
		clearTimeout(settleTimer);
		if (!selection || selection.isCollapsed || !blockOf(selection.anchorNode, container)) {
			pending = null;
			tooLong = false;
			return;
		}
		settleTimer = setTimeout(readSelection, 350);
	}

	function commentOnSelection() {
		if (!pending || !annotate) return;
		annotate.onComment(pending.anchor);
		pending = null;
		window.getSelection()?.removeAllRanges();
	}

	function commentOnBlock(id: string) {
		annotate?.onComment({ block: id, quote: '', prefix: '', suffix: '' });
	}

	function togglePreview(key: string) {
		if (openPreviews.has(key)) openPreviews.delete(key);
		else openPreviews.add(key);
	}

	const blockKey = (block: ContentBlock | ConceptBlock, index: number) => block.id || `i${index}`;
</script>

<svelte:document onselectionchange={onSelectionChange} />

<!-- `blocks` (the container) and `chem-drawing` / `sketch-drawing` (the pictures) are the class names
     the concept renderer this replaced emitted, kept so the selectors already written against them —
     `e2e/concepts.mjs`, the moderation queue's styles — keep meaning the same thing. -->
<div
	class="nb blocks"
	class:nb--annotated={!!annotate}
	data-anchor-scope={scope}
	bind:this={container}
	onmouseup={readSelection}
	onkeyup={(e) => e.shiftKey && readSelection()}
	role="presentation"
>
	{#each blocks as block, index (blockKey(block, index))}
		{@const key = blockKey(block, index)}
		{@const count = annotate?.counts[block.id] ?? 0}
		<div class="nb-block" data-block-id={block.id || undefined} data-kind={block.kind}>
			<div class="nb-block__content">
				{#if block.kind === 'markdown'}
					<MathContent source={block.body} />
				{:else if block.kind === 'latex'}
					<MathContent source={`\\[${block.source}\\]`} />
				{:else if block.kind === 'code'}
					<figure class="code">
						{#if block.language}<figcaption>{block.language}</figcaption>{/if}
						<pre><code>{block.source}</code></pre>
					</figure>
				{:else if block.kind === 'chem'}
					<figure class="block-figure">
						{#if block.drawing?.imageUrl}
							<img
								class="on-white chem-drawing"
								src={block.drawing.imageUrl}
								alt={block.drawing.label || block.caption}
								width={block.drawing.width || undefined}
								height={block.drawing.height || undefined}
								loading="lazy"
							/>
						{:else}
							<span class="gap">{m.notebook_pictureGone()}</span>
							<!-- "This picture is no longer available." -->
						{/if}
						{#if block.caption}<figcaption>{block.caption}</figcaption>{/if}
					</figure>
				{:else if block.kind === 'sketch'}
					<figure class="block-figure">
						{#if block.sketch?.imageUrl}
							<img
								class="on-white sketch-drawing"
								src={block.sketch.imageUrl}
								alt={block.sketch.label || block.caption}
								width={block.sketch.width || undefined}
								height={block.sketch.height || undefined}
								loading="lazy"
							/>
						{:else}
							<span class="gap">{m.notebook_pictureGone()}</span>
						{/if}
						{#if block.caption}<figcaption>{block.caption}</figcaption>{/if}
					</figure>
				{:else if block.kind === 'image'}
					{@const picture = 'imageId' in block ? block.image : block.asset}
					<figure class="block-figure">
						{#if picture?.url}
							<img
								src={picture.url}
								alt={block.alt}
								width={picture.width || undefined}
								height={picture.height || undefined}
								loading="lazy"
							/>
						{:else}
							<span class="gap">{m.notebook_pictureGone()}</span>
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
								<button type="button" onclick={() => togglePreview(key)}>
									{openPreviews.has(key) ? m.entry_hidePreview() : m.entry_showPreview()}
									<!-- "Hide preview" / "Show preview" -->
								</button>
							{/if}
						</div>
						{#if block.caption}<p class="pdf__caption">{block.caption}</p>{/if}
						{#if openPreviews.has(key) && block.asset?.url}
							{@const url = block.asset.url}
							{#await import('$lib/components/material/PdfViewer.svelte') then { default: PdfViewer }}
								<PdfViewer {url} />
							{/await}
						{/if}
					</div>
				{/if}
			</div>
			{#if annotate && block.id}
				<div class="nb-block__gutter" data-anchor-ignore>
					{#if count > 0}
						<button
							type="button"
							class="nb-count"
							disabled={!annotate.onShow}
							onclick={() => annotate?.onShow?.(block.id)}
							aria-label={m.notebook_countLabel({ count })}
							title={m.notebook_countLabel({ count })}
						>
							<span aria-hidden="true">💬</span>
							{count}
						</button>
						<!-- "{count} comments on this part" -->
					{/if}
					<button
						type="button"
						class="nb-add"
						onclick={() => commentOnBlock(block.id)}
						aria-label={m.notebook_commentOnBlock()}
						title={m.notebook_commentOnBlock()}
					>
						<span aria-hidden="true">+💬</span>
					</button>
					<!-- "Comment on this part" -->
				</div>
			{/if}
		</div>
	{/each}

	{#if pending}
		<button
			type="button"
			class="nb-selection"
			data-anchor-ignore
			style:top={`${pending.top}px`}
			style:left={`${pending.left}px`}
			onmousedown={(e) => e.preventDefault()}
			onclick={commentOnSelection}
		>
			{m.notebook_commentOnSelection()}
			<!-- "Comment on this" -->
		</button>
	{:else if tooLong}
		<p class="nb-too-long" role="status">{m.anchor_refused_quoteTooLong()}</p>
		<!-- "Select a shorter passage (up to 500 characters)." -->
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.nb {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.nb-block {
		position: relative;
		display: flex;
		gap: var(--space-2);
		border-radius: var(--radius-sm);
		min-width: 0;
	}
	.nb-block__content {
		flex: 1;
		min-width: 0;
	}
	.nb--annotated .nb-block {
		// Room for the gutter without moving the text when it appears.
		padding-right: 0;
	}
	// One row, so the two 44 px touch targets (global.scss) do not make a one-line block taller.
	.nb-block__gutter {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: var(--space-1);
		flex-shrink: 0;
	}
	.nb-add,
	.nb-count {
		@include mix.focus-ring;
		min-height: 44px;
		min-width: 44px;
		padding: 0 var(--space-1);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-secondary);
		font: inherit;
		font-size: var(--font-size-xs);
		cursor: pointer;
		white-space: nowrap;
	}
	// The "+" is quiet until the block is pointed at or focused, so a page of prose does not wear a
	// column of buttons; on a touch screen (no hover) it stays visible, faintly.
	.nb-add {
		opacity: 0;
	}
	.nb-block:hover .nb-add,
	.nb-block:focus-within .nb-add,
	.nb-add:focus-visible {
		opacity: 1;
	}
	@media (hover: none) {
		.nb-add {
			opacity: 0.6;
		}
	}
	.nb-add:hover {
		border-color: var(--border-color);
		color: var(--text-primary);
	}
	.nb-count {
		@include mix.count-badge;
		border-radius: 999px;
	}
	.nb-count:disabled {
		cursor: default;
	}
	.nb-selection {
		@include mix.button-primary;
		position: absolute;
		z-index: var(--z-popover, 20);
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-xs);
		box-shadow: var(--shadow-popover);
	}
	.nb-too-long {
		@include mix.status-message(warning);
		margin: 0;
		font-size: var(--font-size-xs);
	}
	:global(.nb-block--flash) {
		animation: nb-flash 1.6s ease-out;
	}
	@keyframes nb-flash {
		0%,
		30% {
			background: var(--accent-soft);
			box-shadow: 0 0 0 4px var(--accent-soft);
		}
		100% {
			background: transparent;
			box-shadow: 0 0 0 4px transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.nb-block--flash) {
			animation: none;
			outline: 2px solid var(--accent);
		}
	}
	:global(::highlight(edmat-anchor)) {
		background-color: var(--accent-soft);
		color: inherit;
		text-decoration: underline;
		text-decoration-color: var(--accent);
	}
	.code {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		figcaption {
			font-family: var(--font-mono);
			font-size: var(--font-size-xs);
			color: var(--text-secondary);
		}
		pre {
			margin: 0;
			padding: var(--space-2) var(--space-3);
			background: var(--bg-surface-alt);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			overflow-x: auto;
			font-family: var(--font-mono);
			font-size: var(--font-size-sm);
			tab-size: 4;
		}
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
		// A drawing sits on white so its black lines read in the dark theme too — the same treatment
		// `MathContent` gives an inline one.
		img.on-white {
			background: #fff;
			padding: 4px;
		}
		figcaption,
		.gap {
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
