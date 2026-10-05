<script lang="ts">
	/**
	 * The frame every sample on a `/about/<feature>` page sits in.
	 *
	 * **Why the content is `inert`.** The samples are rendered with the app's own components, which
	 * means `ExerciseCard` links to `/exercises/9001` and `CourseCard` to `/courses/9100` — ids that
	 * exist in this file and nowhere else. Live, every card on these pages would be a dead end. So
	 * the rendered sample is marked `inert`: it cannot be clicked, cannot be tabbed into, and is
	 * taken out of the accessibility tree, which is the honest description of what it is — a picture
	 * of a component rather than the component in use.
	 *
	 * **Which is why `caption` is not decoration.** With the sample inert, the `<figcaption>` is
	 * what a screen reader gets, so it has to say what the picture shows rather than merely
	 * introduce it. Every caption in `lib/content/showcase/*` is written to that standard.
	 *
	 * The alternative — real ids pointing at seeded rows — was rejected by the brief: nothing is
	 * seeded into production tables for `/about`, which is the `/dziennik` posture (HISTORY §17BO).
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';

	let {
		caption,
		/** `true` for a sample a reader is meant to operate (the one flashcard demo). */
		live = false,
		children
	}: { caption: string; live?: boolean; children: Snippet } = $props();
</script>

<figure class="frame" class:frame--live={live}>
	<p class="frame__badge">
		<span class="frame__badge-word">{m.showcase_sampleBadge()}</span>
		<!-- "Sample" -->
		{#if !live}
			<span class="frame__badge-note">{m.showcase_sampleHint()}</span>
			<!-- "A picture, not a control — nothing on it can be clicked." -->
		{/if}
	</p>
	{#if live}
		<div class="frame__body">{@render children()}</div>
	{:else}
		<!-- See the header comment: inert is what stops a sample card navigating to a row that does
		     not exist, and what keeps it out of the accessibility tree the figcaption speaks for. -->
		<div class="frame__body" inert>{@render children()}</div>
	{/if}
	<figcaption>{caption}</figcaption>
</figure>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.frame {
		@include mix.card-surface;
		margin: var(--space-3) 0 0;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: var(--bg-surface-alt);
	}
	// A sample a reader can actually use looks different on purpose: the frame says "picture" by
	// default, and the one exception must not be mistaken for one.
	.frame--live {
		border-color: var(--accent);
		background: var(--bg-surface);
	}
	.frame__badge {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
		margin: 0;
		font-size: var(--font-size-xs);
	}
	.frame__badge-word {
		@include mix.status-pill(var(--text-primary), var(--bg-surface));
		border: 1px solid var(--border-color);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
	}
	.frame__badge-note {
		color: var(--text-secondary);
	}
	// The sample itself is given the ordinary page background, so a card inside it reads the way it
	// reads in the app rather than the way it reads on this page.
	.frame__body {
		background: var(--bg-page);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		overflow-x: auto;
	}
	figcaption {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		line-height: 1.6;
		max-width: 70ch;
	}

	@media (max-width: 560px) {
		.frame,
		.frame__body {
			padding: var(--space-2);
		}
	}
</style>
