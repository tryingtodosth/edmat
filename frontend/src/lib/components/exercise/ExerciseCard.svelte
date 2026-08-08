<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedExercise } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import SaveToSetButton from '$lib/components/exercise/SaveToSetButton.svelte';
	import DifficultyBadge from '$lib/components/shared/DifficultyBadge.svelte';
	import SourceTypeBadge from '$lib/components/shared/SourceTypeBadge.svelte';
	import VerifiedBadge from '$lib/components/shared/VerifiedBadge.svelte';
	import StarRating from '$lib/components/shared/StarRating.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';

	let { exercise, courseName }: { exercise: ResolvedExercise; courseName?: string } = $props();

	/** Narrowed once here rather than tested inline: a `{#if}` on a property access does not narrow
	 * that property for the expressions inside the block. */
	const rating = $derived(exercise.averageRating);
</script>

<article class="exercise-card">
	<div class="exercise-card__top">
		<a class="exercise-card__title" href={resolve('/exercises/[id]', { id: exercise.id })}>
			<span class="exercise-card__number">{m.exercise_number({ number: exercise.number })}</span>
			<h3><MathTitle text={exercise.title} /></h3>
		</a>
		<SaveToSetButton exerciseId={exercise.id} />
	</div>

	{#if courseName}
		<p class="exercise-card__course">{courseName}</p>
	{/if}

	<div class="exercise-card__badges">
		<DifficultyBadge difficulty={exercise.difficulty} />
		<SourceTypeBadge sourceType={exercise.source.type} />
		<VerifiedBadge verified={exercise.verified} />
	</div>

	<div class="exercise-card__meta">
		{#if rating !== undefined}
			<StarRating value={rating} />
			<!-- "5 · 1" could be read as a range, a score out of something, or two unrelated numbers.
			     Spelled out instead: the average to one decimal, then how many people it is an
			     average OF, which is the part that says how much to trust it. -->
			<span class="muted">
				{m.review_ratingSummary({
					average: rating.toFixed(1),
					// `reviewCount` is optional on the type. A rating exists, so a count does too in
					// practice — but 0 is the honest fallback rather than printing "undefined".
					count: exercise.reviewCount ?? 0
				})}
			</span>
		{:else}
			<span class="muted">{m.review_noReviews()}</span>
		{/if}
	</div>
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.exercise-card {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.exercise-card__top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.exercise-card__title {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--text-primary);
		&:hover h3 {
			color: var(--accent);
		}
	}
	.exercise-card__number {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	h3 {
		font-size: var(--font-size-base);
		font-weight: 600;
	}
	.exercise-card__course {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.exercise-card__badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.exercise-card__meta {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	/* The save button's own styles moved into SaveToSetButton with it — the card no longer knows
	   anything about how saving looks, only where it goes. */
</style>
