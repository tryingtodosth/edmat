<script lang="ts">
	// `/about` is what EdMat is, shown rather than told (owner, 2026-11-02: "have these animations
	// on about and move what currently is about to edmat.net/coop"). It opens on the promo reel:
	// real EdMat pages playing on phones (`PromoReel`). Under it are what a newcomer needs, all
	// carried over from the page that was here before:
	//
	// - the "New here?" strip (`StartHere variant="about"`, WP7). Its middle door is still the
	//   `#showcase` jump on this page;
	// - the "what you can do here" grid (`lib/content/about.ts`);
	// - a band leading to the team's own page;
	// - Explore: the manual and the showcase index.
	//
	// The organisation's page (roster, goals, needs, board, polls and the research thread) is now
	// `/coop`. Its band here goes with the `organizations` switch, as the card on `/coop` would (house
	// rule 3). Everything here is static and prerendered: no API call, and the reel reads storage and
	// media queries only in its own `onMount`.
	import { resolve } from '$app/paths';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { aboutDocFor, type AboutFeature } from '$lib/content/about';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import PromoReel from '$lib/components/showcase/PromoReel.svelte';
	import ShowcaseIndex from '$lib/components/showcase/ShowcaseIndex.svelte';
	import StartHere from '$lib/components/home/StartHere.svelte';

	const doc = $derived(aboutDocFor(getLocale()));
	// A card pointing at a killed surface is exactly the link house rule 3 says a kill switch has to
	// remove; `|| isModerator` mirrors `FeatureGate` and the backend's own staff bypass.
	function shown(feature: AboutFeature): boolean {
		return (
			feature.flag === null || featureFlagsStore.isEnabled(feature.flag) || authStore.isModerator
		);
	}
	const features = $derived(doc.features.filter(shown));
	const teamShown = $derived(featureFlagsStore.isEnabled('organizations') || authStore.isModerator);
</script>

<PageHead title={doc.title} description={m.seo_about_description()} />
<!-- "About EdMat" / "What EdMat is: a moderated, bilingual community database of exercises…" -->

