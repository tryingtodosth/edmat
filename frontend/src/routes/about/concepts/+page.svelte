<script lang="ts">
	// `/about/concepts` — one page per idea, written once per kind of reader, and the prerequisite
	// graph an exercise page reads as "before this, know…".
	//
	// `ConceptCard` is the real component; `PathSteps` is a twin, because on a real concept page
	// every title in the closure is resolved for the reader's own band and languages.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { conceptsShowcaseFor } from '$lib/content/showcase/concepts';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import SampleFrame from '$lib/components/showcase/SampleFrame.svelte';
	import DeckTile from '$lib/components/showcase/DeckTile.svelte';
	import PathSteps from '$lib/components/showcase/PathSteps.svelte';
	import ConceptCard from '$lib/components/concept/ConceptCard.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';

	const doc = $derived(conceptsShowcaseFor(getLocale()));
	const featureOff = $derived(!(featureFlagsStore.isEnabled('concepts') || authStore.isModerator));
</script>

<ShowcasePage {doc} slug="concepts" {featureOff}>
	<section>
		<h2>{doc.cardsHeading}</h2>
		<SampleFrame caption={doc.cardsCaption}>
			{#each doc.cards as concept (concept.slug)}
				<ConceptCard {concept} />
			{/each}
		</SampleFrame>
		<p class="more">
			<a href={resolve('/concepts')}>{doc.conceptsLinkLabel}</a>
		</p>
	</section>

	<section>
		<h2>{doc.audiencesHeading}</h2>
		{#each doc.audiencesBody as paragraph (paragraph)}
			<p class="body">{paragraph}</p>
		{/each}
		<SampleFrame caption={doc.audiencesCaption}>
			<dl class="versions">
				{#each doc.audienceVersions as version (version.band)}
					<div class="versions__row">
						<dt>{version.band}</dt>
						<dd><MathContent source={version.opening} /></dd>
					</div>
				{/each}
			</dl>
		</SampleFrame>
	</section>

	<section>
		<h2>{doc.pathHeading}</h2>
		{#each doc.pathBody as paragraph (paragraph)}
			<p class="body">{paragraph}</p>
		{/each}
		<SampleFrame caption={doc.pathCaption}>
			<PathSteps steps={doc.path} start={doc.pathFrom} />
		</SampleFrame>
	</section>

	<section>
		<h2>{doc.learnFirstHeading}</h2>
		<p class="body">{doc.learnFirstLead}</p>
		<SampleFrame caption={doc.learnFirstCaption}>
			<p class="learn-first__exercise">{doc.learnFirstExercise}</p>
			<ul class="learn-first__line">
				{#each doc.learnFirstItems as item (item)}
					<li class="learn-first__item">{item}</li>
				{/each}
			</ul>
		</SampleFrame>
	</section>

	<section>
		<h2>{doc.deckHeading}</h2>
		{#each doc.deckBody as paragraph (paragraph)}
			<p class="body">{paragraph}</p>
		{/each}
		<SampleFrame caption={doc.deckCaption}>
			<DeckTile deck={doc.deck} />
		</SampleFrame>
	</section>
</ShowcasePage>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.versions {
		margin: 0;
		display: flex;
		flex-direction: column;
	}
	.versions__row {
		display: grid;
		grid-template-columns: minmax(0, 11rem) minmax(0, 1fr);
		gap: var(--space-2) var(--space-4);
		border-top: 1px solid var(--border-color);
		padding: var(--space-3) 0;

		&:first-child {
			border-top: 0;
			padding-top: 0;
		}
		dt {
			font-weight: 600;
		}
		dd {
			margin: 0;
		}
	}
	.learn-first__exercise {
		margin: 0;
		font-weight: 600;
	}
	.learn-first__line {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
	}
	.learn-first__item {
		@include mix.status-pill(var(--text-primary), var(--bg-surface-alt));
		border: 1px solid var(--border-color);
		font-size: var(--font-size-sm);
	}
	.body {
		max-width: 70ch;
		margin: 0 0 var(--space-2);
	}
	.more {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
	}

	@media (max-width: 640px) {
		.versions__row {
			grid-template-columns: 1fr;
		}
	}
</style>
