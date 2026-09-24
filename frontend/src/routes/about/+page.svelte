<script lang="ts">
	// The landing page. Its text lives in `lib/content/about.ts` rather than the message catalogue,
	// for the reason that file's header sets out — it is one piece of writing, reviewed as such in
	// both languages.
	//
	// Structurally a cousin of `/levels` and `/privacy` (a content module, a narrow measure, no API
	// call, prerendered), but it is the one standing page whose job is to be looked at rather than
	// read through, so it earns a wider measure, a feature grid and two coloured bands. Everything
	// visual is drawn from the theme tokens so it holds under both themes without a second stylesheet.
	//
	// Nothing here fetches. The one piece of state it reads is the feature-flag store, because a card
	// pointing at a killed surface is exactly the link house rule 3 says a kill switch has to remove;
	// `|| isModerator` mirrors `FeatureGate` and the backend's own staff bypass. Before the flags have
	// loaded the store fails open, so the prerendered HTML carries every card and a killed one
	// disappears on hydration — the same trade the header's nav makes.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { aboutDocFor, type AboutFeature } from '$lib/content/about';
	import { AUDIENCES, AUDIENCE_LABELS } from '$lib/utils/labels';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	const doc = $derived(aboutDocFor(getLocale()));

	const SOURCE_URL = 'https://github.com/tryingtodosth/edmat';

	function shown(feature: AboutFeature): boolean {
		return (
			feature.flag === null || featureFlagsStore.isEnabled(feature.flag) || authStore.isModerator
		);
	}
	const features = $derived(doc.features.filter(shown));

	// A signed-in reader has already done what "create an account" asks; offer the next step instead.
	// Submitting is itself a gated surface, so a signed-in reader with that switch off gets browse only.
	const canSubmit = $derived(
		authStore.isAuthenticated &&
			(featureFlagsStore.isEnabled('exercise_submissions') || authStore.isModerator)
	);

	// The band strip is the same seven values the audience chips on the front page use — read from the
	// shared label map so a renamed band cannot leave this page saying the old name.
	const bands = $derived(AUDIENCES.map((band) => AUDIENCE_LABELS[band]()));
</script>

<PageHead title={doc.title} description={m.seo_about_description()} />

