<script lang="ts">
	/**
	 * The jury's page (CONTESTS-BRIEF.md §3.A item 6): a closed stage's submissions, a mark and a
	 * note per problem, the mean so far, and — for the organiser — the ranking the advance would
	 * produce, before they press anything.
	 *
	 * **Scoring starts when the stage closes**, and the refusal is not fussiness: a juror who can
	 * read answers while the stage is open can also tell an entrant how they are doing, and then
	 * the contest can no longer say its ranking came only from the published criteria.
	 *
	 * **Anonymised by default.** Jurors see a number. The server adds a name only for a caller who
	 * manages the contest, which is why this page never has to decide it.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ScoringMatrix from '$lib/components/contest/ScoringMatrix.svelte';
	import {
		advanceStage,
		getContest,
		getJudgingView,
		getRanking,
		getStages,
		refusalWord,
		saveScores
	} from '$lib/services/contests';
	import { contestRefusalMessage } from '$lib/utils/labels';
	import { resultTitleLabel, stageStatusLabel } from '$lib/utils/labels';
	import type { Contest, ContestStage, JudgingView, RankingRow } from '$lib/types/contest';

	let contest = $state<Contest | null>(null);
	let stages = $state<ContestStage[]>([]);
	let chosenStage = $state('');
	let view = $state<JudgingView | null>(null);
	let ranking = $state<RankingRow[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let refusal = $state('');
	let error = $state('');
	let message = $state('');
	let busy = $state(false);
	let loadedFor = $state('');
	let viewFor = $state('');

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
			stages = await getStages(id);
			// The stage a juror most likely came here for: the first closed one, else the last.
			const closed = stages.find((s) => s.status === 'closed');
			chosenStage = (closed ?? stages[stages.length - 1])?.id ?? '';
		} catch {
			notFound = true;
		} finally {
			loading = false;
		}
	}

	// A second keyed effect for the stage: switching stages must not re-fetch the contest.
	$effect(() => {
		if (!chosenStage || !contest) return;
		const key = `${chosenStage}:${authStore.user?.id ?? 'anon'}`;
		if (key === viewFor) return;
		viewFor = key;
		void loadStage(chosenStage);
	});

	async function loadStage(stageId: string) {
		refusal = '';
		view = null;
		ranking = [];
		try {
			view = await getJudgingView(stageId);
		} catch (thrown) {
			const word = refusalWord(thrown);
			refusal = word ? contestRefusalMessage(word) : m.common_error();
			return;
		}
		if (contest?.canManage) {
			try {
				ranking = await getRanking(contest.id);
			} catch {
				ranking = [];
			}
		}
	}

	async function onsave(
		submissionId: string,
		rows: { problem: string; points: number; note: string }[]
	) {
		busy = true;
		error = '';
		message = '';
		try {
			await saveScores(submissionId, rows);
			message = m.contests_marksSaved(); // "Your marks are saved."
			viewFor = '';
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	async function advance() {
		if (!chosenStage) return;
		busy = true;
		error = '';
		message = '';
		try {
			const result = await advanceStage(chosenStage);
			message = m.contests_advancedCount({ count: result.advanced });
			loadedFor = '';
			viewFor = '';
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}
</script>

<PageHead title={m.contests_judgePageTitle()} description={m.contests_judgePageDescription()} />
<!-- "Scoring" / "The jury's scoring matrix for a closed stage of a contest." -->

<FeatureGate feature="contests">
	<div class="page">
		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if notFound || !contest}
			<p class="muted">{m.contests_notFound()}</p>
		{:else if !contest.canScore}
			<p class="muted">{contestRefusalMessage('not_juror')}</p>
		{:else}
			<nav class="crumbs">
				<a href={resolve('/contests/[id]', { id: contest.id })}>{m.contests_backToContest()}</a>
			</nav>

			<header class="head">
				<h1>{m.contests_judgeHeading({ title: contest.title })}</h1>
				<!-- "Scoring: {title}" -->
				<p class="muted">{m.contests_judgeAnonymousNote()}</p>
				<!-- "Entrants are shown as numbers. You see every juror's marks, because a jury that cannot see each other's marks cannot discuss a ranking." -->
				{#if contest.meritCriteria}
					<details class="criteria">
						<summary>{m.contests_criteriaHeading()}</summary>
						<p>{contest.meritCriteria}</p>
					</details>
				{/if}
			</header>

			{#if stages.length > 1}
				<label class="pick">
					<span>{m.contests_judgePickStage()}</span>
					<!-- "Which stage" -->
					<select bind:value={chosenStage}>
						{#each stages as stage (stage.id)}
							<option value={stage.id}>
								{stage.title} — {stageStatusLabel(stage.status)()}
							</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if message}
				<p class="ok" role="status">{message}</p>
			{/if}
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			{#if refusal}
				<p class="muted">{refusal}</p>
			{:else if view}
				<ScoringMatrix {view} {onsave} {busy} />

				{#if contest.canManage && ranking.length > 0}
					<section class="preview">
						<h2>{m.contests_rankingPreviewHeading()}</h2>
						<!-- "Where the ranking stands" -->
						<p class="muted">{m.contests_rankingPreviewNote()}</p>
						<!-- "Recounted from the marks every time this page loads, and not published to anybody until you publish the results." -->
						<table>
							<thead>
								<tr>
									<th scope="col">{m.contests_colRank()}</th>
									<th scope="col">{m.contests_colWho()}</th>
									<th scope="col">{m.contests_colPoints()}</th>
									<th scope="col">{m.contests_colTitle()}</th>
								</tr>
							</thead>
							<tbody>
								{#each ranking as row (row.registration)}
									<tr>
										<td>{row.rank}</td>
										<td>#{row.number}</td>
										<td>{row.totalPoints}<span class="of">/{row.maxPoints}</span></td>
										<td>{resultTitleLabel(row.title)()}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						{#if view.stage.status === 'closed'}
							<button type="button" disabled={busy} onclick={advance}>
								{m.contests_stageAdvance()}
							</button>
						{/if}
					</section>
				{/if}
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 1000px;
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
	.muted {
		margin: 0.2rem 0 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.criteria {
		margin-top: 0.4rem;
		font-size: var(--font-size-sm);
	}
	.pick {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: var(--font-size-sm);
		max-width: 22rem;
	}
	.pick select {
		padding: 0.35rem 0.45rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.preview {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		padding: 0.7rem 0.9rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
		margin: 0.4rem 0;
	}
	th,
	td {
		text-align: left;
		padding: 0.3rem 0.4rem;
		border-bottom: 1px solid var(--border-color);
	}
	thead th {
		color: var(--text-secondary);
	}
	.of {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	button {
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
	}
	.ok {
		margin: 0;
		color: var(--status-success);
	}
	.error {
		margin: 0;
		color: var(--status-danger);
	}
</style>
