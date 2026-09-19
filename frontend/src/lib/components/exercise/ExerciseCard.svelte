<script lang="ts">
	import AudienceBadge from '$lib/components/shared/AudienceBadge.svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
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

	/** Everything inside the card that owns its own click. `[role="menu"]` and the action slot are
	 * both here for the save popover: its panel is rendered INSIDE the card, and a click that lands
	 * on the panel's padding or between two of its rows is not a request to leave the page — without
	 * these two, opening the menu and missing a row by three pixels navigates away from the card you
	 * were saving. `label` and the form controls cover the "new set" row inside that panel. */
	const OWN_CLICK =
		'a, button, input, textarea, select, label, [role="menu"], .exercise-card__actions';

	function openExercise(event: MouseEvent) {
		// A modified or non-primary click means "open it somewhere else", which the title link below
		// already does natively. Handling it here as well is how one click becomes two tabs.
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		// A click that came out of something with its own behaviour is that thing's click, not the
		// card's — including the title link, which navigates by itself. Letting both run is the
		// conflicting redirect this guard exists to prevent.
		if ((event.target as Element | null)?.closest(OWN_CLICK)) return;
		// A drag that ended with text selected was somebody copying a statement, not clicking a card.
		if (window.getSelection()?.toString()) return;
		// Spelled out here as well as on the link below rather than shared through one `const`:
		// `svelte/no-navigation-without-resolve` wants the `resolve()` call AT the navigation site,
		// and the rule is right that this is the place a wrong route would be noticed. The two must
		// name the same page, which is what `e2e/exercise-card-click.mjs` asserts by clicking both.
		goto(resolve('/exercises/[id]', { id: exercise.id }));
	}
</script>

<!-- The card is a pointer affordance for the link inside it, never a control of its own: the title
     stays a real `<a>`, so the tab stop, the focus ring, ctrl-click, middle-click and "open in new
     tab" all remain the browser's rather than ours. That is also why no key handler belongs here —
     a keyboard user already has the link, and a second Enter target on the same destination would
     be one more thing to tab past for nothing. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article class="exercise-card" onclick={openExercise}>
	<div class="exercise-card__top">
		<a class="exercise-card__title" href={resolve('/exercises/[id]', { id: exercise.id })}>
			<span class="exercise-card__number">{m.exercise_number({ number: exercise.number })}</span>
			<h3><MathTitle text={exercise.title} /></h3>
		</a>
		<!-- The wrapper is not cosmetic: it is what `OWN_CLICK` names, so the save control and its
		     whole open panel are excluded from the card's click in one place rather than by the card
		     knowing what a popover is made of. -->
		<div class="exercise-card__actions">
			<SaveToSetButton exerciseId={exercise.id} />
		</div>
	</div>

	{#if courseName}
		<p class="exercise-card__course">{courseName}</p>
	{/if}

	<div class="exercise-card__badges">
		<DifficultyBadge difficulty={exercise.difficulty} />
		<AudienceBadge audience={exercise.audience} />
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
		/* The whole card being the target has to be visible before the click, not discovered by it. */
		cursor: pointer;
		transition: border-color 0.12s ease;

		/* `:has()` keeps the affordance honest: hovering the save control is not hovering a link to
		   the exercise, and lighting the title up under it would promise a navigation that does not
		   happen. */
		&:hover:not(:has(.exercise-card__actions:hover)) {
			border-color: var(--accent);
			h3 {
				color: var(--accent);
			}
		}

		/* Keyboard equivalent of the hover: the anchor inside is what takes focus, and the card it
		   belongs to says so. */
		&:focus-within {
			border-color: var(--accent);
		}
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
	.exercise-card__actions {
		/* Inside the card's pointer area but not part of its click — so it should not claim to be. */
		cursor: default;
		flex-shrink: 0;
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
