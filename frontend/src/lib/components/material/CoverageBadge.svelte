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
	.coverage-badge--moderate {
		// Outlined, not filled: pale background plus a matching border so it reads as one step up
		// from `--light` above rather than blurring into `--deep`'s own filled treatment below.
		color: var(--status-info);
		background: var(--status-info-bg);
		border-color: var(--status-info);
	}
	.coverage-badge--deep {
		// Filled (solid background, contrast-checked light text): the strongest of the three depths
		// gets the strongest visual weight. `--accent` on white clears 5.8:1 in the light theme.
		color: var(--accent-contrast);
		background: var(--accent);
		border-color: var(--accent);
		font-weight: 600;
	}
	// A requirement is drawn in the warning hue instead of info/accent — "you need this first" is a
	// caution, and it must not be mistaken for "this is taught here" at a glance.
	.coverage-badge--requires.coverage-badge--moderate {
		color: var(--status-warning);
		background: var(--status-warning-bg);
		border-color: var(--status-warning);
	}
	.coverage-badge--requires.coverage-badge--deep {
		color: var(--accent-contrast);
		background: var(--status-warning);
		border-color: var(--status-warning);
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
	// Blended over a solid fill the 0.75 opacity drops the sub-text under the 4.5:1 floor, so it
	// goes back to full opacity there.
	.coverage-badge--deep .coverage-badge__depth,
	.coverage-badge--deep .coverage-badge__count {
		opacity: 1;
	}
</style>
