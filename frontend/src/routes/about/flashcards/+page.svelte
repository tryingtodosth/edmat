<script lang="ts">
	// `/about/flashcards` — decks, a card with two faces, the four grades, and placement.
	//
	// `/flashcards` exists (step A merged long ago), so this page links it twice: in the shell's
	// "Try it yourself" row and under the sample decks. Both answer to the `flashcards` switch —
	// the row through `SHOWCASE_LIVE`, the inline link through `featureOff` below — so a killed
	// feature leaves no link behind. (Until 2026-10-14 this comment said the route did not exist;
	// that was true on the branch the page was written on, and stopped being true at the merge.)
	//
	// The flip card is the one live sample in the whole showcase (`SampleFrame live`): it flips and
	// it grades, and it writes nothing, because there is no deck behind it.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { flashcardsShowcaseFor, type ShowcaseGradeKey } from '$lib/content/showcase/flashcards';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import DiscussableSection from '$lib/components/discussion/DiscussableSection.svelte';
	import SampleFrame from '$lib/components/showcase/SampleFrame.svelte';
	import DeckTile from '$lib/components/showcase/DeckTile.svelte';
	import FlipCard from '$lib/components/showcase/FlipCard.svelte';

	const doc = $derived(flashcardsShowcaseFor(getLocale()));
	// `|| isModerator` mirrors `FeatureGate` and the backend's own staff bypass, exactly as the
	// feature cards on `/about` do. The store fails open before its first fetch resolves, so the
	// prerendered HTML carries no warning and one appears on hydration if the switch is off.
	const featureOff = $derived(
		!(featureFlagsStore.isEnabled('flashcards') || authStore.isModerator)
	);

	// The same four words the review screen puts on its buttons, and the same four this page's live
	// card uses — one map, so the table and the buttons cannot start disagreeing.
	const GRADE_LABEL: Record<ShowcaseGradeKey, () => string> = {
		again: () => m.showcase_gradeAgain(), // "Again"
		hard: () => m.showcase_gradeHard(), // "Hard"
		good: () => m.showcase_gradeGood(), // "Good"
		easy: () => m.showcase_gradeEasy() // "Easy"
	};

	// The sections readers may talk under, and the keys the server knows them by
	// (`backend/community/discussions.py`). The backend keeps no table of legal section
	// names, so the page that draws a section is the only thing that knows it exists.
	const DISCUSSION_SECTIONS = ['decks', 'card', 'grades', 'queue', 'placement'];
</script>

<ShowcasePage {doc} slug="flashcards" discussionSections={DISCUSSION_SECTIONS} {featureOff}>
	<DiscussableSection sectionKey="decks" title={doc.decksHeading}>
		<section>
			<h2>{doc.decksHeading}</h2>
			<SampleFrame caption={doc.decksCaption}>
				<div class="decks">
					{#each doc.decks as deck (deck.name)}
						<DeckTile {deck} />
					{/each}
				</div>
			</SampleFrame>
			{#if !featureOff}
				<p class="more">
					<a href={resolve('/flashcards')}>{doc.decksLinkLabel}</a>
				</p>
			{/if}
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="card" title={doc.cardHeading}>
		<section>
			<h2>{doc.cardHeading}</h2>
			<SampleFrame caption={doc.cardCaption} live>
				<FlipCard
					frontLabel={doc.card.frontLabel}
					backLabel={doc.card.backLabel}
					front={doc.card.front}
					back={doc.card.back}
					hint={doc.card.hint}
					grades={doc.grades}
				/>
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="grades" title={doc.gradesHeading}>
		<section>
			<h2>{doc.gradesHeading}</h2>
			<dl class="grades">
				{#each doc.grades as grade (grade.key)}
					<div class="grades__row">
						<dt>
							{GRADE_LABEL[grade.key]()}
							<span class="grades__days">
								{grade.days === 0
									? m.showcase_gradeNextToday() // "again today"
									: m.showcase_gradeNextIn({ days: grade.days })}
								<!-- "next in {days} days" -->
							</span>
						</dt>
						<dd>{grade.meaning}</dd>
					</div>
				{/each}
			</dl>
			<p class="note">{doc.gradesNote}</p>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="queue" title={doc.queueHeading}>
		<section>
			<h2>{doc.queueHeading}</h2>
			<SampleFrame caption={doc.queueCaption}>
				<ul class="queue">
					<li><strong>{doc.queue.due}</strong> <span>{doc.queueLabels.due}</span></li>
					<li><strong>{doc.queue.fresh}</strong> <span>{doc.queueLabels.fresh}</span></li>
					<li><strong>{doc.queue.learned}</strong> <span>{doc.queueLabels.learned}</span></li>
					<li><strong>{doc.queue.total}</strong> <span>{doc.queueLabels.total}</span></li>
				</ul>
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="placement" title={doc.placementHeading}>
		<section>
			<h2>{doc.placementHeading}</h2>
			{#each doc.placementBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.placementCaption}>
				<DeckTile deck={doc.placedDeck} />
			</SampleFrame>
		</section>
	</DiscussableSection>
</ShowcasePage>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.decks {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--space-3);
		align-items: start;
	}
	.queue {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);

		li {
			@include mix.card-surface;
			padding: var(--space-3);
			min-width: 9rem;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}
		strong {
			font-size: var(--font-size-xl);
			font-variant-numeric: tabular-nums;
		}
		span {
			font-size: var(--font-size-sm);
			color: var(--text-secondary);
		}
	}
	// The grade table: the word and what it does to the interval, readable without pressing
	// anything.
	.grades {
		margin: 0 0 var(--space-3);
		display: flex;
		flex-direction: column;
	}
	.grades__row {
		display: grid;
		grid-template-columns: minmax(0, 10rem) minmax(0, 1fr);
		gap: var(--space-2) var(--space-4);
		border-top: 1px solid var(--border-color);
		padding: var(--space-3) 0;

		&:first-child {
			border-top: 0;
		}
		dt {
			font-weight: 700;
		}
		dd {
			margin: 0;
			color: var(--text-secondary);
			line-height: 1.6;
		}
	}
	.grades__days {
		display: block;
		font-weight: 400;
		font-size: var(--font-size-sm);
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	.more {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
	}
	.body,
	.note {
		max-width: 70ch;
		margin: 0 0 var(--space-2);
	}
	.note {
		color: var(--text-secondary);
	}
</style>