<article class="about">
	<header class="about__hero">
		<p class="about__eyebrow">{doc.eyebrow}</p>
		<h1>{doc.title}</h1>
		<p class="about__lead">{doc.lead[0]}</p>
	</header>

	<PromoReel />

	<div class="about-start">
		<StartHere variant="about" />
	</div>

	<section class="about__section about__features">
		<h2>{doc.featuresHeading}</h2>
		<p class="about__intro">{doc.featuresIntro}</p>
		<ul class="about__grid">
			{#each features as feature (feature.key)}
				<li class="about__card">
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the hrefs are the fixed route paths listed in lib/content/about.ts -->
					<a href={localizeHref(feature.href)} class="about__card-link">
						<h3>{feature.title}</h3>
						<p>{feature.body}</p>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	{#if teamShown}
		<section class="about__section about__band" aria-labelledby="about-team">
			<div>
				<h2 id="about-team">{m.about_coopHeading()}</h2>
				<!-- "The team behind EdMat" -->
				<p>{m.about_coopBody()}</p>
				<!-- "EdMat is run in the open. Its goals, the help it needs, its task board and the decisions …" -->
			</div>
			<a class="btn-secondary" href={resolve('/coop')}>{m.about_coopCta()}</a>
			<!-- "See the team’s page →" -->
		</section>
	{/if}

	<!-- Explore: the manual and the design showcase, one section (WP7), the manual first because it
	     is the one destination and the showcase is twelve.
	     learning: showcase (G) — the index of the design showcase pages under /about/<feature>.
	     learning: guide (H) — the one link into the manual at /about/guide.
	     contests: showcase (B) — DONE. The /about/contests card is in `SHOWCASE_PAGES`
	     (`lib/content/showcase/index.ts`), which is what `<ShowcaseIndex />` draws. -->
	<section class="about__section about__explore" id="showcase" aria-labelledby="about-explore">
		<h2 id="about-explore">{m.wp7_exploreHeading()}</h2>
		<!-- "Explore" -->
		<p class="about__intro">{m.wp7_exploreIntro()}</p>
		<!-- "Two ways to find your way around: read the manual, or look at each part of the site with sample data and real screenshots, and then try the real thing." -->
		<div class="about__band">
			<div>
				<h3>{m.wp7_exploreManualHeading()}</h3>
				<!-- "The manual" -->
				<p>{m.guide_aboutLink()}</p>
				<!-- "How to use EdMat: the manual, chapter by chapter, with real screenshots." -->
			</div>
			<a class="btn-secondary" href={resolve('/about/guide')}>{m.guide_aboutLinkCta()}</a>
			<!-- "Open the manual →" -->
		</div>
		<ShowcaseIndex nested />
	</section>
</article>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.about {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);

		h2 {
			font-size: var(--font-size-lg);
			margin-bottom: var(--space-3);
		}
		p {
			line-height: 1.65;
			margin-bottom: var(--space-2);
		}
	}

	// ---- the hero: what this is, then the reel shows it ----------------------------------------
	.about__hero {
		max-width: 70ch;
		h1 {
			font-size: var(--font-size-xl);
			margin: 0 0 var(--space-2);
		}
	}
	.about__eyebrow {
		font-size: var(--font-size-sm);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: var(--space-1) !important;
	}
	.about__lead {
		color: var(--text-secondary);
		font-size: var(--font-size-lg);
	}
	// The reel sits right under the hero; the page's own gap would push it a screen away.
	.about__hero + :global(.reel) {
		margin-top: calc(-1 * var(--space-4));
	}

	// ---- feature grid ---------------------------------------------------------------------------
	.about__intro {
		color: var(--text-secondary);
		max-width: 62ch;
	}
	// The grid's container (WP13): `balanced-card-grid` picks its column count from this section's
	// width, so that the last row is never one card on its own (13 cards at 1280 drew 4 + 4 + 4 + 1).
	.about__features {
		container-type: inline-size;
	}
	.about__grid {
		@include mix.balanced-card-grid;
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
	}
	.about__card {
		@include mix.card-surface;
		display: flex;
	}
	.about__card-link {
		@include mix.focus-ring;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		width: 100%;
		color: inherit;
		text-decoration: none;
		border-radius: inherit;

		h3 {
			font-size: var(--font-size-base);
		}
		p {
			font-size: var(--font-size-sm);
			color: var(--text-secondary);
			margin: 0;
		}
		&:hover {
			background: var(--bg-surface-alt);
		}
		&:hover h3 {
			color: var(--accent);
		}
	}

	.about__section > p {
		max-width: 66ch;
	}

	// ---- the newcomer's strip -------------------------------------------------------------------
	.about-start:empty {
		display: none;
	}

	// ---- Explore: the manual, then the showcase ---------------------------------------------------
	.about__explore {
		// The sticky header would otherwise cover the heading the #showcase anchor lands on.
		scroll-margin-top: 5rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);

		h2,
		.about__intro {
			margin-bottom: 0;
		}
	}
	// A band rather than a card: the team's page and the manual are each one destination, and a
	// single card in a grid of its own reads as a grid with one thing missing.
	.about__band {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border-color);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-md);
		background: var(--bg-surface);

		div {
			flex: 1 1 22rem;
			min-width: 0;
		}
		h2,
		h3 {
			font-size: var(--font-size-base);
			margin: 0 0 var(--space-1);
		}
		p {
			margin: 0;
			color: var(--text-secondary);
			max-width: 62ch;
		}
		// `btn-secondary` has no global rule — the class alone drew plain text.
		.btn-secondary {
			@include mix.button-secondary;
			flex: none;
			text-decoration: none;
		}
	}
</style>