<article class="about">
	<header class="about__hero">
		<p class="about__eyebrow">{doc.eyebrow}</p>
		<h1>{doc.title}</h1>
		{#each doc.lead as paragraph, i (paragraph)}
			<p class="about__lead" class:about__lead--first={i === 0}>{paragraph}</p>
		{/each}
		<div class="about__cta">
			<a class="btn-primary" href={resolve('/disciplines')}>{doc.ctaBrowse}</a>
			{#if canSubmit}
				<a class="btn-secondary" href={resolve('/submit')}>{doc.ctaSubmit}</a>
			{:else if !authStore.isAuthenticated}
				<a class="btn-secondary" href={resolve('/register')}>{doc.ctaRegister}</a>
			{/if}
		</div>
		<!-- The browsing path, drawn rather than described: the whole database hangs off these four
		     steps, and a reader who sees them knows the shape of the site before reading a paragraph. -->
		<ol class="about__path" aria-label={doc.pathLabel}>
			{#each doc.path as step, i (step)}
				<li>
					<span class="about__path-step">{step}</span>
					{#if i < doc.path.length - 1}<span class="about__path-arrow" aria-hidden="true">→</span
						>{/if}
				</li>
			{/each}
		</ol>
	</header>

	<section class="about__section about__origin">
		<div class="about__prose">
			<h2>{doc.origin.heading}</h2>
			{#each doc.origin.body as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}
		</div>
		<!-- An exercise's anatomy, as a card: the four fields every row in the corpus can carry. Static
		     and deliberately without real maths — a landing page must not pull the KaTeX chunk. -->
		<aside class="about__anatomy" aria-label={doc.anatomyLabel}>
			{#each doc.fields as field, i (field.label)}
				<div class="about__field" class:about__field--optional={i > 0}>
					<span class="about__field-label">{field.label}</span>
					<span class="about__field-note">{field.note}</span>
				</div>
			{/each}
		</aside>
	</section>

	<section class="about__section">
		<h2>{doc.featuresHeading}</h2>
		<p class="about__intro">{doc.featuresIntro}</p>
		<ul class="about__grid">
			{#each features as feature (feature.key)}
				<li class="about__card">
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the hrefs are the fixed route paths listed in lib/content/about.ts -->
					<a href={feature.href} class="about__card-link">
						<h3>{feature.title}</h3>
						<p>{feature.body}</p>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<section class="about__section about__band">
		<div class="about__band-inner">
			<h2>{doc.trust.heading}</h2>
			{#each doc.trust.body as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}
			<ul class="about__checks">
				{#each doc.trust.bullets ?? [] as bullet (bullet)}
					<li>{bullet}</li>
				{/each}
			</ul>
		</div>
	</section>

	<section class="about__section">
		<h2>{doc.audiences.heading}</h2>
		<ul class="about__bands" aria-label={doc.audiences.heading}>
			{#each bands as band (band)}
				<li>{band}</li>
			{/each}
		</ul>
		{#each doc.audiences.body as paragraph (paragraph)}
			<p>{paragraph}</p>
		{/each}
	</section>

	<section class="about__section about__pair">
		<div>
			<h2>{doc.money.heading}</h2>
			{#each doc.money.body as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}
		</div>
		<div>
			<h2>{doc.open.heading}</h2>
			{#each doc.open.body as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}
			<ul class="about__links">
				<li><a href={resolve('/privacy')}>{doc.links.privacy}</a></li>
				<li><a href={resolve('/levels')}>{doc.links.levels}</a></li>
				<li><a href={resolve('/legal')}>{doc.links.legal}</a></li>
				<li><a href={SOURCE_URL} rel="noopener">{doc.links.source}</a></li>
			</ul>
		</div>
	</section>

	<section class="about__section about__closing">
		<h2>{doc.closingTitle}</h2>
		<p>{doc.closingBody}</p>
		<a class="btn-primary" href={resolve('/disciplines')}>{doc.ctaBrowse}</a>
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

	// ---- hero -----------------------------------------------------------------------------------
	.about__hero {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding-top: var(--space-4);

		h1 {
			font-size: clamp(var(--font-size-xl), 4.5vw, 40px);
			line-height: 1.15;
			max-width: 22ch;
		}
	}
	.about__eyebrow {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent);
		margin: 0;
	}
	.about__lead {
		max-width: 62ch;
		color: var(--text-secondary);
		margin: 0;
	}
	.about__lead--first {
		font-size: var(--font-size-lg);
		color: var(--text-primary);
	}
	.about__cta {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.btn-primary {
		@include mix.button-primary;
		text-decoration: none;
	}
	.btn-secondary {
		@include mix.button-secondary;
		text-decoration: none;
	}

	.about__path {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-1);
		margin: var(--space-3) 0 0;
		padding: 0;

		li {
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
		}
	}
	.about__path-step {
		@include mix.card-surface;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-sm);
	}
	.about__path-arrow {
		color: var(--text-secondary);
	}

	// ---- origin + anatomy -----------------------------------------------------------------------
	.about__origin {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		gap: var(--space-5);
		align-items: start;
	}
	.about__prose p {
		max-width: 62ch;
	}
	.about__anatomy {
		@include mix.card-surface;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.about__field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-3);
		border-top: 1px solid var(--border-color);
		background: var(--bg-surface);

		&:first-child {
			border-top: 0;
			background: var(--accent-soft);
		}
	}
	.about__field-label {
		font-weight: 600;
	}
	.about__field-note {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
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

	// ---- trust band -----------------------------------------------------------------------------
	.about__band {
		background: var(--accent-soft);
		border-radius: var(--radius-lg);
		padding: var(--space-5) var(--space-4);
	}
	.about__band-inner {
		max-width: 66ch;
		margin: 0 auto;
	}
	.about__checks {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		li {
			position: relative;
			padding-left: 1.6em;
			line-height: 1.6;

			&::before {
				content: '✓';
				position: absolute;
				left: 0;
				color: var(--accent);
				font-weight: 700;
			}
		}
	}

	// ---- audiences ------------------------------------------------------------------------------
	.about__bands {
		list-style: none;
		margin: 0 0 var(--space-3);
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);

		li {
			@include mix.status-pill(var(--text-primary), var(--bg-surface-alt));
			border: 1px solid var(--border-color);
			font-size: var(--font-size-sm);
		}
	}
	.about__section > p {
		max-width: 66ch;
	}

	// ---- money / open pair ----------------------------------------------------------------------
	.about__pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: var(--space-5);
	}
	.about__links {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		font-size: var(--font-size-sm);
	}

	// ---- closing --------------------------------------------------------------------------------
	.about__closing {
		text-align: center;
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-5);
		display: flex;
		flex-direction: column;
		align-items: center;

		p {
			max-width: 52ch;
			color: var(--text-secondary);
		}
	}

	@media (max-width: 720px) {
		.about {
			gap: var(--space-5);
		}
		.about__origin {
			grid-template-columns: 1fr;
		}
		.about__band {
			padding: var(--space-4) var(--space-3);
		}
	}
</style>
