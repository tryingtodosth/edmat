<script lang="ts">
	/**
	 * The index of the design showcase, mounted at the `learning: showcase (G)` marker on `/about`.
	 *
	 * A card grid rather than a list of links, matching the feature grid a few sections below it on
	 * the same page — and deliberately NOT flag-gated the way those cards are. A showcase page is a
	 * description of a design; it reads correctly whether or not the surface it describes is
	 * switched on, and the page itself says so when it is off. Hiding the explanation of a killed
	 * feature would leave a reader with no way to find out what the site does.
	 */
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { SHOWCASE_PAGES, showcaseIndexFor } from '$lib/content/showcase';
	import { SHOWCASE_HREF } from './hrefs';

	const doc = $derived(showcaseIndexFor(getLocale()));
	const locale = $derived(getLocale());
</script>

<!-- `id="showcase"` is the homepage band's "See what EdMat can do" target (StartHere.svelte). -->
<section class="showcase-index" id="showcase">
	<h2>{doc.heading}</h2>
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
	}

	.showcase-index__intro {
		color: var(--text-secondary);
		max-width: 66ch;
		line-height: 1.65;
	}
	.showcase-index__grid {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: var(--space-3);
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
