<script lang="ts">
	/**
	 * A text block: the same rich editor and insert strip every composer in this app uses, so
	 * inline maths, inline pictures and inline chemistry work inside a paragraph exactly as they do
	 * in a comment. Storage does not change — the block's `body` is Markdown with raw HTML and
	 * literal `\( … \)` delimiters, like every other content field here.
	 *
	 * `allowFiles={false}` on purpose: a PDF is its OWN block in an article (`PdfBlockEditor`),
	 * where it is uploaded through `/concept-assets/`, counted against the quota and previewable.
	 * An attachment row hanging off a paragraph would be a second, weaker way to do the same thing.
	 *
	 * `block` is mutated in place rather than replaced: the block cards are keyed on the block
	 * OBJECT (`BlockEditor.svelte`), so replacing it would remount this editor — and `RichEditor`
	 * seeds Tiptap from `value` once, at mount, which is exactly the content that would be lost.
	 */
	import RichEditor from '$lib/components/editor/RichEditor.svelte';
	import InsertStrip from '$lib/components/editor/InsertStrip.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { ConceptMarkdownBlock } from '$lib/types/concept';

	let { block }: { block: ConceptMarkdownBlock } = $props();

	let editorRef = $state<RichEditor | null>(null);
	let strip = $state<InsertStrip | null>(null);
</script>

<div class="markdown-block">
	<RichEditor
		bind:this={editorRef}
		bind:value={() => block.body, (v) => (block.body = v)}
		rows={6}
		placeholder={m.concept_block_markdownPlaceholder()}
		onChemEdit={(id) => strip?.editChem(id)}
	/>
	<!-- "Write this part of the article. LaTeX between \( … \) is typeset, and [[another-concept]]
	     becomes a link." -->
	<InsertStrip bind:this={strip} editor={editorRef} allowFiles={false} />
</div>

<style lang="scss">
	.markdown-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
</style>
