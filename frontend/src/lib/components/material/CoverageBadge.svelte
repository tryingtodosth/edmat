<script lang="ts">
	import type { MaterialCoverage } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { coverageDepth } from '$lib/utils/coverage';

	let { coverage, onclick }: { coverage: MaterialCoverage; onclick: () => void } = $props();

	let depth = $derived(coverageDepth(coverage.level));
	let label = $derived(coverage.subtopicName ?? coverage.topicName);

	const depthLabels = {
		light: m.coverage_depth_light,
		moderate: m.coverage_depth_moderate,
		deep: m.coverage_depth_deep
	};
</script>

<!-- A clickable badge, not a plain pill — opens the verification popover (discussion + weighted
	 vote) for this exact topic-subtopic-level claim. Compact by necessity (several of these wrap on
	 one card), so it shows one bucketed depth label; the popover behind it spells out the same
	 number under both the requirement AND coverage framings in full — see that component's own
	 note on why the two aren't collapsed into one there. The tooltip here hints at both up front. -->
<button
	type="button"
	class="coverage-badge coverage-badge--{depth}"
	{onclick}
	title={m.coverage_badgeTitle({ level: coverage.level })}
>
	<span class="coverage-badge__label">{label}</span>
	<span class="coverage-badge__depth">{depthLabels[depth]()}</span>
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
		// from `--light` above rather than blurring into `--deep`'s own filled treatment below —
		// the two used to be the same pale-pill shape in different hues, which read as near-
		// identical at a glance (especially to anyone with a color-vision deficiency skimming a
		// grid of these).
		color: var(--status-info);
		background: var(--status-info-bg);
		border-color: var(--status-info);
	}
	.coverage-badge--deep {
		// Filled (solid background, contrast-checked light text), not just another pale pill: the
		// strongest of the three depths gets the strongest visual weight. `--accent` on white
		// clears 5.8:1 in the light theme (AA for normal text needs 4.5:1) — well above the
		// 3.92:1 failure Phase 4's own accessibility pass already fixed once for
		// `$light-status-success`, so this reuses the same accent token without repeating that
		// mistake in a new spot. `--accent-contrast` is dark-on-teal in the dark theme, so it
		// stays correct there without a separate override.
		color: var(--accent-contrast);
		background: var(--accent);
		border-color: var(--accent);
		font-weight: 600;
	}
	.coverage-badge__label {
		// A topic/subtopic name is real, unbounded-length text, not a short fixed-vocabulary
		// label — truncate just the label (not the whole badge) so the depth/comment-count
		// suffixes stay visible, matching the identical fix already applied to MaterialCard's
		// own `.claim-chip` and TagChip's `.tag-chip__trigger`. `inline-block` (not the default
		// `inline`) is required for `text-overflow: ellipsis` to actually take effect at all.
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
	// The 0.75 opacity above is fine against `--light`/`--moderate`'s own pale backgrounds, but
	// blended over `--deep`'s solid fill it drops the depth/count text to ~4.07:1 — under the
	// 4.5:1 normal-text floor even though the full-opacity label right next to it clears 5.8:1.
	// Full opacity here keeps that sub-text at the same contrast as the label.
	.coverage-badge--deep .coverage-badge__depth,
	.coverage-badge--deep .coverage-badge__count {
		opacity: 1;
	}
</style>
