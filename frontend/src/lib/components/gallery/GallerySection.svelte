<script lang="ts">
	/**
	 * The pictures on one piece of content: a grid anybody can read, an upload anybody signed in can
	 * use, and — for whoever looks after this content — captions, removal and the order.
	 *
	 * The curation half is the reason `GovernorApplication` exists: adding is open, arranging is
	 * not, and applying to look after a material is how somebody earns the second.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		addGalleryImage,
		getGallery,
		removeGalleryImage,
		reorderGallery,
		setGalleryImageCaption
	} from '$lib/services/galleries';
	import type { Gallery, GalleryImage, GalleryTargetType } from '$lib/types/gallery';
	import { ApiError } from '$lib/api/client';
	import Lightbox from './Lightbox.svelte';

	let {
		targetType,
		targetId,
		/** Called with the gallery each time it loads. The page above needs one thing out of it —
		 *  whether the viewer curates this content — and it would otherwise have to ask the server
		 *  the same question a second time. */
		onLoaded
	}: {
		targetType: GalleryTargetType;
		targetId: string;
		onLoaded?: (gallery: Gallery) => void;
	} = $props();

	let gallery = $state<Gallery | undefined>(undefined);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let lightboxAt = $state<number | null>(null);
	let editingId = $state<string | null>(null);
	let captionDraft = $state('');
	let fileInput: HTMLInputElement | undefined = $state();

	// The id this component last loaded for. Without it a bare `$effect` reading `targetId` re-fires
	// on unrelated state changes and refetches the gallery on every keystroke in the caption box —
	// the same guard every dynamic route in this app needs for the same reason.
	let loadedFor = $state('');

	$effect(() => {
		const key = `${targetType}:${targetId}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load();
	});

	async function load() {
		loading = true;
		gallery = await getGallery(targetType, targetId);
		if (gallery) onLoaded?.(gallery);
		loading = false;
	}

	async function onPick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		// Reset immediately: picking the same file twice in a row fires no change event otherwise,
		// which reads as "the upload button stopped working".
		input.value = '';
		if (files.length === 0) return;

		busy = true;
		error = '';
		try {
			for (const file of files) {
				await addGalleryImage(targetType, targetId, file);
			}
			await load();
		} catch (e) {
			error = messageFor(e);
		} finally {
			busy = false;
		}
	}

	function messageFor(e: unknown): string {
		if (e instanceof ApiError) {
			const detail = (e.body as { detail?: string; image?: string[] } | undefined) ?? {};
			if (detail.detail === 'quota') return m.gallery_error_quota();
			if (detail.detail === 'too_many') return m.gallery_error_tooMany();
			if (Array.isArray(detail.image) && detail.image[0]) return detail.image[0];
		}
		return m.gallery_error_generic();
	}

	async function remove(image: GalleryImage) {
		if (!confirm(m.gallery_confirmRemove())) return;
		busy = true;
		try {
			await removeGalleryImage(image.id);
			await load();
		} catch (e) {
			error = messageFor(e);
		} finally {
			busy = false;
		}
	}

	function startCaption(image: GalleryImage) {
		editingId = image.id;
		captionDraft = image.caption;
	}

	async function saveCaption() {
		if (editingId === null) return;
		busy = true;
		try {
			await setGalleryImageCaption(editingId, captionDraft);
			editingId = null;
			await load();
		} catch (e) {
			error = messageFor(e);
		} finally {
			busy = false;
		}
	}

	/** Move one picture one place. Deliberately buttons rather than drag-and-drop: this list is
	 *  usually a handful of pages, the whole order is submitted either way, and a pair of buttons
	 *  is operable by keyboard without a second implementation. */
	async function move(image: GalleryImage, by: -1 | 1) {
		if (!gallery?.id) return;
		const ids = gallery.images.map((row) => row.id);
		const from = ids.indexOf(image.id);
		const to = from + by;
		if (from < 0 || to < 0 || to >= ids.length) return;
		ids.splice(to, 0, ...ids.splice(from, 1));
		busy = true;
		try {
			gallery = await reorderGallery(gallery.id, ids);
		} catch (e) {
			error = messageFor(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if !loading && gallery}
	{#if gallery.images.length > 0 || gallery.canAdd}
		<section class="gallery">
			<div class="gallery__head">
				<h2>{m.gallery_heading()}</h2>
				{#if gallery.canCurate && gallery.images.length > 1}
					<span class="gallery__curator">{m.gallery_youCurate()}</span>
				{/if}
			</div>
			<p class="gallery__hint">{m.gallery_hint()}</p>

			{#if gallery.images.length === 0}
				<p class="gallery__empty">{m.gallery_empty()}</p>
			{:else}
				<ul class="gallery__grid">
					{#each gallery.images as image, position (image.id)}
						<li class="gallery__item">
							<button type="button" class="gallery__thumb" onclick={() => (lightboxAt = position)}>
								<img src={image.url} alt={image.caption || ''} loading="lazy" />
							</button>

							{#if editingId === image.id}
								<div class="gallery__caption-edit">
									<label class="visually-hidden" for="caption-{image.id}">
										{m.gallery_captionLabel()}
									</label>
									<input
										id="caption-{image.id}"
										type="text"
										maxlength="300"
										bind:value={captionDraft}
										placeholder={m.gallery_captionLabel()}
									/>
									<button type="button" onclick={saveCaption} disabled={busy}>
										{m.common_save()}
									</button>
									<button type="button" onclick={() => (editingId = null)}>
										{m.common_cancel()}
									</button>
								</div>
							{:else if image.caption}
								<p class="gallery__caption">{image.caption}</p>
							{/if}

							{#if image.canEdit}
								<div class="gallery__actions">
									<button type="button" onclick={() => startCaption(image)} disabled={busy}>
										{m.gallery_caption()}
									</button>
									{#if gallery.canCurate}
										<button
											type="button"
											onclick={() => move(image, -1)}
											disabled={busy || position === 0}
											aria-label={m.gallery_moveEarlier()}
										>
											↑
										</button>
										<button
											type="button"
											onclick={() => move(image, 1)}
											disabled={busy || position === gallery.images.length - 1}
											aria-label={m.gallery_moveLater()}
										>
											↓
										</button>
									{/if}
									<button
										type="button"
										class="danger"
										onclick={() => remove(image)}
										disabled={busy}
									>
										{m.gallery_remove()}
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if error}
				<p class="gallery__error">{error}</p>
			{/if}

			{#if gallery.canAdd}
				<div class="gallery__add">
					<label class="gallery__add-label" for="gallery-file-{targetType}-{targetId}">
						{busy ? m.common_loading() : m.gallery_add()}
					</label>
					<input
						id="gallery-file-{targetType}-{targetId}"
						class="visually-hidden"
						type="file"
						accept="image/png,image/jpeg,image/webp"
						multiple
						disabled={busy}
						bind:this={fileInput}
						onchange={onPick}
					/>
				</div>
			{:else if !authStore.isAuthenticated && gallery.images.length > 0}
				<p class="gallery__hint">{m.gallery_signInToAdd()}</p>
			{/if}
		</section>
	{/if}
{/if}

{#if lightboxAt !== null && gallery && gallery.images.length > 0}
	<Lightbox images={gallery.images} startAt={lightboxAt} onClose={() => (lightboxAt = null)} />
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.gallery {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.gallery__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: var(--text-secondary);
		}
	}
	.gallery__curator {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
	.gallery__hint,
	.gallery__empty {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.gallery__error {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--status-danger-text, #b3261e);
	}
	.gallery__grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: var(--space-3);
	}
	.gallery__item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.gallery__thumb {
		padding: 0;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: #fff;
		cursor: zoom-in;
		overflow: hidden;

		img {
			display: block;
			width: 100%;
			// A fixed box so a grid of portrait and landscape pages is still a grid. The whole
			// picture is one click away in the lightbox, uncropped.
			height: 150px;
			object-fit: cover;
		}
	}
	.gallery__caption {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.gallery__caption-edit {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);

		input {
			flex: 1 1 120px;
			min-height: 44px;
		}
		button {
			min-height: 44px;
		}
	}
	.gallery__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);

		button {
			min-height: 44px;
			padding: 0 var(--space-2);
			font-size: var(--font-size-xs);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			cursor: pointer;

			&:disabled {
				opacity: 0.4;
				cursor: default;
			}
		}
		.danger {
			color: var(--status-danger-text, #b3261e);
		}
	}
	.gallery__add-label {
		@include mix.button-secondary;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
</style>
