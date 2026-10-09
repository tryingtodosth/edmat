<script lang="ts">
	/**
	 * The published results (CONTESTS-BRIEF.md §3.A item 7), the complaints window, and the form
	 * for lodging one.
	 *
	 * **The complaints window is the legal heart of this page.** At least 14 days to lodge and 14
	 * to answer with reasons is the UOKiK norm — a 7-day window was entered in its register of
	 * abusive clauses — and the two kurator presets use 7 because the regulation's own practice is
	 * shorter. So the page shows the date the window closes, not just "you may complain", and the
	 * server's own `complainBlockReason` is what decides whether the form appears at all.
	 *
	 * **A minor does not lodge one themself** (CONTESTS-BRIEF.md §6 item 1): it is free text to a
	 * stranger, which this site closes for under-16s everywhere. The guardian asks the organiser,
	 * who records it — and that sentence is printed instead of a greyed-out button.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import RankingTable from '$lib/components/contest/RankingTable.svelte';
	import {
		getComplaints,
		getContest,
		getResults,
		lodgeComplaint,
		refusalWord
	} from '$lib/services/contests';
	import { contestRefusalMessage } from '$lib/utils/labels';
	import { formatDate } from '$lib/utils/datetime';
	import type { Contest, ContestComplaint, ResultsPayload } from '$lib/types/contest';

	let contest = $state<Contest | null>(null);
	let results = $state<ResultsPayload | null>(null);
	let complaints = $state<ContestComplaint[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state('');
	let message = $state('');
	let busy = $state(false);
	let text = $state('');
	let loadedFor = $state('');

	$effect(() => {
		const id = page.params.id;
		const key = `${id}:${authStore.user?.id ?? 'anon'}`;
		if (!id || key === loadedFor) return;
		loadedFor = key;
		void load(id);
	});

	async function load(id: string) {
		loading = true;
		notFound = false;
		try {
			contest = await getContest(id);
			results = await getResults(id);
			if (authStore.isAuthenticated) {
				try {
					complaints = await getComplaints(id);
				} catch {
					complaints = [];
				}
			}
		} catch {
			notFound = true;
		} finally {
			loading = false;
		}
	}

	async function lodge() {
		if (!contest) return;
		busy = true;
		error = '';
		message = '';
		try {
			await lodgeComplaint(contest.id, text.trim());
			text = '';
			message = m.contests_complaintLodged(); // "Your complaint was recorded. The organiser must answer it within the window, with reasons."
			loadedFor = '';
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	const canComplain = $derived(results?.complainBlockReason === null);
	const windowOpen = $derived(
		results?.complaintsCloseAt !== null &&
			results?.complaintsCloseAt !== undefined &&
			new Date(results.complaintsCloseAt).getTime() > Date.now()
	);
</script>

<PageHead
	title={m.contests_resultsPageTitle({ title: contest?.title ?? '' })}
	description={m.contests_resultsPageDescription()}
/>
<!-- "Results — {title}" / "The published ranking of a contest, and the window for complaining about it." -->

<FeatureGate feature="contests">
	<div class="page">
		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if notFound || !contest || !results}
			<p class="muted">{m.contests_notFound()}</p>
		{:else}
			<nav class="crumbs">
				<a href={resolve('/contests/[id]', { id: contest.id })}>{m.contests_backToContest()}</a>
			</nav>

			<header class="head">
				<h1>{m.contests_resultsHeading({ title: contest.title })}</h1>
				<!-- "Results: {title}" -->
				<p class="organiser">
					{m.contests_organisedBy({ name: contest.organiser?.displayName ?? '—' })}
				</p>
				{#if results.publishedAt}
					<p class="muted">
						{m.contests_resultsPublishedOn({ date: formatDate(results.publishedAt) })}
						<!-- "Published {date}" -->
					</p>
				{/if}
				<p class="muted">{m.contests_namesNote()}</p>
				<!-- "The list shows initials unless an entrant consented separately to their full name being published. That consent can be withdrawn at any time." -->
			</header>

			{#if !results.publishedAt}
				<p class="muted">{m.contests_noResultsYet()}</p>
			{:else}
				<RankingTable contestId={contest.id} rows={results.results} />
			{/if}

			{#if results.publishedAt}
				<section class="complaints">
					<h2>{m.contests_complaintsHeading()}</h2>
					<!-- "Complaints" -->
					{#if results.complaintsCloseAt}
						<p class={windowOpen ? 'muted' : 'warn'}>
							{windowOpen
								? m.contests_complaintsWindowOpen({
										date: formatDate(results.complaintsCloseAt),
										days: contest.complaintWindowDays
									})
								: m.contests_complaintsWindowShut({
										date: formatDate(results.complaintsCloseAt)
									})}
							<!-- "An entrant has {days} days to complain about the result — until {date}. The organiser must answer within the same period, with reasons. Going to court remains possible either way." / "The complaints window closed on {date}." -->
						</p>
					{/if}

					{#if canComplain}
						<form onsubmit={(event) => event.preventDefault()}>
							<label>
								<span>{m.contests_complaintLabel()}</span>
								<!-- "What is wrong with the result, and why" -->
								<textarea rows="4" bind:value={text}></textarea>
							</label>
							<button
								type="button"
								class="primary"
								disabled={busy || text.trim().length < 10}
								onclick={lodge}
							>
								{m.contests_complaintSend()}
								<!-- "Lodge the complaint" -->
							</button>
						</form>
					{:else if results.complainBlockReason === 'minor'}
						<p class="muted">{m.contests_complaintMinorNote()}</p>
						<!-- "An entrant under 16 does not lodge a complaint here — it is free text addressed to somebody they do not know. A parent or guardian should write to the organiser, who records the complaint and answers it." -->
					{:else if results.complainBlockReason}
						<p class="muted">{contestRefusalMessage(results.complainBlockReason)}</p>
					{/if}

					{#if message}
						<p class="ok" role="status">{message}</p>
					{/if}
					{#if error}
						<p class="error" role="alert">{error}</p>
					{/if}

					{#if complaints.length > 0}
						<ul class="list">
							{#each complaints as complaint (complaint.id)}
								<li>
									<p class="list__head">
										{complaint.isMine
											? m.contests_complaintMine()
											: m.contests_complaintFrom({ number: complaint.registrationNumber })}
										<!-- "Yours" / "Entrant #{number}" -->
										· {formatDate(complaint.createdAt)}
										· {complaint.status === 'open'
											? m.contests_complaintOpen()
											: complaint.status === 'answered'
												? m.contests_complaintAnswered()
												: m.contests_complaintWithdrawn()}
										<!-- "waiting for an answer" / "answered" / "withdrawn" -->
									</p>
									<p class="list__text">{complaint.text}</p>
									{#if complaint.answer}
										<blockquote>
											<p>{complaint.answer}</p>
											<footer>
												{complaint.answeredBy?.displayName ?? ''}
												{#if complaint.answeredAt}· {formatDate(complaint.answeredAt)}{/if}
											</footer>
										</blockquote>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

	.page {
		max-width: 820px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.crumbs {
		font-size: var(--font-size-sm);
	}
	h1 {
		margin: 0;
	}
	h2 {
		margin: 0 0 0.3rem;
		font-size: var(--font-size-md);
	}
	.organiser {
		margin: 0.2rem 0 0;
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.muted {
		margin: 0.2rem 0 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		max-width: 68ch;
	}
	.warn {
		margin: 0.2rem 0 0;
		font-size: var(--font-size-sm);
		border-left: 3px solid var(--status-neutral);
		padding-left: 0.6rem;
	}
	.complaints {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		padding: 0.7rem 0.9rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0.5rem 0;
		max-width: 44rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: var(--font-size-sm);
	}
	textarea {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		resize: vertical;
	}
	button {
		align-self: flex-start;
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		color: var(--text-primary);
		cursor: pointer;
	}
	button.primary {
		@include mix.button-primary;
	}
	button:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.list {
		list-style: none;
		margin: 0.6rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.list li {
		border-left: 3px solid var(--border-color);
		padding-left: 0.6rem;
	}
	.list__head {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.list__text {
		margin: 0.15rem 0 0;
		font-size: var(--font-size-sm);
	}
	blockquote {
		margin: 0.3rem 0 0;
		padding: 0.4rem 0.6rem;
		border-left: 3px solid var(--status-success);
		background: var(--bg-surface-alt);
		font-size: var(--font-size-sm);
	}
	blockquote p {
		margin: 0;
	}
	blockquote footer {
		margin-top: 0.2rem;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.ok {
		margin: 0.3rem 0 0;
		color: var(--status-success);
	}
	.error {
		margin: 0.3rem 0 0;
		color: var(--status-danger);
	}
</style>
