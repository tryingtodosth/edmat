<script lang="ts">
	/**
	 * A picture, filling the screen, with a way to the next one.
	 *
	 * Not `ModalShell`: that is a dialog with a title bar and a panel sized for a form, and what
	 * this needs is the opposite — as much room as the screen has, with the chrome out of the way.
	 * What it does borrow is the parts of a dialog that are easy to get wrong and that
	 * `ModalShell` already got right, so they are implemented the same way here: focus moves in on
	 * open and back to the trigger on close, Escape closes, and the backdrop is a real `<button>`
	 * rather than a div with a click handler.
	 */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { GalleryImage } from '$lib/types/gallery';

	let {
		images,
		startAt = 0,
		onClose
	}: { images: GalleryImage[]; startAt?: number; onClose: () => void } = $props();

	// Seeded once from the prop on purpose — which picture was clicked is the STARTING point, and
	// re-syncing it would yank the reader back there every time the parent re-rendered.
	// svelte-ignore state_referenced_locally
	let index = $state(startAt);
	let panel: HTMLElement | undefined = $state();

	let current = $derived(images[index]);
	let hasPrevious = $derived(index > 0);
	let hasNext = $derived(index < images.length - 1);

	function show(next: number) {
		if (next >= 0 && next < images.length) index = next;
	}

	onMount(() => {
		const restoreTo = document.activeElement as HTMLElement | null;
		panel?.focus();
		// The page behind must not scroll while this is over it — on a phone the lightbox is the
		// whole screen, and a page moving underneath is how somebody loses their place.
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previousOverflow;
			restoreTo?.focus?.();
		};
	});

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onClose();
		} else if (event.key === 'ArrowLeft') {
			show(index - 1);
		} else if (event.key === 'ArrowRight') {
			show(index + 1);
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="lightbox">
	<!-- Out of the tab order and hidden from a screen reader: Escape and the ✕ are the two routes
	     out, and a third unlabelled one would be noise. Same reasoning as the drawer's scrim. -->
	<button type="button" class="lightbox__scrim" tabindex="-1" aria-hidden="true" onclick={onClose}
	></button>

	<div
		class="lightbox__panel"
		bind:this={panel}
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		aria-label={current?.caption || m.gallery_lightboxLabel()}
	>
		<div class="lightbox__bar">
			<span class="lightbox__count">{index + 1} / {images.length}</span>
			<button type="button" class="lightbox__close" onclick={onClose} aria-label={m.common_close()}>
				✕
			</button>
		</div>

		{#if current}
			<img class="lightbox__image" src={current.url} alt={current.caption || ''} />
			{#if current.caption}
				<p class="lightbox__caption">{current.caption}</p>
			{/if}
			{#if current.uploadedByDisplayName}
				<p class="lightbox__credit">
					{m.gallery_addedBy({ name: current.uploadedByDisplayName })}
				</p>
			{/if}
		{/if}

		<div class="lightbox__nav">
			<button
				type="button"
				onclick={() => show(index - 1)}
				disabled={!hasPrevious}
				aria-label={m.gallery_previous()}
			>
				‹ {m.gallery_previous()}
			</button>
			<button
				type="button"
				onclick={() => show(index + 1)}
				disabled={!hasNext}
				aria-label={m.gallery_next()}
			>
				{m.gallery_next()} ›
			</button>
		</div>
	</div>
</div>

<style lang="scss">
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal, 1000);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3);
	}
	.lightbox__scrim {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		background: var(--backdrop, rgba(0, 0, 0, 0.75));
		cursor: zoom-out;
	}
	.lightbox__panel {
		position: relative;
		max-width: min(1200px, 100%);
		max-height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		outline: none;
	}
	.lightbox__bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		color: #fff;
	}
	.lightbox__count {
		font-size: var(--font-size-sm);
	}
	.lightbox__close {
		min-width: 44px;
		min-height: 44px;
		font-size: 1.25rem;
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.5);
		border-radius: var(--radius-sm);
		color: #fff;
		cursor: pointer;
	}
	.lightbox__image {
		display: block;
		max-width: 100%;
		// Leaves room for the bar, the caption and the buttons, so nothing is ever pushed off the
		// bottom of a short window.
		max-height: 70vh;
		width: auto;
		height: auto;
		margin: 0 auto;
		border-radius: var(--radius-sm);
		// A transparent picture would otherwise be read against the dark scrim.
		background: #fff;
	}
	.lightbox__caption,
	.lightbox__credit {
		margin: 0;
		color: #fff;
		text-align: center;
	}
	.lightbox__caption {
		font-size: var(--font-size-sm);
	}
	.lightbox__credit {
		font-size: var(--font-size-xs);
		opacity: 0.8;
	}
	.lightbox__nav {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);

		button {
			min-height: 44px;
			padding: 0 var(--space-3);
			background: transparent;
			border: 1px solid rgba(255, 255, 255, 0.5);
			border-radius: var(--radius-sm);
			color: #fff;
			cursor: pointer;

			&:disabled {
				opacity: 0.35;
				cursor: default;
			}
		}
	}
</style>
