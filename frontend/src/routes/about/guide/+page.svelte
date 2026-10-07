<script lang="ts">
	// The manual's hub: the chapter list, and an honest list of what has no chapter yet.
	//
	// A cousin of `/about` and `/legal` — a content module, a narrow measure, no fetch, prerendered.
	// The one piece of state it reads is the feature-flag store, for the same reason `/about` does:
	// a chapter about a surface that is switched off here is still worth reading (it is prose, and
	// knowing what the software can do is not the same as being able to do it today), so unlike a
	// nav link it is NOT removed — it is labelled. House rule 3 governs links to features; this is
	// a description of one.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { GUIDE_CHAPTERS, guideHubFor } from '$lib/content/guide';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import PageDiscussion from '$lib/components/discussion/PageDiscussion.svelte';

	const doc = $derived(guideHubFor(getLocale()));
	const locale = $derived(getLocale());

	function live(flag: string | null): boolean {
		if (flag === null) return true;
		return featureFlagsStore.isEnabled(flag as never) || authStore.isModerator;
	}
</script>

<PageHead title={doc.title} description={m.guide_seoDescription()} />
<!-- "A chapter-by-chapter user manual for EdMat, with screenshots of the real site." -->

<article class="guide-hub">
	<header class="guide-hub__head">
		<p class="guide-hub__eyebrow">{doc.eyebrow}</p>
		<h1>{doc.title}</h1>
		{#each doc.lead as paragraph (paragraph)}
			<p class="guide-hub__lead">{paragraph}</p>
		{/each}
		<p class="guide-hub__note">{m.guide_screenshotNote()}</p>
		<!-- "Every picture here is a screenshot of this site running, taken by a script against a test database." -->
	</header>

	<section class="guide-hub__section">
		<h2>{doc.chaptersHeading}</h2>
		<ol class="guide-hub__list">
			{#each GUIDE_CHAPTERS as chapter, index (chapter.slug)}
				<li class="guide-hub__item">
					<a
						class="guide-hub__link"
						href={resolve('/about/guide/[chapter]', { chapter: chapter.slug })}
					>
						<span class="guide-hub__number">{index + 1}</span>
						<span class="guide-hub__text">
							<span class="guide-hub__title">
								{chapter.titleFor(locale)}
								{#if chapter.pending}
									<span class="guide-hub__badge">{m.guide_pendingBadge()}</span>
									<!-- "Not written yet" -->
								{/if}
							</span>
							<span class="guide-hub__blurb">{chapter.blurbFor(locale)}</span>
							{#if !live(chapter.flag)}
								<span class="guide-hub__off">{m.guide_featureOff()}</span>
								<!-- "This part of the site is switched off here at the moment. The chapter still describes what it does." -->
							{/if}
						</span>
					</a>
				</li>
			{/each}
		</ol>
	</section>

	<section class="guide-hub__section guide-hub__gaps">
		<h2>{doc.gaps.heading}</h2>
		<p>{doc.gaps.body}</p>
		<ul>
			{#each doc.gaps.items as item (item)}
				<li>{item}</li>
			{/each}
		</ul>
	</section>

	<!-- The manual as a whole — "where do I start?" rather than a question about one
	     chapter, which belongs on that chapter. -->
	<PageDiscussion page="about/guide" title={doc.title} />
</article>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.guide-hub {
		max-width: 860px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);

		h2 {
			font-size: var(--font-size-lg);
			margin-bottom: var(--space-3);
		}
		p {
			line-height: 1.65;
		}
	}
	.guide-hub__head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h1 {
			font-size: clamp(var(--font-size-xl), 4vw, 34px);
			line-height: 1.2;
		}
	}
	.guide-hub__eyebrow {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent);
		margin: 0;
	}
	.guide-hub__lead {
		max-width: 62ch;
		color: var(--text-secondary);
		margin: 0;
	}
	.guide-hub__note {
		max-width: 62ch;
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		border-left: 3px solid var(--accent);
		padding-left: var(--space-3);
	}

	.guide-hub__list {
		list-style: none;
		counter-reset: chapter;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.guide-hub__item {
		@include mix.card-surface;
		display: flex;
	}
	.guide-hub__link {
		@include mix.focus-ring;
		display: flex;
		gap: var(--space-3);
		align-items: baseline;
		padding: var(--space-3);
		width: 100%;
		color: inherit;
		text-decoration: none;
		border-radius: inherit;

		&:hover {
			background: var(--bg-surface-alt);
		}
		&:hover .guide-hub__title {
			color: var(--accent);
		}
	}
	.guide-hub__number {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: var(--accent);
		min-width: 1.6em;
	}
	.guide-hub__text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.guide-hub__title {
		font-weight: 600;
	}
	.guide-hub__blurb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.guide-hub__badge {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		border: 1px solid var(--border-color);
		font-size: var(--font-size-xs);
		margin-left: var(--space-2);
	}
	.guide-hub__off {
		font-size: var(--font-size-sm);
		color: var(--status-warning);
	}

	.guide-hub__gaps {
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-4);

		p {
			max-width: 66ch;
			color: var(--text-secondary);
		}
		ul {
			margin: var(--space-3) 0 0;
			padding-left: 1.2em;
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
			color: var(--text-secondary);
		}
	}
</style>
