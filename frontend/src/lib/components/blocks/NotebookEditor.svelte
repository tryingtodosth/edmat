<script lang="ts">
	/**
	 * A notebook's content, as the ordered list of blocks it really is: a card per block, each with
	 * the editor for its own kind, and an "Add block" menu between every two cards so a formula can
	 * go anywhere rather than only at the bottom. One editor for every owner — a comment, a
	 * solution, a post, a concept article (`profile` says which kinds are offered) — since
	 * 2026-11-04; until then this was `concept/BlockEditor.svelte` and only articles had it.
	 *
	 * Three decisions worth knowing before changing this:
	 *
	 * 1. **A block is mutated in place, never replaced.** The cards are keyed on the block OBJECT,
	 *    so reordering moves the editor components with their contents; replacing a block on every
	 *    keystroke would remount its editor — and `RichEditor` seeds Tiptap from `value` once, at
	 *    mount, so that remount is the text disappearing as you type in it. The cost, inherited
	 *    from the concept editor this was: Svelte's dev build logs `ownership_invalid_mutation` for
	 *    each edit, because `bind:block` on an `{#each}` item is not allowed in runes mode and
	 *    `bind:block={blocks[i]}` loses the per-kind type. Dev-only, and named in `todo.md`.
	 * 2. **A block's `id` is never touched here.** The server allocates it and keeps whatever comes
	 *    back, and it is what a comment on this block points at. Moving a block keeps its id (and so
	 *    its comments); removing one detaches them, honestly, with a line under each.
	 * 3. **A killed feature's kind leaves the menu** (house rule 3): `chem` with `chemistry` off,
	 *    `sketch` with `sketches` off. Blocks already there stay — the kind's own editor says so.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { ContentBlock } from '$lib/types/blocks';
	import type { ConceptBlock, ConceptBlockKind } from '$lib/types/concept';
	import { BLOCK_KIND_LABELS, BLOCK_KINDS } from '$lib/components/concept/labels';
	import ChemBlockEditor from '$lib/components/concept/ChemBlockEditor.svelte';
	import ImageBlockEditor from '$lib/components/concept/ImageBlockEditor.svelte';
	import LatexBlockEditor from '$lib/components/concept/LatexBlockEditor.svelte';
	import MarkdownBlockEditor from '$lib/components/concept/MarkdownBlockEditor.svelte';
	import PdfBlockEditor from '$lib/components/concept/PdfBlockEditor.svelte';
	import CodeBlockEditor from './CodeBlockEditor.svelte';
	import InlineImageBlockEditor from './InlineImageBlockEditor.svelte';
	import SketchBlockEditor from './SketchBlockEditor.svelte';

	type AnyBlock = ContentBlock | ConceptBlock;

	let {
		blocks = $bindable([]),
		/** `content` — a comment, a solution, a post; `concept` adds a PDF and asset pictures. */
		profile = 'content',
		/** `config/blocks.py`'s cap for this owner, so the button stops rather than the save failing. */
		maxBlocks = 40,
		/** The paragraph editor's placeholder; a concept article's mentions `[[slug]]` links. */
		paragraphPlaceholder = undefined,
		/** Shown when the list is empty. */
		emptyHint = undefined
	}: {
		blocks: AnyBlock[];
		profile?: 'content' | 'concept';
		maxBlocks?: number;
		paragraphPlaceholder?: string;
		emptyHint?: string;
	} = $props();

	const chemistryOn = $derived(featureFlagsStore.isEnabled('chemistry') || authStore.isModerator);
	const sketchesOn = $derived(featureFlagsStore.isEnabled('sketches') || authStore.isModerator);
	const offered = $derived(
		BLOCK_KINDS.filter((kind) => {
			if (kind === 'chem') return chemistryOn;
			if (kind === 'sketch') return sketchesOn && authStore.isAuthenticated;
			if (kind === 'pdf') return profile === 'concept';
			return true;
		})
	);

	/** Which "Add block" menu is open, by insertion position. `null` is none. */
	let menuAt = $state<number | null>(null);

	function emptyBlock(kind: ConceptBlockKind): AnyBlock {
		switch (kind) {
			case 'latex':
				return { id: '', kind: 'latex', source: '' };
			case 'code':
				return { id: '', kind: 'code', language: '', source: '' };
			case 'chem':
				return { id: '', kind: 'chem', drawingId: '', caption: '' };
			case 'sketch':
				return { id: '', kind: 'sketch', sketchId: '', caption: '' };
			case 'pdf':
				return { id: '', kind: 'pdf', assetId: '', caption: '' };
			case 'image':
				return profile === 'concept'
					? { id: '', kind: 'image', assetId: '', alt: '', caption: '' }
					: { id: '', kind: 'image', imageId: '', alt: '', caption: '' };
			default:
				return { id: '', kind: 'markdown', body: '' };
		}
	}

	function add(kind: ConceptBlockKind, at: number) {
		if (blocks.length >= maxBlocks) return;
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
			disabled={blocks.length >= maxBlocks}
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
		<p class="hint">{emptyHint ?? m.concept_blocks_empty()}</p>
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
				<MarkdownBlockEditor {block} placeholder={paragraphPlaceholder} />
			{:else if block.kind === 'latex'}
				<LatexBlockEditor {block} />
			{:else if block.kind === 'code'}
				<CodeBlockEditor {block} />
			{:else if block.kind === 'chem'}
				<ChemBlockEditor {block} />
			{:else if block.kind === 'sketch'}
				<SketchBlockEditor {block} />
			{:else if block.kind === 'pdf'}
				<PdfBlockEditor {block} />
			{:else if block.kind === 'image' && 'imageId' in block}
				<InlineImageBlockEditor {block} />
			{:else if block.kind === 'image'}
				<ImageBlockEditor {block} />
			{/if}
		</article>

		{@render addMenu(index + 1)}
	{/each}

	{#if blocks.length >= maxBlocks}
		<p class="hint">{m.concept_blocks_full({ max: maxBlocks })}</p>
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
