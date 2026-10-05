<script lang="ts">
	/**
	 * The one sample on these seven pages that a reader can actually operate: a flashcard you turn
	 * over and grade.
	 *
	 * It stores nothing, asks nothing and knows nothing. There is no deck behind it, no
	 * `ReviewState` row and no request — the "next review in N days" line reads a number out of
	 * `lib/content/showcase/flashcards.ts`, where it was written down as SM-2's arithmetic on one
	 * example card. That is the line `prompts/08-about-showcase.md` draws: a flip is fine, a grade
	 * that stores nothing is fine, anything that calls the API is not. The sentence under the
	 * buttons says so every time, rather than once at the top of the page.
	 *
	 * Both faces go through `MathContent`, so this is also the proof that the content pipeline
	 * typesets on a prerendered page — the card's front is real LaTeX in the real storage format.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import type { ShowcaseGradeKey } from '$lib/content/showcase/flashcards';

	let {
		frontLabel,
		backLabel,
		front,
		back,
		hint,
		grades
	}: {
		frontLabel: string;
		backLabel: string;
		front: string;
		back: string;
		hint: string;
		grades: { key: ShowcaseGradeKey; meaning: string; days: number }[];
	} = $props();

	let flipped = $state(false);
	let hintShown = $state(false);
	let graded = $state<ShowcaseGradeKey | null>(null);

	const GRADE_LABEL: Record<ShowcaseGradeKey, () => string> = {
		again: () => m.showcase_gradeAgain(), // "Again"
		hard: () => m.showcase_gradeHard(), // "Hard"
		good: () => m.showcase_gradeGood(), // "Good"
		easy: () => m.showcase_gradeEasy() // "Easy"
	};

	const chosen = $derived(graded ? grades.find((g) => g.key === graded) : undefined);
	const outcome = $derived(
		chosen
			? chosen.days === 0
				? m.showcase_gradeToday({ grade: GRADE_LABEL[chosen.key]() }) // "Graded “{grade}”: … later today…"
				: m.showcase_gradeInDays({ grade: GRADE_LABEL[chosen.key](), days: chosen.days }) // "… in {days} days…"
			: m.showcase_gradePrompt() // "Grade it, and see what the schedule would do."
	);
</script>

<div class="flip">
	<div class="flip__face">
		<p class="flip__label">{frontLabel}</p>
		<MathContent source={front} />
		{#if hint}
			<p class="flip__hint-row">
				<button type="button" class="flip__linklike" onclick={() => (hintShown = !hintShown)}>
					{hintShown ? m.showcase_hintHide() : m.showcase_hintShow()}
					<!-- "Hide the hint" / "Show the hint" -->
				</button>
			</p>
			{#if hintShown}
				<div class="flip__hint"><MathContent source={hint} /></div>
			{/if}
		{/if}
	</div>

	<button type="button" class="flip__turn" onclick={() => (flipped = !flipped)}>
		{flipped ? m.showcase_flipHide() : m.showcase_flipShow()}
		<!-- "Turn it back" / "Turn the card over" -->
	</button>

	{#if flipped}
		<div class="flip__face flip__face--back">
			<p class="flip__label">{backLabel}</p>
			<MathContent source={back} />
		</div>

		<div class="flip__grades">
			{#each grades as grade (grade.key)}
				<button
					type="button"
					class="flip__grade"
					class:flip__grade--chosen={graded === grade.key}
					aria-pressed={graded === grade.key}
					onclick={() => (graded = grade.key)}
				>
					{GRADE_LABEL[grade.key]()}
				</button>
			{/each}
		</div>
		<p class="flip__outcome" aria-live="polite">{outcome}</p>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.flip {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 44rem;
	}
	.flip__face {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--font-size-lg);
	}
	.flip__face--back {
		background: var(--accent-soft);
	}
	.flip__label {
		margin: 0;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}
	.flip__hint-row {
		margin: 0;
	}
	.flip__linklike {
		@include mix.focus-ring;
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		font: inherit;
		font-size: var(--font-size-sm);
		text-decoration: underline;
		cursor: pointer;
	}
	.flip__hint {
		font-size: var(--font-size-base);
		color: var(--text-secondary);
	}
	.flip__turn {
		@include mix.button-secondary;
		align-self: flex-start;
	}
	// Four buttons of equal weight, the way the review screen draws them — the word only. What each
	// grade MEANS is a table on the page around this, where it can be read without pressing
	// anything.
	.flip__grades {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.flip__grade {
		@include mix.focus-ring;
		@include mix.card-surface;
		cursor: pointer;
		padding: var(--space-2) var(--space-4);
		font: inherit;
		font-weight: 600;
		color: inherit;

		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.flip__grade--chosen {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.flip__outcome {
		@include mix.card-surface;
		margin: 0;
		padding: var(--space-3);
		background: var(--bg-surface-alt);
		font-size: var(--font-size-sm);
	}
</style>
