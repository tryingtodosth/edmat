<script lang="ts">
	// How far people have got on one session, and where this person says they are.
	//
	// Unlike `LessonFeedback` beside it, this loads nothing of its own: the course detail already
	// carries every lesson's progress, filtered to what the viewer may know, so opening a lesson
	// costs no extra request. Writing is the only thing that talks to the server, and the response
	// to a write is the whole block — what your own answer means to everybody else depends on the
	// mode and the roster, and a client recomputing that for itself would eventually disagree with
	// the server about who is anonymous.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { setLessonProgress } from '$lib/services/course';
	import type { LessonProgress, LessonProgressState } from '$lib/types/course';

	let {
		courseId,
		lessonId,
		progress
	}: {
		courseId: string;
		lessonId: string;
		progress: LessonProgress;
	} = $props();

	// Owned rather than read straight from the prop, because a write returns a fresh block and the
	// parent holds the course object. Re-seeded whenever the parent hands over a DIFFERENT object,
	// so a course reload is not silently ignored — keying this on the lesson id instead would have
	// meant a refetched course quietly kept whatever this panel last wrote.
	//
	// `lastSeen` is a plain variable rather than `$state`: the effect both reads and writes it, and
	// a reactive one would therefore re-trigger the effect that just wrote it. This project has
	// already had that exact loop once, in the mobile drawer.
	let live = $state<LessonProgress>(untrack(() => progress));
	let lastSeen = untrack(() => progress);
	$effect(() => {
		if (progress !== lastSeen) {
			lastSeen = progress;
			live = progress;
		}
	});

	let saving = $state(false);
	let error = $state('');
	let showPeople = $state(false);

	const STATES: { value: LessonProgressState; label: () => string }[] = [
		{ value: 'not_started', label: () => m.course_progress_notStarted() },
		{ value: 'in_progress', label: () => m.course_progress_inProgress() },
		{ value: 'stuck', label: () => m.course_progress_stuck() },
		{ value: 'done', label: () => m.course_progress_done() }
	];

	/** `mine` is null for "I have not said anything", which is the same thing the buttons call
	 * `not_started` — one representation on the wire, two words for it depending on whether you are
	 * reading a row or pressing a button. */
	const mine = $derived(live.mine ?? 'not_started');

	const percent = $derived(
		live.summary && live.summary.participants > 0
			? Math.round((live.summary.done / live.summary.participants) * 100)
			: 0
	);

	async function choose(state: LessonProgressState) {
		if (saving || state === mine) return;
		saving = true;
		error = '';
		try {
			live = await setLessonProgress(courseId, lessonId, state);
		} catch {
			error = m.course_progress_saveError();
		} finally {
			saving = false;
		}
	}

	function labelFor(state: string) {
		return STATES.find((s) => s.value === state)?.label() ?? state;
	}

	/** Whether there is anything at all to draw. Checked rather than assumed from `mode !== 'off'`:
	 * a signed-out reader of a public course gets a mode but no counts, no names and no buttons, and
	 * without this every lesson would carry an empty panel — a dashed rule under each session
	 * separating nothing from nothing. */
	/** Whether there is anybody to report on. A course with no participants yet answered with a real
	 * summary of zeroes and a real (empty) list of names, so staff were shown "0 of 0 have finished
	 * this" and a "show who is where" that revealed nothing — a progress bar about an empty cohort.
	 * Found by looking at the page rather than by any assertion, since every field was correct. */
	const hasCohort = $derived((live.summary?.participants ?? 0) > 0);

	const showsSomething = $derived(
		live.mode !== 'off' && (live.canRecord || hasCohort || !!live.withheldReason)
	);
</script>

