<script lang="ts">
	/**
	 * The shell every `/about/<feature>` page uses: the head tags, the hero, the honest notice, the
	 * numbered claims, and the way back out.
	 *
	 * One shell rather than seven copies, because the thing that must be identical on all seven is
	 * the sentence saying nothing here is live. A page that forgot it would be the one page a reader
	 * mistook for the real thing.
	 *
	 * **Three kinds of thing, kept apart on the page (2026-10-14).** The notice says which is which:
	 * the framed samples are drawings fed sample data and cannot be clicked; the screenshots
	 * (`ShowcaseShot`, outside any frame) are pictures of the running site; and the "Try it yourself"
	 * row and the manual link are real links. Every live link is filtered through its feature's kill
	 * switch here, in one place, via `SHOWCASE_LIVE` — a content file names a route, never a flag.
	 *
	 * The claims under the lead are a `<dl>` and not a list of headings on purpose: four `<h3>`s
	 * directly under the `<h1>` would skip a level, which axe's `heading-order` rule rightly
	 * refuses, and inventing an `<h2>` to put above them would be furniture with nothing to say.
	 */
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import { SHOWCASE_PAGES, type ShowcaseDoc, type ShowcaseSlug } from '$lib/content/showcase';
	import { SHOWCASE_GUIDE, SHOWCASE_HREF, SHOWCASE_LIVE, liveHref } from './hrefs';
	import ShowcaseShot from './ShowcaseShot.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import type { ShowcaseLiveRoute } from '$lib/content/showcase';
	import { providePageDiscussions } from '$lib/components/discussion/pageDiscussions.svelte';

	let {
		doc,
		slug,
		/**
		 * True when the feature this page describes is switched off on this site. The page still
		 * renders in full — it is prose, and a reader asking what EdMat does deserves the answer
		 * either way — but it says so, which is the honest version of house rule 3 for a page that
		 * is a description rather than a surface.
		 */
		featureOff = false,
		/**
		 * The section keys this page's own `<DiscussableSection>`s use
		 * (`backend/community/discussions.py`). Listed by the page, provided here, so that seven
		 * pages share ONE policy request each instead of one per section — and so that the shell,
		 * which cannot see its children's sections, does not have to guess them.
		 *
		 * Empty by default: a showcase page that lists nothing simply has no discussions, and the
		 * page renders exactly as it did before.
		 */
		discussionSections = [],
		children
	}: {
		doc: ShowcaseDoc;
		slug: ShowcaseSlug;
		featureOff?: boolean;
		discussionSections?: string[];
		children: Snippet;
	} = $props();

	// `about/<slug>` is the page key the server knows — the same string as the route, without the
	// leading slash (`discussions.PAGE_RE`).
	const pageDiscussions = providePageDiscussions();
	$effect(() => pageDiscussions.load(`about/${slug}`, discussionSections));

	const others = $derived(SHOWCASE_PAGES.filter((p) => p.slug !== slug));

	// A live link is drawn only when its feature is on — or for a moderator, the same bypass
	// `FeatureGate` and the backend have. The store fails open before its first fetch resolves, so
	// the prerendered HTML carries every link and a killed one leaves on hydration.
	//
	// A `signedIn` route (`/work`) is also dropped for a signed-out reader, because that page answers
	// them with an error rather than a sign-in prompt.
	function reachable(route: ShowcaseLiveRoute | undefined): boolean {
		if (!route) return false;
		const { flag, signedIn } = SHOWCASE_LIVE[route];
		if (signedIn && !authStore.isAuthenticated) return false;
		return flag === null || featureFlagsStore.isEnabled(flag) || authStore.isModerator;
	}
	const tryLinks = $derived((doc.tryIt ?? []).filter((link) => reachable(link.route)));
	const shots = $derived(doc.shots ?? []);
	const guideHref = $derived(SHOWCASE_GUIDE[slug] ?? null);
	// Reactive, not read once: `locale.svelte.ts` overwrites `getLocale` with a rune, so the picker
	// retitles these links without a reload, the same way it rewrites every `m.*()` string.
	const locale = $derived(getLocale());
</script>

<PageHead title={doc.title} description={doc.description} />

