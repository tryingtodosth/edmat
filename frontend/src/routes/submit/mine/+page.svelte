<script lang="ts">
	// "What happened to the exercise I sent?" — every submission this account made through `/submit`,
	// with what became of it (WP14a, 2026-10-15; the first-visitor audit's finding 5).
	//
	// Its own address beside `/submit` rather than a section of `/users/{me}/unpublished`, for three
	// reasons. It needs no user id, so the form's success notice, a rejected-submission notification
	// and the form's own header can all link to one fixed place. It answers the SUBMITTER's question
	// ("is it through yet, and if not, why?"), where the unpublished page answers a different one
	// ("which of my published exercises has nobody been able to see?"). And it sits behind the same
	// `exercise_submissions` switch as the form, so killing the feature takes the list with it. The
	// unpublished page counts what is waiting here and links to it, so neither page claims the other
	// half does not exist.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import type { ExerciseSubmission, ModerationStatus } from '$lib/types';
	import { getMyExerciseSubmissions } from '$lib/services/submissions';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { formatDate } from '$lib/utils/format';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let submissions = $state<ExerciseSubmission[]>([]);
	let loading = $state(true);
	let failed = $state(false);
	let loadedFor: string | null = null;

	// Keyed on the signed-in account rather than run once in `onMount`: on a hard visit the session
	// is still being restored when this first runs (frontend/CLAUDE.md, Svelte trap 3).
	$effect(() => {
		const userId = authStore.user?.id ?? null;
		if (!userId || userId === loadedFor) return;
		loadedFor = userId;
		load();
	});

	async function load() {
		loading = true;
		failed = false;
		try {
			submissions = await getMyExerciseSubmissions(getLocale());
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	const STATUS_LABEL: Record<ModerationStatus, () => string> = {
		pending: () => m.wp14a_mine_status_pending(), // "Waiting for review"
		approved: () => m.wp14a_mine_status_approved(), // "Published"
		rejected: () => m.wp14a_mine_status_rejected() // "Not accepted"
	};

	const counts = $derived({
		pending: submissions.filter((s) => s.status === 'pending').length,
		approved: submissions.filter((s) => s.status === 'approved').length,
		rejected: submissions.filter((s) => s.status === 'rejected').length
	});

	// A material is a project now (coauthoring/), and its own list lives on the projects page —
	// linked only while that page is reachable, the same rule `/submit-material`'s success dialog
	// already follows for its link into one project.
	const materialsReachable = $derived(
		featureFlagsStore.isEnabled('coauthoring') || authStore.isModerator
	);
</script>

<svelte:head>
	<title>{pageTitle(m.wp14a_mine_heading())}</title>
</svelte:head>

<FeatureGate feature="exercise_submissions">
	<div class="page">
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/submit')}>{m.wp14a_mine_back()}</a>
			<!-- "← Add an exercise" -->
		</nav>
		<h1>{m.wp14a_mine_heading()}</h1>
		<!-- "Exercises you've sent" -->

		{#if authStore.restoring}
			<p class="muted">{m.common_loading()}</p>
		{:else if !authStore.isAuthenticated}
			<p data-session-hidden class="muted">
				<a href={resolve('/login')}>{m.wp14a_mine_login()}</a>
				<!-- "Sign in to see the exercises you've sent." -->
			</p>
		{:else}
			<p class="muted">{m.wp14a_mine_intro()}</p>
			<!-- "Everything you've sent through “Add an exercise”, and what became of it. Only you see this list." -->

			{#if loading}
				<p class="muted">{m.common_loading()}</p>
			{:else if failed}
				<p class="muted">{m.wp14a_mine_loadFailed()}</p>
				<!-- "This list could not be loaded. Try again in a moment." -->
			{:else if submissions.length === 0}
				<p class="muted">
					{m.wp14a_mine_empty()}
					<!-- "You haven't sent any exercises yet." -->
					<a href={resolve('/submit')}>{m.wp14a_mine_addFirst()}</a>
					<!-- "Add one →" -->
				</p>
			{:else}
				<p class="summary">
					{m.wp14a_mine_summary({
						pending: counts.pending,
						approved: counts.approved,
						rejected: counts.rejected
					})}
					<!-- "Waiting: {pending} · Published: {approved} · Not accepted: {rejected}" -->
				</p>
				<ul class="list">
					{#each submissions as submission (submission.id)}
						<li class="row" data-submission={submission.id} data-status={submission.status}>
							<div class="row__head">
								<span class="row__title"><MathTitle text={submission.draft?.title || '—'} /></span>
								<span class="pill pill--{submission.status}">
									{STATUS_LABEL[submission.status]()}
								</span>
							</div>
							<p class="row__meta">
								{m.wp14a_mine_meta({
									branch: submission.branchName ?? submission.branchId,
									date: formatDate(submission.createdAt, getLocale())
								})}
								<!-- "{branch} · sent {date}" -->
							</p>
							{#if submission.status === 'pending'}
								<p class="row__body">{m.wp14a_mine_pendingBody()}</p>
								<!-- "A moderator will look at it. You'll get a notification when they decide." -->
							{:else if submission.status === 'approved'}
								{#if submission.resultingExerciseId}
									<a
										class="row__link"
										href={resolve('/exercises/[id]', { id: submission.resultingExerciseId })}
										>{m.wp14a_mine_viewExercise()}</a
									>
									<!-- "Open the exercise →" -->
									<a
										class="row__link"
										href={resolve('/exercises/[id]/edit', { id: submission.resultingExerciseId })}
										data-edit-exercise>{m.wp14a_mine_editExercise()}</a
									>
									<!-- "Edit" — the submitter is the author, who edits in place -->
								{:else}
									<p class="row__body">{m.wp14a_mine_approvedGone()}</p>
									<!-- "It was published, and has since been removed." -->
								{/if}
							{:else}
								<p class="row__body">
									<span class="row__label">{m.wp14a_mine_reasonLabel()}</span>
									<!-- "Moderator's reason:" -->
									{submission.reviewNote ?? m.wp14a_mine_noReason()}
									<!-- "none given." -->
								</p>
							{/if}
						</li>
					{/each}
				</ul>
				<p>
					<a href={resolve('/submit')}>{m.wp14a_mine_addAnother()}</a>
					<!-- "Add another exercise →" -->
				</p>
				<!-- The licence of every accepted one at once (`/settings/licences`) — what the item page's
				     own "Change licence" does, many items in one go. -->
				<p class="muted small">
					<a href={resolve('/settings/licences')} data-testid="mine-licences-link"
						>{m.licbulk_mineLink()}</a
					>
					<!-- "Change the licence of several at once" -->
				</p>
			{/if}

			{#if materialsReachable}
				<p class="muted small">
					{m.wp14a_mine_materialsNote()}
					<!-- "Materials you've sent are on your projects page." -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() plus a query string the rule cannot see through -->
					<a href={`${resolve('/material-projects')}?tab=mine`}>{m.wp14a_mine_materialsLink()}</a>
					<!-- "Your projects →" -->
				</p>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	a {
		color: var(--accent);
		font-weight: 600;
	}
	.muted {
		color: var(--text-secondary);
	}
	.small {
		font-size: var(--font-size-sm);
	}
	.summary {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.list {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.row__head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-1) var(--space-2);
	}
	.row__title {
		font-weight: 600;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.row__meta {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.row__body {
		font-size: var(--font-size-sm);
		overflow-wrap: anywhere;
	}
	.row__label {
		font-weight: 600;
	}
	.row__link {
		font-size: var(--font-size-sm);
		align-self: flex-start;
	}
	// Three states, three of the vocabulary's own shapes: waiting is "not settled" (pending-pill),
	// published is done (success), not accepted is the danger pair — a decision against, said plainly.
	.pill--pending {
		@include mix.pending-pill;
	}
	.pill--approved {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.pill--rejected {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
</style>
