<script lang="ts">
	// The DSA Art. 11/12 point-of-contact page. Its text lives in `lib/content/legal.ts` rather
	// than the message catalogue, the same deliberate exception `privacy.ts`/`levels.ts` already
	// use — see that file's own header for why. Never behind the `issues` FeatureFlag or any other
	// kill switch: see backend/legal/models.py's own doc comment.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { legalContactPage } from '$lib/content/legal';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	const page = $derived(legalContactPage(getLocale()));
</script>

<PageHead title={m.legal_metaTitle()} description={m.seo_legal_description()} />

<article class="policy">
	<header class="policy__header">
		<h1>{page.title}</h1>
	</header>

	{#each page.intro as paragraph (paragraph)}
		<p class="policy__lead">{paragraph}</p>
	{/each}

	<p class="policy__cta">
		<a href={resolve('/legal/notice')}>{page.noticeLinkLabel}</a>
	</p>

	{#each page.sections as section (section.heading)}
		<section class="policy__section">
			<h2>{section.heading}</h2>
			{#each section.body as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}
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
		margin-bottom: var(--space-4);
	}
	.policy__lead {
		font-size: var(--font-size-lg);
		line-height: 1.6;
		margin-bottom: var(--space-3);
	}
	.policy__cta {
		margin: var(--space-4) 0 var(--space-5);
		font-weight: 600;
	}
	.policy__section {
		margin-top: var(--space-5);
		h2 {
			margin-bottom: var(--space-2);
		}
		p {
			line-height: 1.65;
			margin-bottom: var(--space-2);
		}
	}
</style>
