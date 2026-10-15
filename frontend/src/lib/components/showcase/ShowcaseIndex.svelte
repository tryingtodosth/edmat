<script lang="ts">
	/**
	 * The index of the design showcase, mounted at the `learning: showcase (G)` marker on `/about`.
	 *
	 * A card grid rather than a list of links, matching the feature grid a few sections below it on
	 * the same page — and deliberately NOT flag-gated the way those cards are. A showcase page is a
	 * description of a design; it reads correctly whether or not the surface it describes is
	 * switched on, and the page itself says so when it is off. Hiding the explanation of a killed
	 * feature would leave a reader with no way to find out what the site does.
	 *
	 * **`nested` (WP7, 2026-10-15):** `/about` now draws this inside its "Explore" section, beside
	 * the manual, and that section carries `id="showcase"` (the start-here strip's middle door) and
	 * the `h2`. Nested, the index gives up both — an id may appear once, and its heading becomes an
	 * `h3` under Explore's. Not nested, it is exactly what it was.
	 */
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { SHOWCASE_PAGES, showcaseIndexFor } from '$lib/content/showcase';
	import { SHOWCASE_HREF } from './hrefs';

	let { nested = false }: { nested?: boolean } = $props();

	const doc = $derived(showcaseIndexFor(getLocale()));
	const locale = $derived(getLocale());
</script>

<!-- Not nested, `id="showcase"` is the start-here band's "See what EdMat can do" target
     (StartHere.svelte); nested, `/about`'s Explore section carries it instead. -->
<section
	class="showcase-index"
	class:showcase-index--nested={nested}
	id={nested ? undefined : 'showcase'}
>
	<svelte:element this={nested ? 'h3' : 'h2'} class="showcase-index__heading"
		>{doc.heading}</svelte:element
	>
	<p class="showcase-index__intro">{doc.intro}</p>
	<ul class="showcase-index__grid">
		{#each SHOWCASE_PAGES as entry (entry.slug)}
			<li class="showcase-index__card">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the href comes from SHOWCASE_HREF in components/showcase/hrefs.ts, which is built from resolve() per route -->
				<a href={SHOWCASE_HREF[entry.slug]}>
					<h3>{entry.titleFor(locale)}</h3>
					<p>{entry.blurbFor(locale)}</p>
					<span class="showcase-index__cta">{doc.cardCta} →</span>
				</a>
			</li>
		{/each}
	</ul>
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.showcase-index {
		/* The sticky header would otherwise cover the heading the #showcase anchor lands on. */
		scroll-margin-top: 5rem;
		/* The grid's container (WP13): `balanced-card-grid` reads its width, so the index's last row
		   is full like the feature grid's above it, whatever the number of pages. */
		container-type: inline-size;
	}

	.showcase-index--nested {
		scroll-margin-top: 0;
	}
	// Nested under Explore's h2: the same size the page's h2s had, so the index still reads as the
	// section's main body and not as a footnote under the manual.
	.showcase-index--nested .showcase-index__heading {
		font-size: var(--font-size-lg);
		margin-bottom: var(--space-3);
	}

	.showcase-index__intro {
		color: var(--text-secondary);
		max-width: 66ch;
		line-height: 1.65;
	}
	.showcase-index__grid {
		@include mix.balanced-card-grid;
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
	}
	.showcase-index__card {
		@include mix.card-surface;
		display: flex;
		background: var(--bg-surface-alt);

		a {
			@include mix.focus-ring;
			display: flex;
			flex-direction: column;
			gap: var(--space-2);
			padding: var(--space-3);
			width: 100%;
			color: inherit;
			text-decoration: none;
			border-radius: inherit;
		}
		a:hover {
			background: var(--bg-surface);
		}
		a:hover h3 {
			color: var(--accent);
		}
		h3 {
			font-size: var(--font-size-base);
			margin: 0;
		}
		p {
			font-size: var(--font-size-sm);
			color: var(--text-secondary);
			margin: 0;
			line-height: 1.6;
		}
	}
	.showcase-index__cta {
		margin-top: auto;
		font-size: var(--font-size-sm);
		color: var(--accent);
		font-weight: 600;
	}
</style>
