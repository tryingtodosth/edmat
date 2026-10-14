<script lang="ts">
	// The terms of use (regulamin). Text in `lib/content/terms.ts`, for the same reason the privacy
	// policy keeps its text in `lib/content/privacy.ts` — see that file's header. The layout mirrors
	// /privacy on purpose: two legal documents should read as a pair.
	//
	// Prerendered and reachable without an account, because the law (u.ś.u.d.e. art. 8) requires the
	// terms to be available BEFORE anyone agrees to them, in a form that can be saved and printed.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { termsOfUseFor } from '$lib/content/terms';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	const terms = $derived(termsOfUseFor(getLocale()));
	const headed = $derived(
		terms.sections.map((s, i) => ({ heading: s.heading, i })).filter((s) => s.heading)
	);
</script>

<!-- "Terms of use" / "The rules for using EdMat: accounts, minors, your content and its licence, …" -->
<PageHead title={m.terms_metaTitle()} description={m.seo_terms_description()} />

<article class="policy">
	<header class="policy__header">
		<h1>{terms.title}</h1>
		<p class="policy__updated">{terms.updated}</p>
		<p class="policy__related">
			<a href={resolve('/privacy')}>{m.footer_privacy()}</a>
			·
			<a href={resolve('/legal')}>{m.footer_legal()}</a>
			<!-- "Privacy policy" · "Legal & content notices" -->
		</p>
	</header>

	{#each terms.intro as paragraph (paragraph)}
		<p class="policy__lead">{paragraph}</p>
	{/each}

	<!-- "Contents" -->
	<nav class="policy__toc" aria-label={m.terms_contents()}>
		<h2>{m.terms_contents()}</h2>
		<ol>
			{#each headed as entry (entry.i)}
				<li><a href={`#s${entry.i}`}>{entry.heading}</a></li>
			{/each}
		</ol>
	</nav>

	<!-- Keyed by index: a section may have no heading of its own (it continues the one above). -->
	{#each terms.sections as section, i (i)}
		<section
			class="policy__section"
			class:policy__section--cont={!section.heading}
			id={section.heading ? `s${i}` : undefined}
		>
			{#if section.heading}<h2>{section.heading}</h2>{/if}

			{#each section.body ?? [] as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}

			{#if section.bullets}
				<ul>
					{#each section.bullets as bullet (bullet)}
						<li>{bullet}</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
</article>

<style lang="scss">
	.policy {
		max-width: 46rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-6);
	}
	.policy__header {
		margin-bottom: var(--space-5);
	}
	.policy__updated,
	.policy__related {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.policy__related a {
		color: var(--accent);
	}
	.policy__lead {
		font-size: var(--font-size-lg);
		line-height: 1.6;
		margin-bottom: var(--space-3);
	}
	.policy__toc {
		margin-top: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);

		h2 {
			font-size: var(--font-size-base);
			margin-bottom: var(--space-2);
		}
		ol {
			list-style: none;
			margin: 0;
			padding: 0;
			font-size: var(--font-size-sm);
			line-height: 1.7;
		}
		a {
			color: var(--accent);
		}
	}
	.policy__section {
		margin-top: var(--space-5);
		scroll-margin-top: var(--space-6);

		&--cont {
			margin-top: var(--space-2);
		}
		h2 {
			margin-bottom: var(--space-2);
		}
		p {
			line-height: 1.65;
			margin-bottom: var(--space-2);
		}
		ul {
			margin: 0 0 var(--space-2) var(--space-4);
			line-height: 1.65;
		}
		li {
			margin-bottom: var(--space-1);
		}
	}

	/* Printing is how a reader keeps a copy (u.ś.u.d.e. art. 8 ust. 1 pkt 2), so the contents box
	   and the links row add nothing on paper. */
	@media print {
		.policy__toc,
		.policy__related {
			display: none;
		}
	}
</style>
