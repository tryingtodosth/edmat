<script lang="ts">
	/**
	 * One stage (CONTESTS-BRIEF.md §3.A item 5). Two completely different pages on one address:
	 *
	 * **For an entrant** — the problems, each one an exercise from the corpus rendered exactly as
	 * `/exercises/[id]` renders it (the same `MathContent`, the same pipeline), an answer box per
	 * problem, a countdown to the bell, autosave, and a submit that asks once. The statement is all
	 * the payload carries: `ContestProblemSerializer` sends no answer and no solution pool, so
	 * there is nothing here for a page to accidentally draw. Before the stage opens the problems
	 * are a 404 to them, which the service turns into `null` rather than an error — "not yet" is
	 * not a failure.
	 *
	 * **For the organiser** — the problem picker (search the corpus, add with points) and the
	 * open / close / advance controls, each with the sentence for whatever it refuses.
	 *
	 * The autosave is a debounce on the whole submission, not per answer: a contest answer box is a
	 * form somebody fills in and saves, and a per-answer endpoint would make "half handed in" a
	 * reachable state on the one page whose whole point is a deadline.
	 */
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import {
		addProblem,
		advanceStage,
		closeStage,
		getContest,
		getMySubmission,
		getProblems,
		getStage,
		openStage,
		refusalWord,
		removeProblem,
		saveMySubmission,
		submitMySubmission
	} from '$lib/services/contests';
	import { searchExercises } from '$lib/services/exercises';
	import { contestRefusalMessage } from '$lib/utils/labels';
	import { advancementLabel, stageStatusLabel } from '$lib/utils/labels';
	import { formatDateTime } from '$lib/utils/datetime';
	import type {
		Contest,
		ContestProblem,
		ContestStage,
		ContestSubmission
	} from '$lib/types/contest';
	import type { ResolvedExercise } from '$lib/types/exercise';

	let contest = $state<Contest | null>(null);
	let stage = $state<ContestStage | null>(null);
	let problems = $state<ContestProblem[] | null>(null);
	let submission = $state<ContestSubmission | null>(null);
	let answers = $state<Record<string, string>>({});
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state('');
	let message = $state('');
	let busy = $state(false);
	let confirming = $state(false);
	let loadedFor = $state('');

	// The organiser's picker.
	let query = $state('');
	let found = $state<ResolvedExercise[]>([]);
	let points = $state('5');
	let searching = $state(false);

	// A ticking clock for the countdown. One interval, cleared on destroy.
	let now = $state(Date.now());
	const timer = setInterval(() => (now = Date.now()), 30_000);
	onDestroy(() => clearInterval(timer));

	const locale = $derived(getLocale());

	$effect(() => {
		const id = page.params.id;
		const stageId = page.params.stageId;
		const key = `${id}:${stageId}:${authStore.user?.id ?? 'anon'}`;
		if (!id || !stageId || key === loadedFor) return;
		loadedFor = key;
		void load(id, stageId);
	});

	async function load(id: string, stageId: string) {
		loading = true;
		notFound = false;
		try {
			contest = await getContest(id);
			stage = await getStage(stageId);
			problems = await getProblems(stageId);
			if (contest.myRegistration?.status === 'accepted') {
				try {
					submission = await getMySubmission(stageId);
					answers = Object.fromEntries(
						(submission.answers ?? []).map((a) => [a.problemId, a.text])
					);
				} catch {
					submission = null;
				}
			}
		} catch {
			notFound = true;
		} finally {
			loading = false;
		}
	}

	/** Whole minutes left, or null. Drawn as "x days, y hours" or "y hours, z minutes" — the unit
	 *  that matters changes as the bell gets closer, and "0.3 days" tells nobody anything. */
	const closesIn = $derived.by(() => {
		if (!stage?.closesAt || stage.status !== 'open') return null;
		const ms = new Date(stage.closesAt).getTime() - now;
		if (ms <= 0) return null;
		const minutes = Math.floor(ms / 60_000);
		return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
	});

	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function onAnswerInput() {
		message = '';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), 1500);
	}
	onDestroy(() => clearTimeout(saveTimer));

	async function save() {
		if (!stage || !problems) return;
		if (submission && submission.status !== 'draft') return;
		busy = true;
		error = '';
		try {
			submission = await saveMySubmission(
				stage.id,
				problems.map((problem) => ({ problemId: problem.id, text: answers[problem.id] ?? '' }))
			);
			message = m.contests_answerSaved(); // "Saved as a draft."
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	async function submit() {
		if (!stage) return;
		busy = true;
		error = '';
		try {
			await save();
			submission = await submitMySubmission(stage.id);
			confirming = false;
			message = m.contests_handedIn(); // "Handed in. You cannot change it now."
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	async function runSearch() {
		searching = true;
		try {
			found = await searchExercises(query, locale, 10);
		} catch {
			found = [];
		} finally {
			searching = false;
		}
	}

	async function add(exerciseId: string) {
		if (!stage) return;
		busy = true;
		error = '';
		try {
			await addProblem(stage.id, exerciseId, Number(points) || 1);
			problems = await getProblems(stage.id);
			stage = await getStage(stage.id);
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	async function drop(problemId: string) {
		if (!stage) return;
		busy = true;
		error = '';
		try {
			await removeProblem(problemId);
			problems = await getProblems(stage.id);
			stage = await getStage(stage.id);
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	async function control(action: 'open' | 'close' | 'advance') {
		if (!stage) return;
		busy = true;
		error = '';
		message = '';
		try {
			if (action === 'open') stage = await openStage(stage.id);
			else if (action === 'close') stage = await closeStage(stage.id);
			else {
				const result = await advanceStage(stage.id);
				stage = result.stage;
				message = m.contests_advancedCount({ count: result.advanced }); // "{count} entrants went through."
			}
			problems = await getProblems(stage.id);
			if (contest) contest = await getContest(contest.id);
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	const isStaff = $derived(contest?.myRole !== null && contest?.myRole !== undefined);
	const canAnswer = $derived(
		stage?.status === 'open' &&
			contest?.myRegistration?.status === 'accepted' &&
			(submission === null || submission.status === 'draft')
	);
</script>

<PageHead
	title={m.contests_stagePageTitle({ title: stage?.title ?? '' })}
	description={m.contests_stagePageDescription()}
/>
<!-- "{title}" / "A stage of a contest: its problems, the answer box and the deadline." -->

<FeatureGate feature="contests">
	<div class="page">
		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if notFound || !contest || !stage}
			<p class="muted">{m.contests_notFound()}</p>
		{:else}
			<nav class="crumbs">
				<a href={resolve('/contests/[id]', { id: contest.id })}>{m.contests_backToContest()}</a>
			</nav>

			<header class="head">
				<h1>{stage.title}</h1>
				<p class="meta">
					{stageStatusLabel(stage.status)()} · {advancementLabel(stage.advancement)()}
					{#if stage.maxPoints}
						· {m.contests_stagePoints({ points: stage.maxPoints })}
						<!-- "{points} points" -->
					{/if}
				</p>
				{#if stage.closesAt}
					<p class="meta">
						{m.contests_stageClosesAt({ when: formatDateTime(stage.closesAt) })}
						<!-- "Closes {when}" -->
					</p>
				{/if}
				{#if closesIn}
					<p class="countdown" role="status">
						{closesIn.days > 0
							? m.contests_countdownDays({ days: closesIn.days, hours: closesIn.hours })
							: m.contests_countdownHours({
									hours: closesIn.hours,
									minutes: closesIn.minutes
								})}
						<!-- "{days} days and {hours} hours left" / "{hours} hours and {minutes} minutes left" -->
					</p>
				{/if}
				{#if stage.description}
					<p class="note">{stage.description}</p>
				{/if}
				{#if stage.mode === 'onsite'}
					<p class="note">
						{m.contests_stageOnsiteNote()}
						<!-- "This stage happens in a room. The organiser can hang an event off it — with a venue, documents, a volunteer rota and a cloakroom — from the contest's manage page." -->
						{#if stage.event}
							<a href={resolve('/events/[id]', { id: stage.event.id })}>{stage.event.title}</a>
						{/if}
					</p>
				{/if}
			</header>

			{#if message}
				<p class="ok" role="status">{message}</p>
			{/if}
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			{#if problems === null}
				<p class="muted">{m.contests_problemsHidden()}</p>
				<!-- "The problems appear when the stage opens. Which exercises a stage uses is the contest itself, so it is not shown in advance." -->
			{:else if problems.length === 0}
				<p class="muted">{m.contests_noProblemsYet()}</p>
				<!-- "No problems have been added to this stage yet." -->
			{:else}
				<ol class="problems">
					{#each problems as problem, index (problem.id)}
						<li class="problem">
							<header>
								<h2>
									{m.contests_problemNumber({ number: index + 1 })}
									<!-- "Problem {number}" -->
									<span class="worth">{m.contests_problemWorth({ points: problem.points })}</span>
									<!-- "{points} points" -->
								</h2>
								{#if isStaff && stage.status === 'scheduled'}
									<button type="button" disabled={busy} onclick={() => drop(problem.id)}>
										{m.contests_problemRemove()}
										<!-- "Remove" -->
									</button>
								{/if}
							</header>
							{#if problem.title}
								<p class="problem__title">{problem.title}</p>
							{/if}
							<!-- The statement only. No hint, no solution: the payload carries neither. -->
							<MathContent source={problem.statement} />

							{#if contest.myRegistration?.status === 'accepted'}
								<label class="answer">
									<span>{m.contests_yourAnswer()}</span>
									<!-- "Your answer" -->
									<textarea
										rows="6"
										disabled={!canAnswer}
										bind:value={answers[problem.id]}
										oninput={onAnswerInput}
									></textarea>
									<small>{m.contests_answerFormatHint()}</small>
									<!-- "Markdown, and LaTeX between \( … \) or \[ … \] — the same as everywhere else here." -->
								</label>
								{#if answers[problem.id]}
									<details class="preview">
										<summary>{m.contests_answerPreview()}</summary>
										<!-- "See it rendered" -->
										<MathContent source={answers[problem.id]} />
									</details>
								{/if}
							{/if}
						</li>
					{/each}
				</ol>

				{#if contest.myRegistration?.status === 'accepted'}
					<section class="handin">
						{#if submission && submission.status !== 'draft'}
							<p class="ok">
								{m.contests_alreadyHandedIn({
									when: submission.submittedAt ? formatDateTime(submission.submittedAt) : ''
								})}
								<!-- "You handed this stage in on {when}." -->
							</p>
							{#if submission.advanced}
								<p class="ok">{m.contests_youAdvanced()}</p>
								<!-- "You went through to the next stage." -->
							{/if}
						{:else if canAnswer}
							{#if !confirming}
								<button type="button" disabled={busy} onclick={() => void save()}>
									{m.contests_saveDraft()}
									<!-- "Save the draft" -->
								</button>
								<button type="button" class="primary" onclick={() => (confirming = true)}>
									{m.contests_handIn()}
									<!-- "Hand it in" -->
								</button>
							{:else}
								<p class="warn">{m.contests_handInConfirm()}</p>
								<!-- "Once you hand it in you cannot change your answers. Are you sure?" -->
								<button type="button" class="primary" disabled={busy} onclick={submit}>
									{m.contests_handInYes()}
									<!-- "Yes, hand it in" -->
								</button>
								<button type="button" disabled={busy} onclick={() => (confirming = false)}>
									{m.common_cancel()}
								</button>
							{/if}
						{:else if stage.status !== 'open'}
							<p class="muted">{contestRefusalMessage('stage_not_open')}</p>
						{/if}
					</section>
				{/if}
			{/if}

			{#if contest.canManage}
				<section class="staff">
					<h2>{m.contests_stageStaffHeading()}</h2>
					<!-- "Running this stage" -->
					<div class="controls">
						{#if stage.status === 'scheduled'}
							<button type="button" class="primary" disabled={busy} onclick={() => control('open')}>
								{m.contests_stageOpen()}
								<!-- "Open the stage" -->
							</button>
						{:else if stage.status === 'open'}
							<button type="button" disabled={busy} onclick={() => control('close')}>
								{m.contests_stageClose()}
								<!-- "Close the stage" -->
							</button>
						{:else if stage.status === 'closed'}
							<a class="button" href={resolve('/contests/[id]/judge', { id: contest.id })}>
								{m.contests_judgeLink()}
							</a>
							<button type="button" disabled={busy} onclick={() => control('advance')}>
								{m.contests_stageAdvance()}
								<!-- "Work out who goes through" -->
							</button>
						{:else}
							<p class="muted">
								{m.contests_stageScoredNote({ count: stage.advancedCount })}
								<!-- "Scored. {count} entrants went through." -->
							</p>
						{/if}
					</div>
					<p class="muted">{m.contests_noDrawNote()}</p>
					<!-- "Who goes through is worked out from the points and the rule above — never by drawing lots. A contest whose result depends on chance is a lottery under Polish law and cannot be run here." -->

					{#if stage.status === 'scheduled'}
						<div class="picker">
							<h3>{m.contests_pickerHeading()}</h3>
							<!-- "Add problems from the exercise database" -->
							<form class="picker__form" onsubmit={(event) => event.preventDefault()}>
								<label>
									<span>{m.contests_pickerSearch()}</span>
									<!-- "Search the exercises" -->
									<input type="text" bind:value={query} />
								</label>
								<label>
									<span>{m.contests_pickerPoints()}</span>
									<!-- "Points each" -->
									<input type="text" inputmode="numeric" bind:value={points} />
								</label>
								<button type="button" onclick={runSearch} disabled={searching}>
									{m.contests_pickerGo()}
									<!-- "Find" -->
								</button>
							</form>
							{#if searching}
								<p class="muted">{m.common_loading()}</p>
							{:else if found.length > 0}
								<ul class="found">
									{#each found as exercise (exercise.id)}
										<li>
											<span class="found__title">{exercise.title}</span>
											<span class="muted">{exercise.branchId} · {exercise.number}</span>
											<button type="button" disabled={busy} onclick={() => add(exercise.id)}>
												{m.contests_pickerAdd()}
												<!-- "Add" -->
											</button>
										</li>
									{/each}
								</ul>
							{:else if query}
								<p class="muted">{m.contests_pickerNothing()}</p>
								<!-- "Nothing matched. The exercise database is mostly Polish, so an English search can honestly come back empty." -->
							{/if}
						</div>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../../../lib/styles/mixins' as mix;

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
		margin: 0;
		font-size: var(--font-size-md);
	}
	h3 {
		margin: 0.6rem 0 0.3rem;
		font-size: var(--font-size-md);
	}
	.meta,
	.note,
	.muted {
		margin: 0.2rem 0 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.countdown {
		margin: 0.3rem 0 0;
		font-size: var(--font-size-sm);
		color: var(--accent);
		font-weight: 600;
	}
	.problems {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.problem {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		padding: 0.8rem 1rem;
	}
	.problem header {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		align-items: baseline;
	}
	.worth {
		font-size: var(--font-size-xs);
		font-weight: 400;
		color: var(--text-secondary);
	}
	.problem__title {
		margin: 0.2rem 0;
		font-weight: 600;
	}
	.answer {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-top: 0.6rem;
		font-size: var(--font-size-sm);
	}
	.answer textarea {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		resize: vertical;
	}
	.answer small {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.preview {
		margin-top: 0.4rem;
		font-size: var(--font-size-sm);
	}
	.handin,
	.staff {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		padding: 0.7rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.controls,
	.picker__form,
	.found li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: flex-end;
	}
	.picker__form label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.picker__form input {
		padding: 0.35rem 0.45rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.found {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.found li {
		align-items: baseline;
		font-size: var(--font-size-sm);
	}
	.found__title {
		flex: 1 1 14rem;
	}
	button,
	a.button {
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
		text-decoration: none;
	}
	button.primary {
		@include mix.button-primary;
	}
	button:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.ok {
		margin: 0;
		color: var(--status-success);
		font-size: var(--font-size-sm);
	}
	.warn {
		margin: 0;
		font-size: var(--font-size-sm);
		border-left: 3px solid var(--status-warning);
		padding-left: 0.6rem;
	}
	.error {
		margin: 0;
		color: var(--status-danger);
	}
</style>
