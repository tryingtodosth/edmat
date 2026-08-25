<script lang="ts">
	// What a page shows while it is waiting.
	//
	// Replaces the bare `<p>Loading…</p>` this app used in 44 places. A line of text is not
	// nothing-wrong — it collapses the layout to one line and then throws the real content in, so
	// every load is a visible jump, and on a slow connection the page looks broken rather than busy.
	//
	// Skeletons in the shape of what is coming instead: `card` for a grid of cards, `list` for a
	// stack of rows, `text` for a paragraph. They reserve the space the content will occupy, so the
	// page does not move when it arrives.
	//
	// `aria-busy` and a visually-hidden label, because a screen reader gets nothing from a grey
	// rectangle — it needs to be told the region is loading, once, rather than reading out N empty
	// boxes.
	import { m } from '$lib/paraglide/messages.js';

	let {
		variant = 'list',
		count = 3,
		label
	}: {
		variant?: 'card' | 'list' | 'text';
		/** How many placeholder rows/cards to draw. Match the usual result count, not the maximum. */
		count?: number;
		label?: string;
	} = $props();
</script>

<div class="loading loading--{variant}" role="status" aria-busy="true">
	<span class="visually-hidden">{label ?? m.common_loading()}</span>
	{#each Array(count) as _, i (i)}
		<div class="skeleton skeleton--{variant}" aria-hidden="true">
			{#if variant === 'card'}
				<div class="bar bar--title"></div>
				<div class="bar bar--line"></div>
				<div class="bar bar--short"></div>
			{:else if variant === 'list'}
				<div class="bar bar--line"></div>
			{:else}
				<div class="bar bar--line"></div>
				<div class="bar bar--short"></div>
			{/if}
		</div>
	{/each}
</div>

<style lang="scss">
	.loading {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.loading--card {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.skeleton--card {
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md, 8px);
		background: var(--bg-surface);
	}
	.bar {
		position: relative;
		overflow: hidden;
		height: 0.75rem;
		border-radius: var(--radius-sm, 4px);
		background: var(--border-color);
	}
	// A sweep rather than a pulse: a pulsing block reads as a broken image, where a sweep is the
	// established "this is filling in" idiom. The highlight is its own element moved with
	// `transform`, not an animated `background-position`: only transform/opacity animations run on
	// the compositor, and PageSpeed flagged every bar as a non-composited animation (a layout-and-
	// paint per frame, on the very screen that is waiting for the main thread to be free).
	.bar::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			var(--bg-surface-alt, rgba(255, 255, 255, 0.35)) 50%,
			transparent 100%
		);
		transform: translateX(-100%);
		animation: sweep 1.4s ease-in-out infinite;
	}
	.bar--title {
		height: 1rem;
		width: 60%;
	}
	.bar--short {
		width: 40%;
	}

	@keyframes sweep {
		to {
			transform: translateX(100%);
		}
	}

	// Somebody who has asked for less motion gets a still placeholder, which still reserves the
	// space — the point of the skeleton — without the sweep.
	@media (prefers-reduced-motion: reduce) {
		.bar::after {
			animation: none;
		}
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