{#if showsSomething}
	<section class="progress" aria-label={m.course_progress_heading()}>
		{#if live.canRecord}
			<div class="progress__mine" role="group" aria-label={m.course_progress_mineLabel()}>
				<span class="progress__label">{m.course_progress_mineLabel()}</span>
				{#each STATES as state (state.value)}
					<button
						type="button"
						class="chip"
						class:chip--on={mine === state.value}
						aria-pressed={mine === state.value}
						disabled={saving}
						onclick={() => choose(state.value)}
					>
						{state.label()}
					</button>
				{/each}
			</div>
		{/if}

		{#if live.summary && hasCohort}
			<div class="progress__bar" title={m.course_progress_barTitle()}>
				<!-- Only "done" fills the bar. A bar stacking in-progress and stuck alongside it would
				     be four numbers in one shape, and the question it is read for is the simple one. -->
				<div class="progress__fill" style:width="{percent}%"></div>
			</div>
			<p class="progress__counts">
				{m.course_progress_counts({
					done: live.summary.done,
					total: live.summary.participants
				})}
				{#if live.summary.inProgress > 0}
					· {m.course_progress_countInProgress({ n: live.summary.inProgress })}
				{/if}
				{#if live.summary.stuck > 0}
					· <strong class="progress__stuck"
						>{m.course_progress_countStuck({ n: live.summary.stuck })}</strong
					>
				{/if}
			</p>
		{/if}

		{#if live.withheldReason === 'small_cohort'}
			<!-- Said rather than silently shown as nothing: an empty panel reads as "nobody has done
			     anything", which is the opposite of the truth. -->
			<p class="muted">{m.course_progress_smallCohort()}</p>
		{:else if live.mode === 'private'}
			<p class="muted">{m.course_progress_privateNote()}</p>
		{/if}

		{#if live.people && hasCohort}
			<button type="button" class="linkish" onclick={() => (showPeople = !showPeople)}>
				{showPeople ? m.course_progress_hideWho() : m.course_progress_showWho()}
			</button>
			{#if showPeople}
				<ul class="people">
					{#each live.people as person (person.participant.id)}
						<li>
							<span class="people__name">{person.participant.displayName}</span>
							<span class="people__state" data-state={person.state}>{labelFor(person.state)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if live.mode === 'shared_anonymous'}
				<!-- Staff are seeing names in a mode whose whole promise to participants is that
				     nobody is named. Saying so is the difference between a privilege and a leak. -->
				<p class="muted">{m.course_progress_staffSeeNames()}</p>
			{/if}
		{/if}

		{#if error}
			<p class="error">{error}</p>
		{/if}
	</section>
{/if}

<style lang="scss">
	.progress {
		margin-top: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px dashed var(--border-color);
	}

	.progress__mine {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}

	.progress__label {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-right: var(--space-1);
	}

	.chip {
		background: var(--bg-surface-alt);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		color: inherit;
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0.15rem 0.6rem;

		&:hover:not(:disabled) {
			border-color: var(--accent);
		}

		&--on {
			background: var(--accent);
			border-color: var(--accent);
			color: var(--bg-surface);
		}

		&:disabled {
			cursor: progress;
		}
	}

	.progress__bar {
		background: var(--bg-surface-alt);
		border-radius: 999px;
		height: 0.4rem;
		overflow: hidden;
	}

	.progress__fill {
		background: var(--status-success);
		height: 100%;
	}

	.progress__counts {
		color: var(--text-secondary);
		font-size: 0.85rem;
		margin: var(--space-1) 0 0 0;
	}

	.progress__stuck {
		color: var(--status-warning);
	}

	.people {
		list-style: none;
		margin: var(--space-1) 0 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;

		li {
			display: flex;
			gap: var(--space-2);
			font-size: 0.85rem;
		}
	}

	.people__name {
		min-width: 0;
	}

	.people__state {
		color: var(--text-secondary);

		&[data-state='done'] {
			color: var(--status-success);
		}

		&[data-state='stuck'] {
			color: var(--status-warning);
		}
	}

	.linkish {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: 0.85rem;
		padding: var(--space-1) 0 0 0;
		text-decoration: underline;
	}

	.muted {
		color: var(--text-secondary);
		font-size: 0.8rem;
		margin: var(--space-1) 0 0 0;
	}

	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
</style>
