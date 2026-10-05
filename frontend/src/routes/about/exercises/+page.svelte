<script lang="ts">
	// `/about/exercises` — the first of the seven showcase pages (prompts/08-about-showcase.md).
	//
	// The cards are the real `ExerciseCard`, fed real `ResolvedExercise` objects from
	// `lib/content/showcase/exercises.ts`. They sit inside `SampleFrame`, whose `inert` wrapper is
	// what stops a reader clicking through to `/exercises/9001` — an id that exists in that content
	// file and in no database. See `SampleFrame`'s own header for why that is the honest answer.
	//
	// Nothing on this page is behind a FeatureFlag: browsing the corpus is the one thing EdMat does
	// that has no kill switch.
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { resolve } from '$app/paths';
	import { exercisesShowcaseFor } from '$lib/content/showcase/exercises';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import SampleFrame from '$lib/components/showcase/SampleFrame.svelte';
	import SampleRows from '$lib/components/showcase/SampleRows.svelte';
	import DeckTile from '$lib/components/showcase/DeckTile.svelte';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';

	const doc = $derived(exercisesShowcaseFor(getLocale()));
</script>

<ShowcasePage {doc} slug="exercises">
	<section>
		<h2>{doc.cardsHeading}</h2>
		<SampleFrame caption={doc.cardsCaption}>
			{#each doc.cards as sample (sample.exercise.id)}
				<ExerciseCard exercise={sample.exercise} courseName={sample.branchName} />
			{/each}
		</SampleFrame>
	</section>

	<section>
		<h2>{doc.facesHeading}</h2>
		<SampleFrame caption={doc.facesCaption}>
			<dl class="faces">
				{#each doc.faces as face (face.label)}
					<div class="faces__row">
						<dt>
							{face.label}
							<span class="faces__note">{face.note}</span>
						</dt>
						<dd><MathContent source={face.body} /></dd>
					</div>
				{/each}
			</dl>
		</SampleFrame>
	</section>

	<section>
		<h2>{doc.setHeading}</h2>
		<SampleFrame caption={doc.setCaption}>
			<SampleRows rows={doc.setRows} title={doc.setName} />
		</SampleFrame>
		<p class="more">
			<a href={resolve('/my-set')}>{doc.setLinkLabel}</a>
		</p>
	</section>

	<section>
		<h2>{doc.deckHeading}</h2>
		<SampleFrame caption={doc.deckCaption}>
			<DeckTile deck={doc.deck} />
		</SampleFrame>
		<p class="note">{doc.snapshotNote}</p>
		<p class="more">
			<a href={resolve('/disciplines')}>{doc.browseLinkLabel}</a>
		</p>
	</section>
</ShowcasePage>

<style lang="scss">
	// The four faces as a definition list: the label and its one-line note on the left, the rendered
	// content on the right. A table would promise a grid the fourth row (a whole worked solution)
	// cannot sit in.
	.faces {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.faces__row {
		display: grid;
		grid-template-columns: minmax(0, 14rem) minmax(0, 1fr);
		gap: var(--space-2) var(--space-4);
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);

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
	.faces__note {
		display: block;
		font-weight: 400;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.note {
		max-width: 70ch;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin: var(--space-3) 0 0;
	}
	.more {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
	}

	@media (max-width: 640px) {
		.faces__row {
			grid-template-columns: 1fr;
		}
	}
</style>
