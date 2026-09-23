<script lang="ts">
	/**
	 * A picture block. The file is uploaded on the spot through `/concept-assets/`, which
	 * re-encodes it (house rule 7 — the EXIF goes with the original bytes, which is a privacy fix
	 * as much as a security one) and answers with the stored picture.
	 *
	 * The description is required rather than optional: a picture nobody has described is a picture
	 * some readers never get at all, and an article is exactly the place that matters. It is
	 * prefilled with the file's own name, which is a poor description but an honest one and never
	 * empty — the person is looking straight at the field (the insert strip's own reasoning).
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { uploadConceptAsset } from '$lib/services/concepts';
	import type { ConceptImageBlock } from '$lib/types/concept';
	import { messageForError } from './labels';

	let { block }: { block: ConceptImageBlock } = $props();

	const MAX_BYTES = 5 * 1024 * 1024;

	let busy = $state(false);
	let error = $state('');

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
			if (!block.alt.trim()) block.alt = file.name;
		} catch (e) {
			error = messageForError(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="image-block">
	<label class="field">
		<span>{m.concept_image_field()}</span>
		<!-- "Picture" -->
		<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onchange={pick} />
		<span class="hint">{m.concept_image_hint()}</span>
		<!-- "PNG, JPEG or WebP, up to 5 MB. It is re-encoded on upload, which removes the EXIF." -->
	</label>

	{#if busy}
		<p class="hint">{m.concept_uploading()}</p>
		<!-- "Uploading…" -->
	{/if}
	{#if error}<p class="error">{error}</p>{/if}

	{#if block.asset?.url}
		<img class="thumb" src={block.asset.url} alt={block.alt} />
	{/if}

	<label class="field">
		<span>{m.concept_image_alt()}</span>
		<!-- "Describe the picture" -->
		<input type="text" maxlength="200" bind:value={() => block.alt, (v) => (block.alt = v)} />
		<span class="hint">{m.concept_image_altHint()}</span>
		<!-- "Read out to anybody who cannot see it. Say what it shows, not that it is a picture." -->
	</label>

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

	.image-block {
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
	.thumb {
		max-width: 100%;
		max-height: 16rem;
		width: auto;
		height: auto;
		border-radius: var(--radius-sm);
		align-self: flex-start;
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin: 0;
		align-self: flex-start;
		white-space: normal;
	}
</style>
