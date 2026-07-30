<script lang="ts">
	import { resolve } from '$app/paths';
	import type { CoverageVoteSummary } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';

	// `question` (new): this widget is structurally identical for a MaterialRequirement's own vote
	// (`materials/[id]/+page.svelte`'s Requires group) — same CoverageVoteSummary shape, same
	// agree/disagree tally math — except the one line of framing text ("is this LEVEL accurate"
	// doesn't read right for "is this REQUIREMENT actually needed"). Widened with an optional
	// override rather than duplicating the whole component for that one difference, matching this
	// session's own "widen a structurally-reusable component" precedent (ReviewList.svelte).
	let {
		summary,
		onVote,
		onRetract,
		question = m.coverage_voteQuestion
	}: {
		summary: CoverageVoteSummary;
		onVote: (value: 1 | -1) => void;
		onRetract: () => void;
		question?: () => string;
	} = $props();

	let totalWeight = $derived(summary.agreeWeight + summary.disagreeWeight);
</script>

<div class="vote-widget">
	<p class="vote-widget__question">{question()}</p>

	{#if authStore.isAuthenticated}
		<div class="vote-widget__actions">
			<button
				type="button"
				class="vote-button vote-button--agree"
				class:vote-button--active={summary.currentUserVote === 1}
				onclick={() => (summary.currentUserVote === 1 ? onRetract() : onVote(1))}
			>
				👍 {m.coverage_agree()}
			</button>
			<button
				type="button"
				class="vote-button vote-button--disagree"
				class:vote-button--active={summary.currentUserVote === -1}
				onclick={() => (summary.currentUserVote === -1 ? onRetract() : onVote(-1))}
			>
				👎 {m.coverage_disagree()}
			</button>
		</div>
		{#if authStore.user?.isVerifiedContributor}
			<p class="vote-widget__hint">{m.coverage_verifiedWeightHint()}</p>
		{/if}
	{:else}
		<p class="login-prompt"><a href={resolve('/login')}>{m.coverage_loginToVote()}</a></p>
	{/if}

	<div class="vote-widget__tally">
		{#if totalWeight === 0}
			<span class="muted">{m.coverage_noVotesYet()}</span>
		{:else}
			<span class="tally-bar">
				<span class="tally-bar__agree" style:width="{(summary.agreeWeight / totalWeight) * 100}%"
				></span>
			</span>
			<span class="muted">
				{m.coverage_voteSummary({
					percent: summary.percentAgree ?? 0,
					agree: summary.agreeCount,
					disagree: summary.disagreeCount
				})}
			</span>
		{/if}
	</div>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.vote-widget {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.vote-widget__question {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.vote-widget__actions {
		display: flex;
		gap: var(--space-2);
	}
	.vote-button {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-sm);
	}
	.vote-button--active.vote-button--agree {
		background: var(--status-success-bg);
		border-color: var(--status-success);
		color: var(--status-success);
	}
	.vote-button--active.vote-button--disagree {
		background: var(--status-danger-bg);
		border-color: var(--status-danger);
		color: var(--status-danger);
	}
	.vote-widget__hint {
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-style: italic;
	}
	.vote-widget__tally {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.tally-bar {
		display: block;
		height: 6px;
		border-radius: var(--radius-sm);
		background: var(--status-danger-bg);
		overflow: hidden;
	}
	.tally-bar__agree {
		display: block;
		height: 100%;
		background: var(--status-success);
	}
	.muted {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.login-prompt {
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
</style>