<article class="showcase">
	<header class="showcase__hero">
		<p class="showcase__eyebrow">
			<a href={resolve('/about')}>{m.showcase_eyebrow()}</a>
			<!-- "Design showcase" -->
		</p>
		<h1>{doc.title}</h1>
		{#each doc.lead as paragraph, i (paragraph)}
			<p class="showcase__lead" class:showcase__lead--first={i === 0}>{paragraph}</p>
		{/each}
		<aside class="showcase__notice">
			{#if shots.length > 0}
				{m.showcaseTry_noticeWithShots()}
				<!-- "The framed samples on this page are sample data… The pictures marked “Screenshot” are of the running site…" -->
			{:else}
				{m.showcase_notice()}
				<!-- "The framed samples on this page are sample data… nothing in them can be clicked…" -->
			{/if}
		</aside>
		{#if featureOff}
			<aside class="showcase__notice showcase__notice--off">{m.showcase_flagOff()}</aside>
			<!-- "A moderator has this part of the site switched off right now…" -->
		{/if}
		{#if tryLinks.length > 0 || guideHref}
			<nav class="showcase__try" aria-labelledby="showcase-try">
				<h2 id="showcase-try">{m.showcaseTry_heading()}</h2>
				<!-- "Try it yourself" -->
				<ul>
					{#each tryLinks as link (link.route)}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- every href comes from SHOWCASE_LIVE in components/showcase/hrefs.ts (built from resolve() per route), through liveHref()'s localizedPath -->
							<a class="showcase__try-link" href={liveHref(link.route)}>{link.label}&nbsp;→</a>
						</li>
					{/each}
					{#if guideHref}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the href comes from SHOWCASE_GUIDE in components/showcase/hrefs.ts, built from resolve() per chapter -->
							<a class="showcase__guide-link" href={guideHref}>{m.showcaseTry_readGuide()}</a>
							<!-- "Read the manual chapter" -->
						</li>
					{/if}
				</ul>
			</nav>
		{/if}
	</header>

	{#if doc.points && doc.points.length > 0}
		<dl class="showcase__points">
			{#each doc.points as point (point.heading)}
				<div class="showcase__point">
					<dt>{point.heading}</dt>
					<dd>{point.body}</dd>
				</div>
			{/each}
		</dl>
	{/if}

	{#if shots.length > 0}
		<section class="showcase__shots" aria-labelledby="showcase-shots">
			<h2 id="showcase-shots">{m.showcaseTry_shotsHeading()}</h2>
			<!-- "On the real site" -->
			<div class="showcase__shots-grid">
				{#each shots as shot (shot.src)}
					<ShowcaseShot
						{shot}
						href={shot.route && reachable(shot.route) ? liveHref(shot.route) : null}
					/>
				{/each}
			</div>
		</section>
	{/if}

	{@render children()}

	{#if doc.closing}
		<p class="showcase__closing">{doc.closing}</p>
	{/if}

	<nav class="showcase__others" aria-labelledby="showcase-others">
		<h2 id="showcase-others">{m.showcase_othersHeading()}</h2>
		<!-- "The other pages in this showcase" -->
		<ul>
			{#each others as other (other.slug)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- every href comes from SHOWCASE_HREF in components/showcase/hrefs.ts, which is built from resolve() per route -->
					<a href={SHOWCASE_HREF[other.slug]}>{other.titleFor(locale)}</a>
				</li>
			{/each}
		</ul>
		<p class="showcase__back">
			<a href={resolve('/about')}>{m.showcase_backToAbout()}</a>
			<!-- "Back to About EdMat" -->
		</p>
	</nav>
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.showcase {
		max-width: 1000px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);

		:global(h2) {
			font-size: var(--font-size-lg);
			margin-bottom: var(--space-3);
		}
		p {
			line-height: 1.65;
		}
	}

	.showcase__hero {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-3);

		h1 {
			font-size: clamp(var(--font-size-xl), 4vw, 34px);
			line-height: 1.2;
			max-width: 28ch;
			margin: 0;
		}
	}
	.showcase__eyebrow {
		margin: 0;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.12em;

		a {
			color: var(--accent);
			text-decoration: none;
		}
		a:hover,
		a:focus-visible {
			text-decoration: underline;
		}
	}
	.showcase__lead {
		margin: 0;
		max-width: 68ch;
		color: var(--text-secondary);
	}
	.showcase__lead--first {
		font-size: var(--font-size-lg);
		color: var(--text-primary);
	}
	.showcase__notice {
		@include mix.card-surface;
		max-width: 70ch;
		padding: var(--space-3);
		background: var(--accent-soft);
		font-size: var(--font-size-sm);
		line-height: 1.6;
	}
	.showcase__notice--off {
		background: var(--status-warning-bg);
		color: var(--text-primary);
	}

	// "Try it yourself": real links, so they look like links a reader is meant to press — a row of
	// outlined pills, the manual link last and quieter. Wraps to as many lines as a phone needs.
	.showcase__try {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-base);
		}
		ul {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2) var(--space-3);
		}
	}
	.showcase__try-link {
		display: inline-block;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--accent);
		border-radius: 999px;
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
		font-size: var(--font-size-sm);
	}
	.showcase__try-link:hover,
	.showcase__try-link:focus-visible {
		background: var(--accent-soft);
	}
	.showcase__guide-link {
		font-size: var(--font-size-sm);
		color: var(--accent);
	}

	// Screenshots one under another, each at most its own (cropped) pixel width: two to a row made
	// a 1280-wide screen about 470 px wide, and its text unreadable — the first run of this, looked
	// at, showed exactly that. Each box carries its aspect ratio, so nothing reflows on load.
	.showcase__shots-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	// The claims. An accent rule above each one rather than a bullet, matching /about's pillars.
	.showcase__points {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		gap: var(--space-4);
	}
	.showcase__point {
		border-top: 2px solid var(--accent);
		padding-top: var(--space-3);

		dt {
			font-weight: 600;
			margin-bottom: var(--space-2);
		}
		dd {
			margin: 0;
			color: var(--text-secondary);
			font-size: var(--font-size-sm);
			line-height: 1.6;
		}
	}

	.showcase__closing {
		max-width: 70ch;
		margin: 0;
		color: var(--text-secondary);
	}

	.showcase__others {
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-4);

		ul {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-wrap: wrap;
			gap: var(--space-2) var(--space-4);
			font-size: var(--font-size-sm);
		}
	}
	.showcase__back {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
	}
</style>
