<script lang="ts">
	/**
	 * A picture block on a comment, a solution or a post: uploaded through `/api/inline-images/`
	 * (re-encoded on the server — never the bytes that were sent, house rule 7) and then pointed at
	 * by id. A concept article's picture is a different row (`concept/ImageBlockEditor.svelte`,
	 * a `ConceptAsset`); the two editors are separate because the two uploads are.
	 *
	 * The description is asked for up front and sent with the upload, because it is the picture's
	 * `alt` and a picture without one is a picture some readers never get.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { uploadInlineImage } from '$lib/services/inlineImages';
	import type { InlineImageBlock } from '$lib/types/blocks';

	let { block }: { block: InlineImageBlock } = $props();

	let busy = $state(false);
	let error = $state('');

	async function choose(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		busy = true;
		error = '';
		try {
			const image = await uploadInlineImage(file, block.alt);
			block.imageId = image.id;
			block.image = { url: image.url, width: image.width, height: image.height };
		} catch (e) {
			error =
				e instanceof ApiError
					? Object.values((e.body as Record<string, unknown>) ?? {})
							.flat()
							.join(' ') || m.common_error_generic()
					: m.common_error_generic();
		} finally {
			busy = false;
		}
	}
</script>

<div class="image-block">
	{#if block.image?.url}
		<img
			src={block.image.url}
			alt={block.alt}
			width={block.image.width || undefined}
			height={block.image.height || undefined}
		/>
	{/if}
	<label class="field">
		<span>{m.notebook_imageAlt()}</span>
		<!-- "Describe the picture (for people who cannot see it)" -->
		<input type="text" maxlength="200" bind:value={() => block.alt, (v) => (block.alt = v)} />
	</label>
	<label class="upload">
		<input
			type="file"
			accept="image/png,image/jpeg,image/webp,image/gif"
			disabled={busy}
			onchange={choose}
		/>
		<span
			>{busy
				? m.notebook_imageUploading()
				: block.imageId
					? m.notebook_imageReplace()
					: m.notebook_imageChoose()}</span
		>
		<!-- "Uploading…" / "Replace picture" / "Choose a picture" -->
	</label>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
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
		align-items: flex-start;
	}
	img {
		max-width: 100%;
		max-height: 320px;
		height: auto;
		border-radius: var(--radius-sm);
	}
	.upload {
		@include mix.button-secondary;
		position: relative;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		cursor: pointer;

		input {
			position: absolute;
			inset: 0;
			opacity: 0;
			cursor: pointer;
		}
		&:focus-within {
			outline: 2px solid var(--accent);
			outline-offset: 2px;
		}
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
	.error {
		@include mix.status-message(danger);
		margin: 0;
	}
</style>
