<script lang="ts">
	/** `/flashcards/[id]/review` — one card at a time, flip, four grades on keys 1–4
	 * (prompts/02-flashcards.md).
	 *
	 * **The exercise content is loaded once, in one request.** The queue endpoint deliberately does
	 * not inline statements (a 50-card response would carry fifty of them for a screen that shows
	 * one), so the ids go through `getExercisesByIds` → `GET /api/exercises/bulk/`, which is the
	 * endpoint built for exactly this shape of caller and which already resolves the hint and
	 * solution pool through `exercises/entries.py: visible_entries`.
	 *
	 * **Both faces render through `MathContent`**, so KaTeX stays lazily loaded (house rule 11) and
	 * the corpus's literal `\( … \)` delimiters typeset the same way they do on an exercise page.
	 *
	 * The queue is a client-side cursor over one server answer rather than a re-fetch per card:
	 * grading writes the schedule and the next card is already here, which is what makes the screen
	 * feel like a deck of cards instead of a form. The counts shown are the server's honest totals
	 * from the moment the session opened; "Review the rest" re-asks.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import { getDeck, getReviewQueue, gradeCard } from '$lib/services/flashcards';
	import { getExercisesByIds } from '$lib/services/exercises';
	import type { Card, Deck, ReviewGrade, ReviewQueue } from '$lib/types/flashcards';
	import type { ResolvedExercise } from '$lib/types';
	import { REVIEW_GRADES, REVIEW_GRADE_LABELS } from '$lib/utils/labels';
	import { pageTitle } from '$lib/utils/pageTitle';

	const canSee = $derived(featureFlagsStore.isEnabled('flashcards') || authStore.isModerator);

	let deck = $state<Deck | null>(null);
	let queue = $state<ReviewQueue>({ cards: [], counts: { due: 0, new: 0, learned: 0, total: 0 } });
	let exercises = $state<Record<string, ResolvedExercise>>({});
	let index = $state(0);
	let flipped = $state(false);
	let loading = $state(true);
	let notFound = $state(false);
	let busy = $state(false);
	let error = $state('');
	let reviewed = $state(0);

	const current = $derived<Card | null>(queue.cards[index] ?? null);
	const finished = $derived(!loading && !notFound && current === null);
	const exercise = $derived(current?.exercise ? (exercises[current.exercise.id] ?? null) : null);

	/** The published hint and solution entries for the current exercise, in the server's own
	 * pinned-first order (`exercises/entries.py: sort_entries` already sorted them) — the same
	 * "a language beats a blank" fallback `/my-set` makes when the reader's locale has none. */
	function entries(kind: 'hint' | 'solution') {
		if (!exercise) return [];
		const published = exercise.entries.filter((e) => e.kind === kind && e.status === 'published');
		const local = published.filter((e) => e.locale === exercise.locale);
		return local.length > 0 ? local : published;
	}

	async function load(id: string) {
		loading = true;
		notFound = false;
		index = 0;
		flipped = false;
		reviewed = 0;
		try {
			deck = await getDeck(id);
			queue = await getReviewQueue(id);
			const ids = queue.cards.map((c) => c.exercise?.id).filter((x): x is string => !!x);
			if (ids.length > 0) {
				const rows = await getExercisesByIds(ids, getLocale());
				const byId: Record<string, ResolvedExercise> = {};
				for (const row of rows) byId[row.id] = row;
				exercises = byId;
			} else {
				exercises = {};
			}
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) {
				notFound = true;
				deck = null;
			} else {
				error = m.decks_error(); // "That did not work. Try again."
			}
		} finally {
			loading = false;
		}
	}

	// The id-changed idempotency guard (frontend/CLAUDE.md trap 2): without it this effect re-fires
	// on every unrelated state change on this page — including the ones it writes itself — and
	// restarts the session from the first card mid-review.
	let loadedFor = $state('');
	$effect(() => {
		const id = page.params.id!;
		const key = `${id}:${canSee ? 'on' : 'off'}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		if (!canSee) {
			loading = false;
			return;
		}
		void load(id);
	});

	async function grade(value: ReviewGrade) {
		const card = current;
		if (!card || busy) return;
		busy = true;
		error = '';
		try {
			await gradeCard(card.id, value);
			reviewed += 1;
			// "Again" is not a skip: the server has put the card back on today, so it is honest to
			// move past it in THIS pass and let the next session (or "Review the rest") show it
			// again. Putting it back into the local queue here would make the progress line lie.
			index += 1;
			flipped = false;
		} catch (e) {
			error = e instanceof ApiError ? e.message : m.decks_error();
		} finally {
			busy = false;
		}
	}

	function onKey(event: KeyboardEvent) {
		if (!current) return;
		// Never steal a keystroke from a form control — the page has none today, but a future
		// "edit this card here" would be unusable otherwise.
		const target = event.target as HTMLElement | null;
		if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
		if (!flipped && (event.key === ' ' || event.key === 'Enter')) {
			event.preventDefault();
			flipped = true;
			return;
		}
		if (flipped && ['1', '2', '3', '4'].includes(event.key)) {
			event.preventDefault();
			void grade(Number(event.key) as ReviewGrade);
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(deck ? deck.name : m.decks_review())}</title>
</svelte:head>

<!-- Attached unconditionally while the page is mounted and null-checked inside the handler, the
     shape frontend/CLAUDE.md trap 6 records: attaching on a piece of state loses the keystroke
     dispatched before the next flush. -->
<svelte:window onkeydown={onKey} />

<FeatureGate feature="flashcards">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if notFound || !deck}
			<p class="status">{m.decks_notFound()}</p>
			<!-- "That deck does not exist, or is not shared with you." -->
		{:else}
			<header>
				<h1><MathTitle text={deck.name} /></h1>
				<p class="counts">
					{m.decks_reviewCounts({
						due: queue.counts.due,
						fresh: queue.counts.new,
						learned: queue.counts.learned
					})}
					<!-- "{due} due · {fresh} new · {learned} scheduled" -->
				</p>
			</header>

			{#if error}
				<p class="error">{error}</p>
			{/if}

			{#if queue.cards.length === 0}
				<p class="status">{m.decks_reviewEmpty()}</p>
				<!-- "Nothing to review in this deck right now." -->
				<a class="secondary" href={resolve(`/flashcards/${deck.id}`)}>{m.decks_reviewBack()}</a>
				<!-- "Back to the deck" -->
			{:else if finished}
				<section class="done">
					<h2>{m.decks_reviewDone()}</h2>
					<!-- "Session finished" -->
					<p>{m.decks_reviewDoneBody({ count: reviewed })}</p>
					<!-- "{count} cards reviewed." -->
					<div class="actions">
						<button type="button" class="primary" onclick={() => load(deck!.id)}>
							{m.decks_reviewMore()}
							<!-- "Review the rest" -->
						</button>
						<a class="secondary" href={resolve(`/flashcards/${deck.id}`)}>
							{m.decks_reviewBack()}
						</a>
					</div>
				</section>
			{:else if current}
				<p class="progress" data-testid="review-progress">
					{m.decks_reviewProgress({ done: index + 1, total: queue.cards.length })}
					<!-- "{done} of {total}" -->
				</p>

				<article class="card" data-testid="review-card" data-flipped={flipped}>
					<div class="card__face card__face--front">
						{#if current.kind === 'exercise'}
							{#if exercise}
								<MathContent source={exercise.statement} />
							{:else}
								<p class="status">{m.common_loading()}</p>
							{/if}
						{:else if current.kind === 'concept' && current.concept}
							<!-- MathTitle, not MathContent: a title is a plain string and must never
							     introduce a block-level element inside a heading (MathTitle's own
							     docstring says so). The BACK face, which is prose, is MathContent. -->
							<h2><MathTitle text={current.concept.title} /></h2>
						{:else}
							<MathContent source={current.front} />
						{/if}
					</div>

					{#if flipped}
						<hr />
						<div class="card__face card__face--back" data-testid="review-back">
							{#if current.kind === 'exercise'}
								<h3>{m.decks_answer()}</h3>
								<!-- "Answer" -->
								{#if exercise?.answer}
									<MathContent source={exercise.answer} />
								{:else}
									<p class="status">{m.decks_noAnswer()}</p>
									<!-- "This exercise has no published answer yet." -->
								{/if}
								{#if current.includeHint && entries('hint').length > 0}
									<h3>{m.decks_hint()}</h3>
									<!-- "Hint" -->
									{#each entries('hint') as entry (entry.id)}
										<MathContent source={entry.body} />
									{/each}
								{/if}
								{#if current.includeSolution && entries('solution').length > 0}
									<h3>{m.decks_solution()}</h3>
									<!-- "Solution" -->
									{#each entries('solution').slice(0, 1) as entry (entry.id)}
										<MathContent source={entry.body} />
									{/each}
								{/if}
								{#if current.exercise}
									<a class="away" href={resolve(`/exercises/${current.exercise.id}`)}>
										{m.decks_openExercise()}
										<!-- "Open the exercise" -->
									</a>
								{/if}
							{:else if current.kind === 'concept' && current.concept}
								<MathContent source={current.concept.summary} />
								<a class="away" href={resolve(`/concepts/${current.concept.slug}`)}>
									{m.decks_openConcept()}
									<!-- "Open the concept" -->
								</a>
							{:else}
								<MathContent source={current.back} />
							{/if}
						</div>
					{/if}
				</article>

				{#if !flipped}
					<button type="button" class="primary" onclick={() => (flipped = true)}>
						{m.decks_reviewShow()}
						<!-- "Show the answer" -->
					</button>
					<p class="hint">{m.decks_reviewFlipHint()}</p>
					<!-- "Space or Enter shows the answer; keys 1–4 grade it." -->
				{:else}
					<div class="grades">
						{#each REVIEW_GRADES as value (value)}
							<button
								type="button"
								class="grade grade--{value}"
								disabled={busy}
								onclick={() => grade(value)}
							>
								<span class="grade__key">{value}</span>
								{REVIEW_GRADE_LABELS[value]()}
							</button>
						{/each}
					</div>
					<p class="hint">{m.decks_reviewGradeHint()}</p>
					<!-- "1 again · 2 hard · 3 good · 4 easy" -->
				{/if}
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

	.page {
		max-width: 680px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	h1 {
		margin: 0;
		font-size: var(--font-size-xl);
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-lg);
	}

	h3 {
		margin: var(--space-2) 0 var(--space-1) 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.counts,
	.progress,
	.status,
	.hint {
		color: var(--text-secondary);
		margin: 0;
		font-size: var(--font-size-sm);
	}

	.error {
		color: var(--status-danger);
		margin: 0;
	}

	.card {
		@include mix.card-surface;
		padding: var(--space-4);
		min-height: 9rem;
		display: grid;
		gap: var(--space-2);
		align-content: start;
	}

	hr {
		border: none;
		border-top: 1px solid var(--border-color);
		margin: 0;
		width: 100%;
	}

	.away {
		display: inline-block;
		margin-top: var(--space-2);
		font-size: var(--font-size-sm);
	}

	.primary {
		@include mix.button-primary;
		text-decoration: none;
		justify-self: start;
	}

	.secondary {
		@include mix.button-secondary;
		text-decoration: none;
		justify-self: start;
	}

	.done {
		@include mix.card-surface;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-2);

		p {
			margin: 0;
		}
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.grades {
		display: grid;
		/* Four across on a desktop, two on a phone — a grade button has to be big enough to hit
		   without looking, because the whole point of the keys is that you stop looking. */
		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		gap: var(--space-2);
	}

	.grade {
		@include mix.button-secondary;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		padding: var(--space-2);
	}

	/* "Again" and "Easy" are the two ends and the only two worth colouring: tinting all four turns
	   the row into a traffic light nobody reads. */
	.grade--1 {
		border-color: var(--status-danger);
		color: var(--status-danger);
	}

	.grade--4 {
		border-color: var(--status-success);
		color: var(--status-success);
	}

	.grade__key {
		font-variant-numeric: tabular-nums;
		opacity: 0.6;
		font-size: var(--font-size-xs);
		border: 1px solid currentcolor;
		border-radius: var(--radius-sm);
		padding: 0 0.25rem;
	}
</style>
