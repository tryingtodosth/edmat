<script lang="ts">
	/**
	 * Usage analytics for staff (`backend/analytics/`). Every number is an aggregate counted on the
	 * server from the request log and the database; nothing is collected in the browser.
	 *
	 * Auth: sections are mounted only once the visitor is known to be a moderator, and each loads
	 * itself in an $effect (never at top level — SSR has no token). `authStore.ready` is waited
	 * for first, so a hard reload does not flash "access denied" before the session is restored.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ClientErrorsSection from '$lib/components/analytics/ClientErrorsSection.svelte';
	import ClientsSection from '$lib/components/analytics/ClientsSection.svelte';
	import CohortsSection from '$lib/components/analytics/CohortsSection.svelte';
	import CommunitySection from '$lib/components/analytics/CommunitySection.svelte';
	import ContentSection from '$lib/components/analytics/ContentSection.svelte';
	import CoverageSection from '$lib/components/analytics/CoverageSection.svelte';
	import HealthSection from '$lib/components/analytics/HealthSection.svelte';
	import ModerationSection from '$lib/components/analytics/ModerationSection.svelte';
	import OverviewPanel from '$lib/components/analytics/OverviewPanel.svelte';
	import PrivacyPanel from '$lib/components/analytics/PrivacyPanel.svelte';
	import TrafficSection from '$lib/components/analytics/TrafficSection.svelte';
	import { ANALYTICS_DAYS } from '$lib/services/analytics';
	import { authStore } from '$lib/state/auth.svelte';
	import type { AnalyticsDays } from '$lib/types/analytics';

	let days = $state<AnalyticsDays>(30);
	/** Bumped after a recompute so every section reloads. */
	let reloadKey = $state(0);
</script>

<PageHead title={m.analytics_pageTitle()} description={m.analytics_pageDescription()} noindex />
<!-- "Usage analytics" / "Staff-only usage statistics for EdMat." -->

<div class="page">
	<p class="back"><a href={resolve('/moderation')}>{m.analytics_back()}</a></p>
	<!-- "← Moderation" -->
	<h1>{m.analytics_heading()}</h1>
	<!-- "Usage analytics" -->

	{#if !authStore.ready || authStore.restoring}
		<p class="muted">{m.common_loading()}</p>
		<!-- "Loading…" -->
	{:else if !authStore.isModerator}
		<p class="muted">{m.moderation_accessDenied()}</p>
		<!-- "This page is only available to moderators." -->
	{:else}
		<p class="muted">{m.analytics_subtitle()}</p>
		<!-- "Aggregate numbers counted on the server. Nothing is collected in the visitor's browser." -->

		<div class="period" role="group" aria-label={m.analytics_period_label()}>
			<!-- "Period" -->
			{#each ANALYTICS_DAYS as d (d)}
				<button
					type="button"
					class:active={days === d}
					aria-pressed={days === d}
					onclick={() => (days = d)}
				>
					{m.analytics_period_days({ days: d })}<!-- "{days} days" -->
				</button>
			{/each}
		</div>

		<OverviewPanel {days} {reloadKey} onrecomputed={() => reloadKey++} />
		<TrafficSection {days} {reloadKey} />
		<ContentSection {days} {reloadKey} />
		<CoverageSection {days} {reloadKey} />
		<CommunitySection {days} {reloadKey} />
		<ModerationSection {days} {reloadKey} />
		<CohortsSection {days} {reloadKey} />
		<ClientsSection {days} {reloadKey} />
		<HealthSection {reloadKey} />
		<ClientErrorsSection {days} {reloadKey} />
		<PrivacyPanel />
	{/if}
</div>

<style lang="scss">
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		min-width: 0;
	}
	h1 {
		margin: var(--space-2) 0;
	}
	.back {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.muted {
		color: var(--text-secondary);
	}
	.period {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-3) 0;
	}
	.period button {
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-3);
		color: var(--text-primary);
		font-size: var(--font-size-sm);
	}
	.period button.active {
		background: var(--accent-soft);
		color: var(--accent);
		border-color: var(--accent);
		font-weight: 600;
	}
</style>
