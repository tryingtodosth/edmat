<script lang="ts">
	/**
	 * One contest preset, as `/about/contests` draws it: its name, what it is for, who the organiser
	 * is, and whether it promises a prize.
	 *
	 * **Why this is its own component and not `SampleRows`.** Every other sample on these pages is a
	 * row with a label, a title and a short fact, and `SampleRows` draws exactly that. A preset has
	 * one more thing to say and it is the load-bearing one: *does it promise a prize*. That single
	 * bit decides whether Polish law's whole public-promise regime applies (`CONTESTS-LAW.md` §13 g),
	 * so it is a chip and not a note at the end of a line — which is also why the prize-free chip
	 * reads as a fact rather than as something missing.
	 *
	 * **Not a copy of step A's `ContestCard`.** That one draws a real contest, with a status, dates
	 * and a call to action; this draws a *kind* of contest. They would diverge on the first change to
	 * either, and the thing they have in common is a heading and a paragraph.
	 *
	 * Drawn inside `SampleFrame`, so the whole group is `inert` — nothing here is clickable, and the
	 * frame's caption is what a screen reader gets.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { ShowcasePreset } from '$lib/content/showcase/contests';

	let { preset, organiserLabel }: { preset: ShowcasePreset; organiserLabel: string } = $props();
</script>

<article class="preset">
	<h3>{preset.name}</h3>
	<p class="preset__summary">{preset.summary}</p>
	<p class="preset__chips">
		<span class="preset__organiser">{organiserLabel}: {preset.organiser}</span>
		{#if preset.hasPrize}
			<span class="preset__chip preset__chip--prize">{m.contestsAbout_presetPrize()}</span>
			<!-- "promises a prize" -->
		{:else}
			<span class="preset__chip preset__chip--noprize">{m.contestsAbout_presetNoPrize()}</span>
			<!-- "no prize" -->
		{/if}
		{#if preset.staffOnly}
			<span class="preset__chip preset__chip--staff">{m.contestsAbout_presetStaffOnly()}</span>
			<!-- "platform operators only" -->
		{/if}
	</p>
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.preset {
		@include mix.card-surface;
		padding: var(--space-3);
		// `card-surface`'s own `--bg-surface` is kept rather than the alt one these cards first
		// used: `neutral-pill` IS the alt surface, so "bez nagrody" was an invisible pill on an
		// identical background — and that chip is the most important thing on the card, because it
		// is the one that says the public-promise rules do not apply. Found on the screenshot.
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h3 {
		margin: 0;
		font-size: var(--font-size-base);
	}
	.preset__summary {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		line-height: 1.6;
	}
	.preset__chips {
		margin: auto 0 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		font-size: var(--font-size-xs);
	}
	.preset__organiser {
		color: var(--text-secondary);
	}
	// The three chips use the status vocabulary as HISTORY.md §17BV fixed it: a promised prize is
	// `warning` because it is the thing that brings obligations with it, not because it is wrong;
	// no prize is `neutral`, a plain fact; staff-only is `info`, an open question for the reader
	// ("why can I not pick this one?"), answered by the paragraph above the grid.
	// `status-pill` already carries the padding, radius and size — these three only pick the pair.
	.preset__chip--prize {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.preset__chip--noprize {
		@include mix.neutral-pill;
	}
	.preset__chip--staff {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
</style>
