<script lang="ts">
	/** The jury's own screen: submissions down, problems across, a mark and a note in every cell.
	 *
	 * **Anonymised by default.** A juror sees a registration NUMBER, not a name — the server only
	 * adds the name for a caller who manages the contest. That is not politeness: a published
	 * ranking has to be traceable to the published criteria, and a juror who knows whose paper
	 * they are marking cannot prove to anybody afterwards that it was.
	 *
	 * **The mean so far is drawn, not stored.** Each cell shows every juror's mark that exists; the
	 * row total is the mean over jurors per problem, summed — the same recount the ranking uses, so
	 * the matrix and the ranking cannot disagree (house rule 5).
	 *
	 * "My scoring is complete" is a statement about this juror's own cells and is computed from
	 * them, so it cannot be ticked while a cell is empty.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import type { JudgingView } from '$lib/types/contest';

	interface Props {
		view: JudgingView;
		/** Called with the submission id and this juror's rows for it. */
		onsave: (
			submissionId: string,
			rows: { problem: string; points: number; note: string }[]
		) => Promise<void>;
		busy?: boolean;
	}

	let { view, onsave, busy = false }: Props = $props();

	/** `submissionId -> problemId -> {points, note}` for THIS juror, seeded from the server's cells
	 *  and edited in place. A plain object rather than a Map so `$state` tracks the nested writes
	 *  without `SvelteMap` (frontend/CLAUDE.md trap 7 is about mutable Set/Date in `$state`). */
	let drafts = $state<Record<string, Record<string, { points: string; note: string }>>>({});
	let openFor = $state('');
	let loadedFor = $state('');

	const myId = $derived(authStore.user?.id ?? '');

	// The id-changed guard every derived-from-props load needs (frontend/CLAUDE.md trap 2): keyed
	// on the stage AND on who is asking, because a session resolving later changes `myId`.
	$effect(() => {
		const key = `${view.stage.id}:${myId}`;
		if (key === loadedFor) return;
		loadedFor = key;
		const next: typeof drafts = {};
		for (const submission of view.submissions) {
			if (!submission.id) continue;
			next[submission.id] = {};
			for (const problem of view.problems) {
				const mine = submission.scores.find(
					(cell) => cell.problem === problem.id && cell.juror?.id === myId
				);
				next[submission.id][problem.id] = {
					points: mine ? String(mine.points) : '',
					note: mine?.note ?? ''
				};
			}
		}
		drafts = next;
	});

	function othersFor(submissionId: string, problemId: string) {
		const submission = view.submissions.find((s) => s.id === submissionId);
		if (!submission) return [];
		return submission.scores.filter(
			(cell) => cell.problem === problemId && cell.juror?.id !== myId
		);
	}

	function myCompletion(submissionId: string): { done: number; total: number } {
		const row = drafts[submissionId] ?? {};
		const done = view.problems.filter((p) => (row[p.id]?.points ?? '') !== '').length;
		return { done, total: view.problems.length };
	}

	/** Whether this juror has typed anything at all for this submission yet — "my scoring is
	 *  complete" is computed from the cells, never ticked by hand, so it cannot claim completion
	 *  while a cell is empty. */

	async function save(submissionId: string) {
		const row = drafts[submissionId] ?? {};
		const rows = view.problems
			.filter((p) => (row[p.id]?.points ?? '') !== '')
			.map((p) => ({
				problem: p.id,
				points: Number(row[p.id]?.points ?? 0),
				note: row[p.id]?.note ?? ''
			}));
		await onsave(submissionId, rows);
	}
</script>

