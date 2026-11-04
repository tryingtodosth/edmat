<script lang="ts">
	/**
	 * A sketch block: a whiteboard drawing (Excalidraw, `components/sketch/`) stored as an ordinary
	 * `sketches.Sketch` row and shown here as the picture it returns. The concept editor's
	 * `ChemBlockEditor` is the pattern, line for line — the modal and the ~2 MB behind it are
	 * imported only when it opens (house rule 11), and reopening fetches the SOURCE first, because a
	 * picture alone cannot be edited.
	 *
	 * Gated like the insert strip's Sketch button: with `sketches` off, nobody but a moderator is
	 * offered the editor (house rule 3). `NotebookEditor` drops the kind from its menu too, so this
	 * line is only seen by somebody who already had one.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { getSketch } from '$lib/services/sketches';
	import type { Sketch } from '$lib/types/sketch';
	import type { SketchBlock } from '$lib/types/blocks';

	let { block }: { block: SketchBlock } = $props();

	const sketchesOn = $derived(featureFlagsStore.isEnabled('sketches') || authStore.isModerator);

	let open = $state(false);
	let existing = $state<Sketch | null>(null);
	let busy = $state(false);

	async function draw() {
		existing = null;
		if (block.sketchId) {
			busy = true;
			try {
				existing = await getSketch(block.sketchId);
			} catch {
				// A sketch whose row is gone can still be replaced: open an empty board.
				existing = null;
			} finally {
				busy = false;
			}
		}
		open = true;
	}

	function saved(sketch: Sketch) {
		block.sketchId = sketch.id;
		block.sketch = {
			imageUrl: sketch.imageUrl,
			label: sketch.label,
			width: sketch.width,
			height: sketch.height
		};
		if (!block.caption.trim()) block.caption = sketch.label;
		open = false;
		existing = null;
	}
</script>

<div class="sketch-block">
	{#if !sketchesOn}
		<p class="hint">{m.notebook_sketchUnavailable()}</p>
		<!-- "Sketches are switched off at the moment." -->
	{:else}
		{#if block.sketch?.imageUrl}
			<img
				src={block.sketch.imageUrl}
				alt={block.sketch.label || block.caption}
				width={block.sketch.width || undefined}
				height={block.sketch.height || undefined}
			/>
		{/if}
		<button type="button" class="ghost" disabled={busy} onclick={draw}>
			{block.sketchId ? m.notebook_sketchEdit() : m.notebook_sketchDraw()}
			<!-- "Edit sketch" / "Draw a sketch" -->
		</button>
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

{#if open}
	{#await import('$lib/components/sketch/SketchEditorModal.svelte') then { default: SketchEditorModal }}
		<SketchEditorModal
			{existing}
			onSaved={saved}
			onClose={() => {
				open = false;
				existing = null;
			}}
		/>
	{/await}
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.sketch-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
	}
	img {
		max-width: 100%;
		max-height: 320px;
		height: auto;
		border-radius: var(--radius-sm);
		background: #fff;
	}
	.ghost {
		@include mix.button-secondary;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		width: 100%;

		input {
			@include mix.focus-ring;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
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
