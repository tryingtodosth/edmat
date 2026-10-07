<script lang="ts">
	import type { MaterialCoverage } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { coverageDepth, depthLabel } from '$lib/utils/coverage';

	let { coverage, onclick }: { coverage: MaterialCoverage; onclick: () => void } = $props();

	let depth = $derived(coverageDepth(coverage.level));
	let label = $derived(coverage.subtopicName ?? coverage.topicName);
	let title = $derived(
		coverage.kind === 'requires'
			? m.coverage_badgeTitleRequires({ level: coverage.level }) // "Needs prior knowledge at {level}/100 — open to vote or discuss"
			: m.coverage_badgeTitle({ level: coverage.level }) // "Covers this to {level}/100 — open to vote or discuss"
	);
</script>

<!-- A clickable badge, not a plain pill — opens the popover (discussion + weighted vote + ranking
	 vote) for this one claim. Compact by necessity (several of these wrap on one card), so it shows
	 one bucketed label; the popover spells the number out. A `requires` claim is drawn in a
	 different hue from a `covers` one so the two groups can never be confused for each other when
	 they sit on the same card. -->
<button
	type="button"
	class="coverage-badge coverage-badge--{depth} coverage-badge--{coverage.kind}"
	{onclick}
	{title}
>
	<span class="coverage-badge__label">{label}</span>
	<span class="coverage-badge__depth">{depthLabel(coverage.kind, depth)}</span>
	{#if coverage.commentCount > 0}
		<span
			class="coverage-badge__count"
			title={m.coverage_commentCountTitle({ count: coverage.commentCount })}
			>💬 {coverage.commentCount}</span
		>
	{/if}
</button>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.coverage-badge {
		@include mix.focus-ring;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		font-weight: 500;
		border: 1px solid transparent;
		cursor: pointer;
		white-space: nowrap;
	}
	.coverage-badge--light {
		color: var(--text-secondary);
		background: var(--bg-surface-alt);
		border-color: var(--border-color);
	}
	// Depth is weight and border, not hue (2026-10-07 colour pass, after review): a claim is a fact,
	// and the info pair means "asks you" everywhere else. Light → plain, moderate → a border,
	// deep → a darker border and 600. A requirement reads the same ladder; the panel's own heading
	// ("Co jest wymagane") is what says it is a prerequisite.
	.coverage-badge--moderate {
		color: var(--text-secondary);
		background: var(--bg-surface-alt);
		border-color: var(--border-color);
	}
	.coverage-badge--deep {
		color: var(--text-primary);
		background: var(--bg-surface-alt);
		border-color: var(--text-secondary);
		font-weight: 600;
	}
	.coverage-badge:hover,
	.coverage-badge:focus-visible {
		color: var(--accent);
		border-color: var(--accent);
	}
	.coverage-badge__label {
		// A topic/subtopic name is real, unbounded-length text — truncate just the label (not the
		// whole badge) so the depth/comment-count suffixes stay visible. `inline-block` is required
		// for `text-overflow: ellipsis` to take effect at all.
		display: inline-block;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		vertical-align: bottom;
	}
	.coverage-badge__depth {
		opacity: 0.75;
	}
	.coverage-badge__count {
		opacity: 0.75;
	}
	// The strongest depth keeps its sub-text at full opacity: weight, not hue, is what separates
	// it from `--moderate`.
	.coverage-badge--deep .coverage-badge__depth,
	.coverage-badge--deep .coverage-badge__count {
		opacity: 1;
	}
</style>
