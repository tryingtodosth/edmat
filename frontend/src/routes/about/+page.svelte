<script lang="ts">
	// `/about` is the project itself (owner, 2026-10-07/08): the EdMat organisation's page — its
	// description, roster, goals (plans), needs, tasks and polls — composed with what a visitor
	// still needs from the old brochure: the research thread's section, the "what you can do here"
	// grid, the design showcase index and the one link into the manual. The brochure's prose lives
	// on in `lib/content/about.ts` for the grid's copy and for anyone who wants it back.
	//
	// Prerendered like before (`+page.ts`), but the organisation body loads client-side, so the
	// prerendered HTML carries the head and the static blocks and the body paints after the SPA
	// boots — the trade the owner chose over the brochure's first paint.
	//
	// **A newcomer's three doors come first (WP7, 2026-10-15; owner: "yes, put the strip above the
	// organisation page").** The page opens on a body's roster and task board, which is the project
	// being honest about itself and not where somebody new should start, so the homepage's
	// `StartHere` band sits above it — the same component, `variant="about"`, the same shared "hide".
	// It is in the prerendered HTML and reads storage only in its own `onMount`. Its middle door
	// lands on the Explore section at the bottom: the manual and the twelve showcase pages, which
	// used to be two bands, as one section carrying `id="showcase"`.
	import { resolve } from '$app/paths';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { aboutDocFor, type AboutFeature } from '$lib/content/about';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import OrganizationPage from '$lib/components/organization/OrganizationPage.svelte';
	import ShowcaseIndex from '$lib/components/showcase/ShowcaseIndex.svelte';
	import StartHere from '$lib/components/home/StartHere.svelte';
	import DiscussableSection from '$lib/components/discussion/DiscussableSection.svelte';
	import { providePageDiscussions } from '$lib/components/discussion/pageDiscussions.svelte';

	/** The project's own organisation — `work/edmat_project.py: ORGANIZATION_SLUG`. */
	const PROJECT_SLUG = 'edmat';

	// The one discussion location this page keeps from the brochure: the research thread the seed
	// posts under it (`work/edmat_research_thread.json`). The brochure's other six section keys
	// are no longer drawn; their rows, if any, stay in the moderation list.
	const DISCUSSION_PAGE = 'about';
	const DISCUSSION_SECTIONS = ['money-and-openness'];
	const pageDiscussions = providePageDiscussions();
	$effect(() => pageDiscussions.load(DISCUSSION_PAGE, DISCUSSION_SECTIONS));

	const doc = $derived(aboutDocFor(getLocale()));
	// A card pointing at a killed surface is exactly the link house rule 3 says a kill switch has to
	// remove; `|| isModerator` mirrors `FeatureGate` and the backend's own staff bypass.
	function shown(feature: AboutFeature): boolean {
		return (
			feature.flag === null || featureFlagsStore.isEnabled(feature.flag) || authStore.isModerator
		);
	}
	const features = $derived(doc.features.filter(shown));
</script>

<div class="about-start">
	<StartHere variant="about" />
</div>

<OrganizationPage
	slug={PROJECT_SLUG}
	headTitle={doc.title}
	headDescription={m.seo_about_description()}
	quietWhenOff
/>
<!-- "About EdMat" / "What EdMat is: a moderated, bilingual community database of exercises…" -->

<article class="about">
	<DiscussableSection sectionKey="money-and-openness" title={m.about_researchHeading()}>
		<section class="about__section about__research">
			<h2>{m.about_researchHeading()}</h2>
			<!-- "The association: the legal report and its reading" -->
			<p>{m.about_researchIntro()}</p>
			<!-- "The Gemini Deep Research report of 6 October 2026 … Neither is a lawyer’s opinion." -->
		</section>
	</DiscussableSection>

	<section class="about__section">
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

	<!-- Explore: the manual and the design showcase, one section (WP7). It used to be the showcase
	     index followed by a separate one-link band for the manual; a newcomer looking for "how do I
	     find my way around" now finds both answers under one heading, the manual first because it is
	     the one destination and the showcase is twelve.
	     learning: showcase (G) — the index of the design showcase pages under /about/<feature>.
	     learning: guide (H) — the one link into the manual at /about/guide.
	     contests: showcase (B) — DONE. The /about/contests card is in `SHOWCASE_PAGES`
	     (`lib/content/showcase/index.ts`), which is what `<ShowcaseIndex />` draws, so this page
	     needed no markup of its own. The marker is left in place as the record of that. -->
	<section class="about__section about__explore" id="showcase" aria-labelledby="about-explore">
		<h2 id="about-explore">{m.wp7_exploreHeading()}</h2>
		<!-- "Explore" -->
		<p class="about__intro">{m.wp7_exploreIntro()}</p>
		<!-- "Two ways to find your way around: read the manual, or look at each part of the site with sample data and real screenshots, and then try the real thing." -->
		<div class="about__manual">
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

	// ---- feature grid ---------------------------------------------------------------------------
	.about__intro {
		color: var(--text-secondary);
		max-width: 62ch;
	}
	.about__grid {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: var(--space-3);
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
	// The width of the organisation page directly under it (`OrganizationPage`'s `.page`), so the
	// doors line up with the h1 they sit above rather than with the wider grid further down.
	.about-start {
		max-width: 820px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-4) 0;
		// The band, when hidden, leaves no wrapper padding behind that reads as a gap.
		&:empty {
			display: none;
		}
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
	// A band rather than a card: the manual is one destination, and a single card in a grid of its
	// own reads as a grid with one thing missing.
	.about__manual {
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
		h3 {
			font-size: var(--font-size-base);
			margin: 0 0 var(--space-1);
		}
		p {
			margin: 0;
			color: var(--text-secondary);
			max-width: 62ch;
		}
		// `btn-secondary` has no global rule — the class alone drew plain text, here and before WP7.
		.btn-secondary {
			@include mix.button-secondary;
			flex: none;
			text-decoration: none;
		}
	}

	.about__research p {
		max-width: 70ch;
	}
</style>
