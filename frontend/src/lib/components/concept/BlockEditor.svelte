<script lang="ts">
	/**
	 * An article's content, as the ordered list of blocks it really is: a card per block, each with
	 * the editor for its own kind, and an "Add block" menu under every card and at the end so a new
	 * paragraph can go anywhere rather than only at the bottom.
	 *
	 * Two decisions worth knowing before changing this:
	 *
	 * 1. **A block is mutated in place, never replaced.** The cards are keyed on the block OBJECT,
	 *    so reordering moves the editor components with their contents; replacing a block on every
	 *    keystroke would change its key and remount its editor — and `RichEditor` seeds Tiptap from
	 *    `value` once, at mount, so that remount is the text disappearing as you type in it.
	 *    `blocks` arrives as a `$state` array from the caller, so in-place mutation is reactive.
	 * 2. **`chem` leaves the menu when the `chemistry` switch is off** (house rule 3: a kill switch
	 *    takes away the links, not just the pages). Blocks already in the article stay — the
	 *    per-kind editor says so itself rather than silently dropping content.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { ConceptBlock, ConceptBlockKind } from '$lib/types/concept';
	import { BLOCK_KIND_LABELS, BLOCK_KINDS } from './labels';
	import ChemBlockEditor from './ChemBlockEditor.svelte';
	import ImageBlockEditor from './ImageBlockEditor.svelte';
	import LatexBlockEditor from './LatexBlockEditor.svelte';
	import MarkdownBlockEditor from './MarkdownBlockEditor.svelte';
	import PdfBlockEditor from './PdfBlockEditor.svelte';

	let { blocks = $bindable([]) }: { blocks: ConceptBlock[] } = $props();

	/** `blocks.py`'s own cap, mirrored so the button stops rather than the save failing. */
	const MAX_BLOCKS = 200;

	const chemistryOn = $derived(featureFlagsStore.isEnabled('chemistry') || authStore.isModerator);
	const offered = $derived(BLOCK_KINDS.filter((kind) => kind !== 'chem' || chemistryOn));

	/** Which "Add block" menu is open, by insertion position. `null` is none. */
	let menuAt = $state<number | null>(null);

	function emptyBlock(kind: ConceptBlockKind): ConceptBlock {
		switch (kind) {
			case 'latex':
				return { kind: 'latex', source: '' };
			case 'chem':
				return { kind: 'chem', drawingId: '', caption: '' };
			case 'pdf':
				return { kind: 'pdf', assetId: '', caption: '' };
			case 'image':
				return { kind: 'image', assetId: '', alt: '', caption: '' };
			default:
				return { kind: 'markdown', body: '' };
		}
	}

	function add(kind: ConceptBlockKind, at: number) {
		if (blocks.length >= MAX_BLOCKS) return;
		blocks.splice(at, 0, emptyBlock(kind));
		menuAt = null;
	}

	function remove(index: number) {
		blocks.splice(index, 1);
		menuAt = null;
	}

	function move(index: number, by: -1 | 1) {
		const to = index + by;
		if (to < 0 || to >= blocks.length) return;
		const [moved] = blocks.splice(index, 1);
		blocks.splice(to, 0, moved);
		menuAt = null;
	}
</script>

{#snippet addMenu(at: number)}
	<div class="add">
		<button
			type="button"
			class="add__trigger"
			aria-expanded={menuAt === at}
			disabled={blocks.length >= MAX_BLOCKS}
			onclick={() => (menuAt = menuAt === at ? null : at)}
		>
			{m.concept_blocks_add()}
			<!-- "Add block" -->
		</button>
		{#if menuAt === at}
			<div class="add__menu" role="group" aria-label={m.concept_blocks_add()}>
				{#each offered as kind (kind)}
					<button type="button" onclick={() => add(kind, at)}>{BLOCK_KIND_LABELS[kind]()}</button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<div class="block-editor">
	{#if blocks.length === 0}
		<p class="hint">{m.concept_blocks_empty()}</p>
		<!-- "An article is made of blocks: a paragraph, a formula, a drawing, a picture, a PDF." -->
	{/if}

	{@render addMenu(0)}

	{#each blocks as block, index (block)}
		<article class="card">
			<header class="card__head">
				<span class="badge">{BLOCK_KIND_LABELS[block.kind]()}</span>
				<span class="card__position">{m.concept_blocks_position({ n: index + 1 })}</span>
				<!-- "Block {n}" -->
				<div class="card__actions">
					<button
						type="button"
						aria-label={m.concept_blocks_moveUp()}
						title={m.concept_blocks_moveUp()}
						disabled={index === 0}
						onclick={() => move(index, -1)}>&#9650;</button
					>
					<!-- "Move up" -->
					<button
						type="button"
						aria-label={m.concept_blocks_moveDown()}
						title={m.concept_blocks_moveDown()}
						disabled={index === blocks.length - 1}
						onclick={() => move(index, 1)}>&#9660;</button
					>
					<!-- "Move down" -->
					<button
						type="button"
						class="danger"
						aria-label={m.concept_blocks_removeBlock()}
						title={m.concept_blocks_removeBlock()}
						onclick={() => remove(index)}>&times;</button
					>
					<!-- "Remove this block" -->
				</div>
			</header>

			{#if block.kind === 'markdown'}
				<MarkdownBlockEditor {block} />
			{:else if block.kind === 'latex'}
				<LatexBlockEditor {block} />
			{:else if block.kind === 'chem'}
				<ChemBlockEditor {block} />
			{:else if block.kind === 'pdf'}
				<PdfBlockEditor {block} />
			{:else if block.kind === 'image'}
				<ImageBlockEditor {block} />
			{/if}
		</article>

		{@render addMenu(index + 1)}
	{/each}

	{#if blocks.length >= MAX_BLOCKS}
		<p class="hint">{m.concept_blocks_full({ max: MAX_BLOCKS })}</p>
		<!-- "An article can hold {max} blocks." -->
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.block-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.card {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: var(--bg-surface);
	}
	.card__head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.badge {
		font-size: var(--font-size-xs);
		border-radius: 999px;
		padding: 1px var(--space-2);
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
	}
	.card__position {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.card__actions {
		margin-left: auto;
		display: flex;
		gap: var(--space-1);

		button {
			@include mix.focus-ring;
			min-width: 32px;
			min-height: 32px;
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			font: inherit;
			cursor: pointer;
		}
		button:disabled {
			opacity: 0.4;
			cursor: default;
		}
		button.danger:not(:disabled):hover {
			color: var(--status-danger);
			border-color: var(--status-danger);
		}
	}
	.add {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		align-items: center;
	}
	.add__trigger,
	.add__menu button {
		@include mix.focus-ring;
		min-height: 32px;
		padding: 0 var(--space-2);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-secondary);
		font: inherit;
		font-size: var(--font-size-xs);
		cursor: pointer;
	}
	.add__menu {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;

		button {
			border-style: solid;
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
