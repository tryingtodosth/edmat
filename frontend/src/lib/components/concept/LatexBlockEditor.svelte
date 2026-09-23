<script lang="ts">
	/**
	 * One display formula, previewed live as it is typed.
	 *
	 * This is the shape of the insert strip's own LaTeX panel, extracted — the strip's panel stays
	 * where it is, because there it inserts maths INTO a paragraph, and here the formula IS the
	 * block. The source is stored raw and wrapped in `\[ … \]` only at render time, which is what
	 * makes it impossible for a formula to carry HTML (`backend/concepts/blocks.py`).
	 */
	import { m } from '$lib/paraglide/messages.js';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import type { ConceptLatexBlock } from '$lib/types/concept';

	let { block }: { block: ConceptLatexBlock } = $props();
</script>

<div class="latex-block">
	<label class="field">
		<span>{m.concept_latex_label()}</span>
		<!-- "Formula" -->
		<textarea
			rows="3"
			maxlength="10000"
			spellcheck="false"
			bind:value={() => block.source, (v) => (block.source = v)}
			placeholder={'\\frac{a}{b}'}></textarea>
		<span class="hint">{m.concept_latex_hint()}</span>
		<!-- "LaTeX only — no delimiters needed, it is displayed on its own line." -->
	</label>
	{#if block.source.trim()}
		<div class="preview">
			<span class="hint">{m.insert_preview()}</span>
			<!-- "Preview" -->
			<MathContent source={`\\[${block.source}\\]`} />
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.latex-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);

		textarea {
			@include mix.focus-ring;
			font: inherit;
			font-family: monospace;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
	}
</style>
