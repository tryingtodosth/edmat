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
	import { resolve } from '$app/paths';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { aboutDocFor, type AboutFeature } from '$lib/content/about';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import OrganizationPage from '$lib/components/organization/OrganizationPage.svelte';
	import ShowcaseIndex from '$lib/components/showcase/ShowcaseIndex.svelte';
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

<OrganizationPage
	slug={PROJECT_SLUG}
	headTitle={doc.title}
	headDescription={m.seo_about_description()}
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

	<!-- learning: showcase (G) — the index of the design showcase pages under /about/<feature>. -->
	<ShowcaseIndex />

	<!-- contests: showcase (B) — step B adds its /about/contests card to ShowcaseIndex itself (the
	     index is a list in that component); this marker only records that the page is not otherwise
	     touched. -->
	<!-- learning: guide (H) — the one link into the manual at /about/guide. -->
	<section class="about__section about__manual">
		<h2>{m.guide_aboutLink()}</h2>
		<!-- "How to use EdMat: the manual, chapter by chapter, with real screenshots." -->
		<p><a class="btn-secondary" href={resolve('/about/guide')}>{m.guide_aboutLinkCta()}</a></p>
		<!-- "Open the manual →" -->
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

	// ---- the manual -----------------------------------------------------------------------------
	// A band rather than a card: the manual is one destination, and a single card in a grid of its
	// own reads as a grid with one thing missing.
	.about__manual {
		h2 {
			max-width: 62ch;
			font-size: var(--font-size-base);
			font-weight: 600;
			color: var(--text-secondary);
			margin-bottom: var(--space-3);
		}
		p {
			margin: 0;
		}
	}

	.about__research p {
		max-width: 70ch;
	}
</style>
