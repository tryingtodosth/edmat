<script lang="ts">
	/**
	 * One screenshot of the running site on a `/about/<feature>` page, with a link to the real page.
	 *
	 * **Deliberately NOT inside `SampleFrame`.** A sample is a drawing of a component fed invented
	 * data, made `inert` so nobody clicks into a row that does not exist. This is the opposite: a
	 * picture of the real page as it is, taken by `e2e/guide-screenshots.mjs` against seeded data,
	 * and its whole job is to send the reader there. Putting it in the frame would label a real
	 * screen "sample" and disable the one link that matters.
	 *
	 * The image is lazy (most of them sit below the fold, and a 1280-wide PNG is not cheap on a
	 * phone) and carries its real `width`/`height`, so the browser reserves the box before the bytes
	 * arrive and the text under it does not jump. It is a static file, not an API call — these pages
	 * still ask the backend for nothing.
	 *
	 * `href` is `null` when the feature the page lives behind is switched off: the picture still
	 * says what the site does, but a link to a closed page would fail somewhere less useful (house
	 * rule 3).
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { ShowcaseShot } from '$lib/content/showcase';

	let { shot, href }: { shot: ShowcaseShot; href: string | null } = $props();

	// The crop (`ShowcaseShot.focus`): the box takes the focus columns' aspect ratio and is never
	// wider than they are, and the image inside is scaled up and shifted left so exactly those
	// columns fill it. Percentages, so it holds at any width the box is drawn at. The box's own
	// aspect ratio is what keeps the layout still while the lazy image loads.
	const left = $derived(shot.focus?.[0] ?? 0);
	const visible = $derived((shot.focus?.[1] ?? shot.width) - left);
	const boxStyle = $derived(`max-width: ${visible}px; aspect-ratio: ${visible} / ${shot.height};`);
	const imgStyle = $derived(
		`width: ${(shot.width / visible) * 100}%; margin-left: ${(-left / visible) * 100}%;`
	);
</script>

<figure class="shot" style={`max-width: ${visible}px;`}>
	<p class="shot__badge">{m.showcaseTry_shotBadge()}</p>
	<!-- "Screenshot of the running site" -->
	<div class="shot__picture" style={boxStyle}>
		<img
			src={shot.src}
			alt={shot.alt}
			width={shot.width}
			height={shot.height}
			loading="lazy"
			decoding="async"
			style={imgStyle}
		/>
	</div>
	<figcaption>
		<span class="shot__caption">{shot.caption}</span>
		{#if href}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href comes from SHOWCASE_LIVE in components/showcase/hrefs.ts, which is built from resolve() per route -->
			<a class="shot__open" {href}>{shot.linkLabel ?? m.showcaseTry_openReal()}&nbsp;→</a>
			<!-- "Open the real page" -->
		{/if}
	</figcaption>
</figure>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.shot {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		width: 100%;
	}
	.shot__badge {
		margin: 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}
	// The picture sits in a plain bordered box: no tint, no "Sample" badge — the visual difference
	// from `SampleFrame` is part of telling the reader which kind of thing they are looking at.
	.shot__picture {
		@include mix.card-surface;
		overflow: hidden;
		padding: 0;
		line-height: 0;
	}
	img {
		display: block;
		max-width: none;
		height: auto;
	}
	figcaption {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-1) var(--space-3);
		font-size: var(--font-size-sm);
		line-height: 1.55;
	}
	.shot__caption {
		color: var(--text-secondary);
		flex: 1 1 18rem;
		min-width: 0;
	}
	.shot__open {
		font-weight: 600;
		white-space: nowrap;
		color: var(--accent);
	}
</style>
