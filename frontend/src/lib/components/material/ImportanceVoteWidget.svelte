<script lang="ts">
	import { resolve } from '$app/paths';
	import type { CoverageVoteSummary } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';

	// The ordering vote on a claim — deliberately its own small widget rather than a second
	// `CoverageVoteWidget` with different words: that one is a percentage-agree tally about
	// whether a number is right, this one is a net rank about where the claim belongs in the list,
	// and dressing the second up as the first would invite reading "+3" as "75% agree".
	let {
		summary,
		onVote,
		onRetract
	}: {
		summary: CoverageVoteSummary;
		onVote: (value: 1 | -1) => void;
		onRetract: () => void;
	} = $props();

	let total = $derived(summary.agreeCount + summary.disagreeCount);
</script>

<div class="importance">
	<p class="importance__question">{m.coverage_importanceQuestion()}</p>
	<div class="importance__row">
		{#if authStore.isAuthenticated}
			<button
				type="button"
				class="rank-button"
				class:rank-button--active={summary.currentUserVote === 1}
				aria-pressed={summary.currentUserVote === 1}
				onclick={() => (summary.currentUserVote === 1 ? onRetract() : onVote(1))}
			>
				▲ {m.coverage_importanceUp()}
			</button>
			<button
				type="button"
				class="rank-button"
				class:rank-button--active={summary.currentUserVote === -1}
				aria-pressed={summary.currentUserVote === -1}
				onclick={() => (summary.currentUserVote === -1 ? onRetract() : onVote(-1))}
			>
				▼ {m.coverage_importanceDown()}
			</button>
		{:else}
			<a class="login" href={resolve('/login')}>{m.coverage_loginToVote()}</a>
		{/if}
		<span
			class="importance__net"
			class:importance__net--positive={summary.netWeight > 0}
			class:importance__net--negative={summary.netWeight < 0}
		>
			{#if total === 0}
				{m.coverage_importanceNone()}
			{:else}
				{m.coverage_importanceNet({
					net: (summary.netWeight > 0 ? '+' : '') + summary.netWeight,
					count: total
				})}
			{/if}
		</span>
	</div>
	<p class="importance__hint">{m.coverage_importanceHint()}</p>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.importance {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.importance__question {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.importance__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.rank-button {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-sm);
	}
	.rank-button--active {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent);
	}
	.importance__net {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-weight: 600;
	}
	.importance__net--positive {
		color: var(--status-success);
	}
	.importance__net--negative {
		color: var(--status-danger);
	}
	.importance__hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.login {
		font-size: var(--font-size-sm);
		color: var(--accent);
		font-weight: 600;
	}
</style>
