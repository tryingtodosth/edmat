<script lang="ts">
	/**
	 * A chemistry block: a structure or reaction drawn in the editor this app already has, stored
	 * as an ordinary `chem.ChemDrawing` row and shown here as the picture it returns.
	 *
	 * `ChemEditorModal` (and the ~21 MB of Ketcher and Indigo-as-WASM behind it) is imported
	 * dynamically at the moment it opens — the insert strip's own discipline, and house rule 11.
	 * Reopening an existing drawing fetches the row first, because the modal needs the SOURCE to
	 * put back on the canvas; a picture alone cannot be edited.
	 *
	 * Gated exactly like the strip's own chemistry button: with the `chemistry` switch off, the
	 * editor is not offered to anybody who is not a moderator (house rule 3 — a killed feature
	 * should not still show its buttons). `BlockEditor` also drops `chem` from the "Add block" menu
	 * in that case, so this line is only ever seen by somebody who had already added one.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { getChemDrawing } from '$lib/services/chem';
	import type { ChemDrawing } from '$lib/types/chem';
	import type { ConceptChemBlock } from '$lib/types/concept';

	let { block }: { block: ConceptChemBlock } = $props();

	const chemistryOn = $derived(featureFlagsStore.isEnabled('chemistry') || authStore.isModerator);

	let open = $state(false);
	let existing = $state<ChemDrawing | null>(null);
	let busy = $state(false);
	let error = $state('');

	async function draw() {
		error = '';
		existing = null;
		if (block.drawingId) {
			busy = true;
			try {
				existing = await getChemDrawing(block.drawingId);
			} catch {
				// A drawing whose row is gone is still a drawing you can replace — open an empty
				// canvas rather than refusing to open anything.
				existing = null;
			} finally {
				busy = false;
			}
		}
		open = true;
	}

	function saved(drawing: ChemDrawing) {
		block.drawingId = drawing.id;
		block.drawing = {
			imageUrl: drawing.imageUrl,
			label: drawing.label,
			width: drawing.width,
			height: drawing.height,
			sourceFormat: drawing.sourceFormat
		};
		// The drawing's own label is the honest default caption; it is never empty, and the person
		// is looking straight at the field.
		if (!block.caption.trim()) block.caption = drawing.label;
		open = false;
		existing = null;
	}
</script>

<div class="chem-block">
	{#if !chemistryOn}
		<p class="hint">{m.concept_chem_unavailable()}</p>
		<!-- "Chemistry drawings are switched off at the moment." -->
	{:else}
		{#if block.drawing?.imageUrl}
			<img
				class="chem-drawing"
				src={block.drawing.imageUrl}
				alt={block.drawing.label || block.caption}
				width={block.drawing.width || undefined}
				height={block.drawing.height || undefined}
			/>
		{/if}
		<div class="actions">
			<button type="button" class="ghost" disabled={busy} onclick={draw}>
				{block.drawingId ? m.concept_chem_edit() : m.concept_chem_draw()}
				<!-- "Edit drawing" / "Draw" -->
			</button>
		</div>
		{#if error}<p class="error">{error}</p>{/if}
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
	{#await import('$lib/components/chem/ChemEditorModal.svelte') then { default: ChemEditorModal }}
		<ChemEditorModal
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

	.chem-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
	}
	.chem-drawing {
		background: #fff;
		border-radius: var(--radius-sm);
		padding: 4px;
		max-width: 100%;
		max-height: 320px;
		height: auto;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
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
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin: 0;
		white-space: normal;
	}
</style>
