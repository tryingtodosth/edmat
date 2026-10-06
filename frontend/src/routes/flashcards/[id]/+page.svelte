<script lang="ts">
	/** `/flashcards/[id]` — one deck: its cards, three ways to add one, where it is placed, and the
	 * controls to rename, share or delete it (prompts/02-flashcards.md).
	 *
	 * A reader who can only STUDY this deck (it is placed on a course they are on) sees the cards
	 * and the review link and none of the editing controls — `deck.canEdit` is the server's answer
	 * (`flashcards/rules.py: can_edit`), not a guess made here, and the API refuses the write
	 * regardless. The one thing they get instead is "make my own copy", which is the honest answer
	 * to "can I change this": no, and here is the copy you can.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import {
		addCard,
		copyDeck,
		deleteCard,
		deleteDeck,
		getDeck,
		getDeckCards,
		placeDeck,
		removePlacement,
		updateDeck
	} from '$lib/services/flashcards';
	import { getSetsForUser } from '$lib/services/exerciseSets';
	import { getMyTeaching } from '$lib/services/course';
	import { getEvents } from '$lib/services/events';
	import { searchExercises } from '$lib/services/exercises';
	import type { Card, Deck } from '$lib/types/flashcards';
	import type { ExerciseSet, ResolvedExercise } from '$lib/types';
	import {
		AUDIENCE_LABELS,
		AUDIENCES,
		deckRefusalMessage,
		deckSourceLabel
	} from '$lib/utils/labels';
	import { pageTitle } from '$lib/utils/pageTitle';

	const canSee = $derived(featureFlagsStore.isEnabled('flashcards') || authStore.isModerator);

	let deck = $state<Deck | null>(null);
	let cards = $state<Card[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state('');
	let notice = $state('');
	let busy = $state('');

	// Edit controls
	let name = $state('');
	let audience = $state<Deck['audience']>('university');

	// "Add from one of my sets"
	let sets = $state<ExerciseSet[]>([]);
	let chosenSet = $state('');

	// "Add an exercise"
	let query = $state('');
	let results = $state<ResolvedExercise[]>([]);
	let searched = $state(false);

	// "Write a card of your own"
	let front = $state('');
	let back = $state('');

	// Placements
	let placeTargets = $state<{ key: string; label: string }[]>([]);
	let chosenTarget = $state('');

	async function load(id: string) {
		loading = true;
		notFound = false;
		try {
			deck = await getDeck(id);
			name = deck.name;
			audience = deck.audience;
			cards = await getDeckCards(id);
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

	/** The courses and events this person RUNS, which is the only place a deck may be placed
	 * (`can_manage_node`). Loaded lazily, once, and only for somebody who owns the deck — nobody
	 * else can place it, so nobody else should pay two requests for the list. */
	async function loadPlaceTargets() {
		if (placeTargets.length > 0) return;
		const [courses, events] = await Promise.allSettled([
			getMyTeaching(),
			// `mine: 'hosting'` is the events this person runs, and `when: 'all'` because a deck can
			// legitimately be placed on an event that has already started (a workshop handing out
			// take-home cards on the day).
			getEvents({ mine: 'hosting', when: 'all' })
		]);
		const rows: { key: string; label: string }[] = [];
		if (courses.status === 'fulfilled') {
			for (const course of courses.value)
				rows.push({ key: `course:${course.id}`, label: course.title });
		}
		if (events.status === 'fulfilled') {
			for (const event of events.value) {
				if (event.canOrganise) rows.push({ key: `event:${event.id}`, label: event.title });
			}
		}
		placeTargets = rows;
	}

	// The id-changed idempotency guard every dynamic route here needs: a bare
	// `$effect(() => load(page.params.id!))` re-fires with no navigation at all
	// (frontend/CLAUDE.md trap 2), and this effect writes state it would then read back.
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

	$effect(() => {
		if (deck?.canEdit && authStore.user) {
			void loadPlaceTargets();
			if (sets.length === 0) getSetsForUser(authStore.user.id).then((rows) => (sets = rows));
		}
	});

	async function run(label: string, action: () => Promise<void>) {
		busy = label;
		error = '';
		notice = '';
		try {
			await action();
		} catch (e) {
			error = deckRefusalMessage(e, m.decks_error());
		} finally {
			busy = '';
		}
	}

	function saveMeta() {
		return run('meta', async () => {
			deck = await updateDeck(deck!.id, { name: name.trim(), audience });
			notice = m.decks_saved(); // "Saved."
		});
	}

	function togglePublic(next: boolean) {
		return run('public', async () => {
			deck = await updateDeck(deck!.id, { isPublic: next });
		});
	}

	function removeDeck() {
		return run('delete', async () => {
			await deleteDeck(deck!.id);
			await goto(resolve('/flashcards'));
		});
	}

	function addFromSet() {
		const set = sets.find((s) => s.id === chosenSet);
		if (!set) return Promise.resolve();
		return run('set', async () => {
			// One card per exercise, in the set's own order. Added through the card endpoint rather
			// than by making a second deck, because the person is adding TO a deck they already have.
			for (const exerciseId of set.exerciseIds) {
				try {
					cards = [...cards, await addCard(deck!.id, { exerciseId })];
				} catch {
					// An exercise that has since been pulled: skipped, exactly as
					// `POST /api/decks/` skips it, rather than abandoning the rest of the set.
				}
			}
			deck = await getDeck(deck!.id);
		});
	}

	function search() {
		return run('search', async () => {
			results = await searchExercises(query, getLocale());
			searched = true;
		});
	}

	function addExercise(exerciseId: string) {
		return run(`ex:${exerciseId}`, async () => {
			cards = [...cards, await addCard(deck!.id, { exerciseId })];
			deck = await getDeck(deck!.id);
		});
	}

	function addText(event: SubmitEvent) {
		event.preventDefault();
		if (!front.trim()) return;
		return run('text', async () => {
			cards = [...cards, await addCard(deck!.id, { front: front.trim(), back: back.trim() })];
			front = '';
			back = '';
			deck = await getDeck(deck!.id);
		});
	}

	function removeOneCard(cardId: string) {
		return run(`card:${cardId}`, async () => {
			await deleteCard(cardId);
			cards = cards.filter((c) => c.id !== cardId);
			deck = await getDeck(deck!.id);
		});
	}

	function place() {
		const [kind, id] = chosenTarget.split(':');
		if (kind !== 'course' && kind !== 'event') return Promise.resolve();
		return run('place', async () => {
			await placeDeck(deck!.id, { kind, id });
			deck = await getDeck(deck!.id);
		});
	}

	function unplace(placementId: string) {
		return run(`unplace:${placementId}`, async () => {
			await removePlacement(placementId);
			deck = await getDeck(deck!.id);
		});
	}

	function copy() {
		return run('copy', async () => {
			const made = await copyDeck(deck!.id);
			await goto(resolve(`/flashcards/${made.id}`));
		});
	}
