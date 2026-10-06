<script lang="ts">
	// One chapter of the manual. Static prose and static pictures from `lib/content/guide/` — no
	// fetch, nothing to sanitize (every `body` line is plain text), and the screenshots are ordinary
	// files under `static/guide/`, served by the same server as the page.
	//
	// The pictures are `loading="lazy"` and carry their own intrinsic width so the page does not
	// jump as they arrive; each is 1280 px wide and drawn at the measure, which is why the CSS caps
	// the width rather than the height.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { GUIDE_CHAPTERS, chapterBySlug } from '$lib/content/guide';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	const locale = $derived(getLocale());
	const slug = $derived(page.params.chapter ?? '');
	const entry = $derived(chapterBySlug(slug));
	const doc = $derived(entry?.docFor(locale));
	const index = $derived(GUIDE_CHAPTERS.findIndex((chapter) => chapter.slug === slug));
	const previous = $derived(index > 0 ? GUIDE_CHAPTERS[index - 1] : null);
	const next = $derived(
		index >= 0 && index < GUIDE_CHAPTERS.length - 1 ? GUIDE_CHAPTERS[index + 1] : null
	);
	const live = $derived(
		!entry || entry.flag === null
			? true
			: featureFlagsStore.isEnabled(entry.flag) || authStore.isModerator
	);
</script>

<PageHead
	title={doc ? doc.title : m.guide_unknownChapter()}
	description={doc ? (doc.lead[0] ?? m.guide_seoDescription()) : m.guide_seoDescription()}
/>
<!-- "There is no chapter under that address." / "A chapter-by-chapter user manual for EdMat, with screenshots of the real site." -->

<article class="chapter">
	<nav class="chapter__back">
		<a href={resolve('/about/guide')}>{m.guide_backToManual()}</a>
		<!-- "← All chapters" -->
	</nav>

	{#if !doc || !entry}
		<p class="chapter__missing">{m.guide_unknownChapter()}</p>
		<!-- "There is no chapter under that address." -->
	{:else}
		<header class="chapter__head">
			<p class="chapter__of">
				{m.guide_chapterOf({ index: index + 1, total: GUIDE_CHAPTERS.length })}
				<!-- "Chapter {index} of {total}" -->
			</p>
			<h1>{doc.title}</h1>
			{#each doc.lead as paragraph (paragraph)}
				<p class="chapter__lead">{paragraph}</p>
			{/each}
			{#if !live}
				<p class="chapter__off">{m.guide_featureOff()}</p>
				<!-- "This part of the site is switched off here at the moment. The chapter still describes what it does." -->
			{/if}
			{#if entry.showcase}
				<p class="chapter__showcase">
					<!-- `rel="external"` because the showcase pages are step G's and land in a separate
					     merge: the prerenderer CRAWLS the links on a prerendered page and fails the
					     build on a 404, so without this the manual could not be built before G has
					     merged. It costs a full page load instead of a client-side navigation on one
					     link. The integrator may drop it once /about/<feature> exists. -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed /about/<feature> path from lib/content/guide/index.ts -->
					<a href={entry.showcase} rel="external">{m.guide_seeTheDesign()}</a>
					<!-- "See the design →" -->
				</p>
			{/if}
		</header>

		<ol class="chapter__steps">
			{#each doc.steps as step, i (step.heading)}
				<li class="chapter__step">
					<h2>
						<span class="chapter__step-number">{i + 1}</span>
						{step.heading}
					</h2>
					{#each step.body as paragraph (paragraph)}
						<p>{paragraph}</p>
					{/each}
					{#if step.screenshot}
						<figure class="chapter__shot">
							<img
								src={step.screenshot.src}
								alt={step.screenshot.alt}
								width="1280"
								loading="lazy"
								decoding="async"
							/>
						</figure>
					{/if}
				</li>
			{/each}
		</ol>

		{#if doc.note}
			<p class="chapter__note">{doc.note}</p>
		{/if}

		<nav class="chapter__nav" aria-label={m.guide_backToManual()}>
			<!-- "← All chapters" -->
			{#if previous}
				<a
					class="chapter__nav-link"
					href={resolve('/about/guide/[chapter]', { chapter: previous.slug })}
				>
					{m.guide_previousChapter({ title: previous.titleFor(locale) })}
					<!-- "← {title}" -->
				</a>
			{:else}
				<span></span>
			{/if}
			{#if next}
				<a
					class="chapter__nav-link chapter__nav-link--next"
					href={resolve('/about/guide/[chapter]', { chapter: next.slug })}
				>
					{m.guide_nextChapter({ title: next.titleFor(locale) })}
					<!-- "{title} →" -->
				</a>
			{/if}
		</nav>
	{/if}
</article>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

	.chapter {
		max-width: 860px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-4) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);

		p {
			line-height: 1.7;
			max-width: 66ch;
		}
	}
	.chapter__back a {
		font-size: var(--font-size-sm);
	}
	.chapter__head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h1 {
			font-size: clamp(var(--font-size-xl), 4vw, 34px);
			line-height: 1.2;
		}
	}
	.chapter__of {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent);
		margin: 0;
	}
	.chapter__lead {
		color: var(--text-secondary);
		margin: 0;
	}
	.chapter__off {
		@include mix.card-surface;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		background: var(--accent-soft);
	}
	.chapter__showcase {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.chapter__missing {
		color: var(--text-secondary);
	}

	.chapter__steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.chapter__step {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			font-size: var(--font-size-lg);
			display: flex;
			align-items: baseline;
			gap: var(--space-2);
		}
		p {
			margin: 0;
		}
	}
	.chapter__step-number {
		font-size: var(--font-size-sm);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: var(--accent);
	}
	.chapter__shot {
		margin: var(--space-2) 0 0;

		img {
			display: block;
			width: 100%;
			height: auto;
			border: 1px solid var(--border-color);
			border-radius: var(--radius-md);
			background: var(--bg-surface);
		}
	}
	.chapter__note {
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.chapter__nav {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);
		font-size: var(--font-size-sm);
	}
	.chapter__nav-link--next {
		margin-left: auto;
		text-align: right;
	}

	@media (max-width: 720px) {
		.chapter {
			gap: var(--space-3);
		}
		.chapter__steps {
			gap: var(--space-4);
		}
	}
</style>
