<script lang="ts">
	/**
	 * The chemistry dialog: Ketcher (Apache 2.0) inside a wide modal. On save the drawing is
	 * POSTed (or PUT over the existing one) and the caller receives the row, whose `embedHtml` is
	 * the `<img>` to put into the text. Ketcher is the one editor here — ChemDoodle was wired in
	 * beside it and dropped the same day, GPLv3 against an MIT repository.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import KetcherHost from './KetcherHost.svelte';
	import { createChemDrawing, updateChemDrawing } from '$lib/services/chem';
	import { ApiError } from '$lib/api/client';
	import type { ChemDrawing } from '$lib/types/chem';

	let {
		existing = null,
		onSaved,
		onClose
	}: {
		existing?: ChemDrawing | null;
		onSaved: (drawing: ChemDrawing) => void;
		onClose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let caption = $state(existing?.label ?? '');
	let captionTouched = $state(false);
	let saving = $state(false);
	let error = $state('');
	let ready = $state(false);
	let ketcher = $state<KetcherHost | null>(null);

	const title = m.chem_title_ketcher(); // "Draw a structure — Ketcher"

	async function save() {
		error = '';
		saving = true;
		try {
			const result = await ketcher!.getResult();
			if (result.empty) {
				error = m.chem_empty();
				return;
			}
			// Ketcher's SMILES is the default caption unless the person wrote their own.
			const label =
				captionTouched && caption.trim() ? caption.trim() : caption.trim() || result.label;
			const draft = {
				sourceFormat: result.sourceFormat,
				source: result.source,
				label,
				image: result.image
			};
			const drawing = existing
				? await updateChemDrawing(existing.id, draft)
				: await createChemDrawing(draft);
			onSaved(drawing);
		} catch (e) {
			const detail =
				e instanceof ApiError
					? Object.values((e.body as Record<string, unknown>) ?? {})
							.flat()
							.join(' ') || e.message
					: e instanceof Error
						? e.message
						: String(e);
			error = m.chem_saveFailed({ error: detail });
		} finally {
			saving = false;
		}
	}
</script>

<ModalShell {title} {onClose} size="wide">
	<div class="chem-editor">
		<div class="chem-editor__stage">
			<KetcherHost
				bind:this={ketcher}
				initialSource={existing?.source ?? ''}
				onReady={() => (ready = true)}
				onError={(msg) => (error = msg)}
			/>
		</div>
		<div class="chem-editor__tools">
			<button
				type="button"
				class="arrow"
				disabled={!ready}
				onclick={() => ketcher?.addReactionArrow()}>{m.chem_addArrow()}</button
			>
			<small>{m.chem_reactionHint()}</small>
		</div>
		<label class="chem-editor__caption">
			<span>{m.chem_caption()}</span>
			<input
				type="text"
				bind:value={caption}
				oninput={() => (captionTouched = true)}
				maxlength="300"
			/>
			<small>{m.chem_captionHint()}</small>
		</label>
		{#if error}<p class="chem-editor__error" role="alert">{error}</p>{/if}
		<div class="chem-editor__actions">
			<small class="chem-editor__licence">{m.chem_licence_ketcher()}</small>
			<button type="button" class="cancel" onclick={onClose}>{m.common_cancel()}</button>
			<button type="button" class="submit" disabled={!ready || saving} onclick={save}
				>{existing ? m.chem_update() : m.chem_insert()}</button
			>
		</div>
	</div>
</ModalShell>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.chem-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.chem-editor__stage {
		height: min(60vh, 560px);
		min-height: 420px;
	}
	.chem-editor__tools {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		font-size: var(--font-size-sm);
		small {
			color: var(--text-secondary);
		}
	}
	.arrow {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
	}
	.chem-editor__caption {
		display: grid;
		gap: 0.25rem;
		font-size: var(--font-size-sm);
		input {
			font: inherit;
			padding: 0.45rem 0.6rem;
			border: 1px solid var(--border);
			border-radius: 6px;
			background: var(--bg-surface);
			color: var(--text-primary);
		}
		small {
			color: var(--text-secondary);
		}
	}
	.chem-editor__error {
		margin: 0;
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.chem-editor__actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
	}
	.chem-editor__licence {
		color: var(--text-secondary);
		margin-right: auto;
	}
	.submit {
		@include mix.button-primary;
		padding: var(--space-1) var(--space-3);
	}
	.cancel {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
	}
</style>
