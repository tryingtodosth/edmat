<script lang="ts">
	/**
	 * The shell every `/about/<feature>` page uses: the head tags, the hero, the honest notice, the
	 * numbered claims, and the way back out.
	 *
	 * One shell rather than seven copies, because the thing that must be identical on all seven is
	 * the sentence saying nothing here is live. A page that forgot it would be the one page a reader
	 * mistook for the real thing.
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
	import { SHOWCASE_HREF } from './hrefs';
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
		<aside class="showcase__notice">{m.showcase_notice()}</aside>
		<!-- "Everything on this page is sample data…" -->
		{#if featureOff}
			<aside class="showcase__notice showcase__notice--off">{m.showcase_flagOff()}</aside>
			<!-- "A moderator has this part of the site switched off right now…" -->
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