{#if view.submissions.length === 0}
	<p class="empty">{m.contests_noSubmissions()}</p>
	<!-- "Nobody handed anything in for this stage." -->
{:else}
	<div class="matrix">
		{#each view.submissions as submission (submission.id)}
			{@const completion = myCompletion(submission.id ?? '')}
			<section class="row">
				<header>
					<h4>
						{m.contests_entrantNumber({ number: submission.registration.number })}
						<!-- "Entrant #{number}" -->
						{#if submission.registration.user}
							<span class="named">{submission.registration.user.displayName}</span>
						{/if}
						{#if submission.registration.teamName}
							<span class="named">{submission.registration.teamName}</span>
						{/if}
					</h4>
					<p class="row__total">
						{m.contests_pointsSoFar({ points: submission.points, max: view.stage.maxPoints })}
						<!-- "{points} of {max} so far" -->
						·
						{completion.done === completion.total
							? m.contests_myScoringComplete()
							: m.contests_myScoringIncomplete({
									done: completion.done,
									total: completion.total
								})}
						<!-- "your marks are complete" / "you have marked {done} of {total}" -->
					</p>
				</header>

				<table>
					<thead>
						<tr>
							<th scope="col">{m.contests_colProblem()}</th>
							<!-- "Problem" -->
							<th scope="col">{m.contests_colAnswer()}</th>
							<!-- "Answer" -->
							<th scope="col">{m.contests_colYourMark()}</th>
							<!-- "Your mark" -->
							<th scope="col">{m.contests_colOtherMarks()}</th>
							<!-- "Other jurors" -->
						</tr>
					</thead>
					<tbody>
						{#each view.problems as problem, index (problem.id)}
							{@const answer = submission.answers.find((a) => a.problemId === problem.id)}
							{@const myCell = drafts[submission.id ?? '']?.[problem.id]}
							<tr>
								<th scope="row">
									{index + 1}
									<span class="max">/{problem.points}</span>
								</th>
								<td class="answer">
									{#if answer?.text}
										<MathContent source={answer.text} />
									{:else}
										<span class="blank">{m.contests_answerBlank()}</span>
										<!-- "nothing written" -->
									{/if}
								</td>
								<td class="mark">
									<!-- The `{#if myCell}` is not defensive noise: `$effect` runs AFTER the first
									     render, so on the very first paint `drafts` is still `{}` and
									     `drafts[sub][problem].points` would throw on a null reference — a crash
									     `svelte-check` passes clean and a browser finds in one click
									     (frontend/CLAUDE.md house rule 2). The inputs appear one tick later.

									     `type="text"` + inputmode, never `type="number"`: `bind:value` on a
									     number input binds a real number and the `=== ''` comparisons above
									     would then never match (frontend/CLAUDE.md trap 1). -->
									{#if myCell}
										<input
											type="text"
											inputmode="decimal"
											aria-label={m.contests_colYourMark()}
											bind:value={myCell.points}
										/>
										<input
											type="text"
											class="note"
											placeholder={m.contests_notePlaceholder()}
											aria-label={m.contests_notePlaceholder()}
											bind:value={myCell.note}
										/>
									{/if}
								</td>
								<td class="others">
									{#each othersFor(submission.id ?? '', problem.id) as cell (cell.juror?.id)}
										<span class="other">
											{cell.points}
											<span class="other__who">{cell.juror?.displayName}</span>
										</span>
									{:else}
										<span class="blank">—</span>
									{/each}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>

				<div class="row__actions">
					<button
						type="button"
						class="primary"
						disabled={busy}
						onclick={() => save(submission.id ?? '')}
					>
						{m.contests_saveMarks()}
						<!-- "Save my marks" -->
					</button>
					<button
						type="button"
						onclick={() => (openFor = openFor === submission.id ? '' : (submission.id ?? ''))}
					>
						{openFor === submission.id ? m.contests_hideAnswers() : m.contests_showAnswers()}
						<!-- "Hide the full answers" / "Show the full answers" -->
					</button>
				</div>

				{#if openFor === submission.id}
					<div class="full">
						{#each view.problems as problem, index (problem.id)}
							{@const answer = submission.answers.find((a) => a.problemId === problem.id)}
							<article>
								<h5>{index + 1}. {problem.title}</h5>
								<MathContent source={problem.statement} />
								<h6>{m.contests_theAnswer()}</h6>
								<!-- "The answer" -->
								{#if answer?.text}
									<MathContent source={answer.text} />
								{:else}
									<p class="blank">{m.contests_answerBlank()}</p>
								{/if}
							</article>
						{/each}
					</div>
				{/if}
			</section>
		{/each}
	</div>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.matrix {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.row {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		padding: 0.7rem 0.9rem;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.4rem;
		align-items: baseline;
	}
	h4 {
		margin: 0;
		font-size: var(--font-size-md);
	}
	.named {
		font-size: var(--font-size-sm);
		font-weight: 400;
		color: var(--text-secondary);
	}
	.row__total {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 0.5rem;
		font-size: var(--font-size-sm);
	}
	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: 0.3rem 0.4rem;
		border-bottom: 1px solid var(--border-color);
	}
	thead th {
		color: var(--text-secondary);
	}
	.max {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.answer {
		max-width: 28rem;
	}
	.mark {
		white-space: nowrap;
	}
	.mark input {
		padding: 0.25rem 0.35rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		width: 3.5rem;
	}
	.mark input.note {
		width: 10rem;
		margin-left: 0.3rem;
	}
	.other {
		display: inline-flex;
		gap: 0.2rem;
		align-items: baseline;
		margin-right: 0.4rem;
	}
	.other__who {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.blank {
		color: var(--text-secondary);
		font-style: italic;
	}
	.row__actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}
	button {
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
	.full {
		margin-top: 0.6rem;
		border-top: 1px solid var(--border-color);
		padding-top: 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	h5,
	h6 {
		margin: 0 0 0.2rem;
		font-size: var(--font-size-sm);
	}
	h6 {
		margin-top: 0.4rem;
		color: var(--text-secondary);
	}
	.empty {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}

	@media (max-width: 720px) {
		.mark input.note {
			width: 6rem;
		}
	}
</style>
