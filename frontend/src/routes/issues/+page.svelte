<script lang="ts">
	// The public list of site issue reports — the ones their reporters allowed to be shown — with a
	// status filter and, for staff, the private ones too. Gated like every other feature route.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getIssues } from '$lib/services/issues';
	import { authStore } from '$lib/state/auth.svelte';
	import { issueReportStore } from '$lib/state/issueReport.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { Issue, IssueStatus } from '$lib/types/issue';
	import { ISSUE_KIND_LABELS, ISSUE_STATUSES, ISSUE_STATUS_LABELS } from '$lib/utils/issueLabels';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';

	let issues = $state<Issue[]>([]);
	let loading = $state(true);
	let statusFilter = $state<IssueStatus | ''>('');
	let includePrivate = $state(false);

	async function load() {
		loading = true;
		try {
			issues = await getIssues({ status: statusFilter, all: includePrivate });
		} catch {
			issues = [];
		}
		loading = false;
	}

	$effect(() => {
		// Re-run when either control changes; `authStore.isModerator` too, so a staff member who
		// ticks "include private" before their session resolves is not shown the public list forever.
		void statusFilter;
		void includePrivate;
		// Not while the kill switch is off: the gate hides the page, and a request the API will only
		// refuse is noise in the console for nothing.
		if (!featureFlagsStore.isLoaded) return;
		if (!(featureFlagsStore.isEnabled('issues') || authStore.isModerator)) return;
		load();
	});
</script>

<svelte:head>
	<title>{m.issues_heading()} · {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="issues">
	<div class="page">
		<div class="head">
			<h1>{m.issues_heading()}</h1>
			<!-- "Reported issues" -->
			<button type="button" class="button-primary" onclick={() => issueReportStore.open()}>
				{m.nav_reportIssue()}
			</button>
		</div>
		<p class="muted">{m.issues_intro()}</p>
		<!-- "Problems, ideas and questions people have sent about EdMat, shown here when the reporter allowed it. Anyone with an account can join the discussion under one." -->

		<div class="filters">
			<div class="chips" role="group" aria-label={m.issues_filterLabel()}>
				<button
					type="button"
					class="chip"
					class:chip--on={statusFilter === ''}
					onclick={() => (statusFilter = '')}
				>
					{m.issues_filterAll()}
					<!-- "All" -->
				</button>
				{#each ISSUE_STATUSES as status (status)}
					<button
						type="button"
						class="chip"
						class:chip--on={statusFilter === status}
						onclick={() => (statusFilter = status)}
					>
						{ISSUE_STATUS_LABELS[status]()}
					</button>
				{/each}
			</div>
			{#if authStore.isModerator}
				<label class="check">
					<input type="checkbox" bind:checked={includePrivate} />
					{m.issues_includePrivate()}
					<!-- "Include private reports (moderators only)" -->
				</label>
			{/if}
		</div>

		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if issues.length === 0}
			<p class="muted">{m.issues_empty()}</p>
			<!-- "Nothing here yet." -->
		{:else}
			<ul class="list">
				{#each issues as issue (issue.id)}
					<li class="row">
						<a class="row__title" href={resolve('/issues/[id]', { id: issue.id })}>{issue.title}</a>
						<span class="row__meta">
							<span class="pill pill--{issue.status}">{ISSUE_STATUS_LABELS[issue.status]()}</span>
							<span class="pill">{ISSUE_KIND_LABELS[issue.kind]()}</span>
							{#if !issue.isPublic}
								<span class="pill pill--private">{m.issues_private()}</span>
								<!-- "Private" -->
							{/if}
							<span class="muted">{m.issues_commentCount({ count: issue.commentCount })}</span>
							<!-- "{count} comments" -->
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.muted {
		color: var(--text-secondary);
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.chip {
		@include mix.focus-ring;
		border: 1px solid var(--border-color);
		border-radius: 999px;
		padding: 4px 10px;
		background: none;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		cursor: pointer;
		&.chip--on {
			border-color: var(--accent);
			color: var(--accent);
		}
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		@include mix.card-surface;
		padding: var(--space-2) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.row__title {
		font-weight: 600;
		color: var(--text-primary);
	}
	.row__meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		align-items: center;
		font-size: var(--font-size-sm);
	}
	.pill {
		@include mix.status-pill(var(--text-secondary), var(--bg-secondary));
	}
	.pill--open {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
	.pill--in_progress {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.pill--resolved {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.pill--private {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.button-primary {
		@include mix.button-primary;
	}
</style>