</script>

<svelte:head>
	<title>{pageTitle(deck ? deck.name : m.decks_title())}</title>
</svelte:head>

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
				<p class="meta">
					{m.decks_cardCount({ count: deck.cardCount })}
					<!-- "{count} cards" -->
					· {deckSourceLabel(deck.sourceKind)}
					{#if !deck.canEdit}
						· {m.decks_byOwner({ name: deck.ownerDisplayName })}
						<!-- "by {name}" -->
					{/if}
				</p>
				<div class="actions">
					{#if deck.cardCount > 0}
						<a class="primary" href={resolve(`/flashcards/${deck.id}/review`)}>
							{deck.dueCount > 0 ? m.decks_dueCount({ count: deck.dueCount }) : m.decks_review()}
							<!-- "{count} to review" / "Review" -->
						</a>
					{/if}
					{#if !deck.canEdit}
						<button type="button" class="secondary" disabled={busy === 'copy'} onclick={copy}>
							{m.sharedSet_saveCopy()}
						</button>
					{/if}
				</div>
			</header>

			{#if error}
				<p class="error">{error}</p>
			{/if}
			{#if notice}
				<p class="notice">{notice}</p>
			{/if}

			{#if deck.canEdit}
				<section class="panel">
					<h2>{m.decks_rename()}</h2>
					<!-- "Name" -->
					<form class="row" onsubmit={(e) => (e.preventDefault(), saveMeta())}>
						<input type="text" bind:value={name} maxlength="120" />
						<label class="band">
							<span>{m.decks_audience()}</span>
							<!-- "Who it is for" -->
							<select bind:value={audience}>
								{#each AUDIENCES as band (band)}
									<option value={band}>{AUDIENCE_LABELS[band]()}</option>
								{/each}
							</select>
						</label>
						<button type="submit" class="secondary" disabled={busy === 'meta' || !name.trim()}>
							{m.decks_save()}
							<!-- "Save" -->
						</button>
					</form>
					<label class="public">
						<input
							type="checkbox"
							checked={deck.isPublic}
							disabled={busy === 'public'}
							onchange={(e) => togglePublic(e.currentTarget.checked)}
						/>
						{m.decks_public()}
						<!-- "Anyone with the link can study this deck" -->
					</label>
					<p class="hint">{m.decks_publicNote()}</p>
					<!-- "A deck placed on a course or an event can already be studied by the people there. This makes it readable by anyone." -->
				</section>
			{/if}

			<section class="panel">
				<h2>{m.decks_placements()}</h2>
				<!-- "Where this deck is placed" -->
				{#if deck.placements.length === 0}
					<p class="hint">{m.decks_placementsEmpty()}</p>
					<!-- "Not placed anywhere. A deck on a course or an event can be studied by the people there." -->
				{:else}
					<ul class="plain">
						{#each deck.placements as placement (placement.id)}
							<li class="row row--between">
								{#if placement.node}
									<a
										href={resolve(
											placement.node.kind === 'course'
												? `/courses/${placement.node.id}`
												: `/events/${placement.node.id}`
										)}>{placement.node.title}</a
									>
								{/if}
								{#if deck.canEdit || placement.node?.canManage}
									<button
										type="button"
										class="link-button"
										disabled={busy === `unplace:${placement.id}`}
										onclick={() => unplace(placement.id)}
									>
										{m.decks_unplace()}
										<!-- "Remove from here" -->
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				{#if deck.canEdit}
					{#if placeTargets.length > 0}
						<form class="row" onsubmit={(e) => (e.preventDefault(), place())}>
							<label class="grow">
								<span>{m.decks_placeOn()}</span>
								<!-- "Place this deck on a course or an event you run" -->
								<select bind:value={chosenTarget}>
									<option value="">{m.decks_placeChoose()}</option>
									{#each placeTargets as target (target.key)}
										<option value={target.key}>{target.label}</option>
									{/each}
								</select>
							</label>
							<button type="submit" class="secondary" disabled={busy === 'place' || !chosenTarget}>
								{m.decks_place()}
								<!-- "Place" -->
							</button>
						</form>
					{/if}
				{/if}
			</section>

			{#if deck.canEdit}
				<section class="panel">
					<h2>{m.decks_addBySearch()}</h2>
					<!-- "Add an exercise" -->
					<form class="row" onsubmit={(e) => (e.preventDefault(), search())}>
						<input type="text" bind:value={query} placeholder={m.decks_searchPlaceholder()} />
						<button type="submit" class="secondary" disabled={busy === 'search' || !query.trim()}>
							{m.decks_search()}
							<!-- "Search" -->
						</button>
					</form>
					{#if searched && results.length === 0}
						<p class="hint">{m.decks_searchNoResults()}</p>
						<!-- "Nothing matched." -->
					{:else if results.length > 0}
						<ul class="plain">
							{#each results as found (found.id)}
								<li class="row row--between">
									<span class="result"><MathTitle text={found.title} /></span>
									<button
										type="button"
										class="link-button"
										disabled={busy === `ex:${found.id}`}
										onclick={() => addExercise(found.id)}
									>
										{m.decks_add()}
										<!-- "Add" -->
									</button>
								</li>
							{/each}
						</ul>
					{/if}

					{#if sets.length > 0}
						<form class="row" onsubmit={(e) => (e.preventDefault(), addFromSet())}>
							<label class="grow">
								<span>{m.decks_addFromSet()}</span>
								<!-- "Add from one of my sets" -->
								<select bind:value={chosenSet}>
									<option value="">{m.decks_addFromSetChoose()}</option>
									{#each sets as set (set.id)}
										<option value={set.id}>{set.name}</option>
									{/each}
								</select>
							</label>
							<button type="submit" class="secondary" disabled={busy === 'set' || !chosenSet}>
								{m.decks_addFromSetAction()}
								<!-- "Add its exercises" -->
							</button>
						</form>
					{/if}

					<form class="stack" onsubmit={addText}>
						<h3>{m.decks_addTextCard()}</h3>
						<!-- "Write a card of your own" -->
						<label>
							<span>{m.decks_front()}</span>
							<textarea bind:value={front} rows="2" maxlength="4000"></textarea>
						</label>
						<label>
							<span>{m.decks_back()}</span>
							<textarea bind:value={back} rows="2" maxlength="4000"></textarea>
						</label>
						<button type="submit" class="secondary" disabled={busy === 'text' || !front.trim()}>
							{m.decks_addCard()}
							<!-- "Add card" -->
						</button>
					</form>
				</section>
			{/if}

			<section class="panel">
				<h2>{m.decks_cards()}</h2>
				<!-- "Cards" -->
				{#if cards.length === 0}
					<p class="hint">{m.decks_cardsEmpty()}</p>
					<!-- "No cards yet." -->
				{:else}
					<ol class="cards">
						{#each cards as card (card.id)}
							<li class="card" class:card--pulled={card.exercise && !card.exercise.published}>
								<div class="card__body">
									{#if card.kind === 'exercise' && card.exercise}
										<a href={resolve(`/exercises/${card.exercise.id}`)}>
											<MathTitle text={card.exercise.title} />
										</a>
										{#if !card.exercise.published}
											<p class="hint">{m.decks_cardPulled()}</p>
											<!-- "This exercise is no longer visible to readers — only you can see this card." -->
										{/if}
									{:else if card.kind === 'concept' && card.concept}
										<a href={resolve(`/concepts/${card.concept.slug}`)}>
											<MathTitle text={card.concept.title} />
										</a>
										{#if card.concept.summary}
											<p class="hint">{card.concept.summary}</p>
										{/if}
									{:else}
										<MathContent source={card.front} />
									{/if}
								</div>
								{#if deck.canEdit}
									<button
										type="button"
										class="link-button"
										disabled={busy === `card:${card.id}`}
										onclick={() => removeOneCard(card.id)}
									>
										{m.decks_removeCard()}
										<!-- "Remove" -->
									</button>
								{/if}
							</li>
						{/each}
					</ol>
				{/if}
			</section>

			{#if deck.canEdit}
				<section class="panel panel--danger">
					<button
						type="button"
						class="danger"
						disabled={busy === 'delete'}
						onclick={() => {
							if (confirm(m.decks_deleteConfirm())) void removeDeck();
						}}
					>
						{m.decks_delete()}
						<!-- "Delete deck" -->
					</button>
				</section>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 760px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	h1 {
		margin: 0 0 var(--space-1) 0;
	}

	h2 {
		margin: 0 0 var(--space-2) 0;
		font-size: var(--font-size-lg);
	}

	h3 {
		margin: var(--space-2) 0 0 0;
		font-size: var(--font-size-base);
	}

	.meta,
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

	.notice {
		color: var(--status-success);
		margin: 0;
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
		flex-wrap: wrap;
	}

	.primary {
		@include mix.button-primary;
		text-decoration: none;
	}

	.secondary {
		@include mix.button-secondary;
		text-decoration: none;
	}

	.danger {
		@include mix.button-secondary;
		border-color: var(--status-danger);
		color: var(--status-danger);
	}

	.panel {
		@include mix.card-surface;
		padding: var(--space-3);
		display: grid;
		gap: var(--space-2);
	}

	.panel--danger {
		justify-items: start;
	}

	.row {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
		flex-wrap: wrap;

		input[type='text'] {
			flex: 1 1 12rem;
			min-width: 0;
		}
	}

	.row--between {
		justify-content: space-between;
		align-items: baseline;
	}

	.stack {
		display: grid;
		gap: var(--space-2);
		justify-items: stretch;

		label {
			display: grid;
			gap: 0.2rem;
		}

		button {
			justify-self: start;
		}
	}

	.grow {
		flex: 1 1 12rem;
		min-width: 0;
		display: grid;
		gap: 0.2rem;
	}

	.band {
		display: grid;
		gap: 0.2rem;
	}

	.band span,
	.grow span,
	.stack span {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}

	.public {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}

	.cards {
		margin: 0;
		padding-left: var(--space-4);
		display: grid;
		gap: var(--space-2);
	}

	.card {
		display: flex;
		gap: var(--space-2);
		justify-content: space-between;
		align-items: baseline;
	}

	.card--pulled {
		opacity: 0.65;
	}

	.card__body {
		min-width: 0;
	}

	.result {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.link-button {
		@include mix.focus-ring;
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
		padding: 0.1rem 0.2rem;
		flex-shrink: 0;

		&:disabled {
			cursor: progress;
			opacity: 0.6;
		}
	}
</style>
