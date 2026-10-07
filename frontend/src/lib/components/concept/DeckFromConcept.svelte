<script lang="ts">
	/**
	 * "Make a deck from this concept" — every exercise linked to it, as flashcards.
	 *
	 * One button, and the only flashcards code this step touches: it calls
	 * `createDeckFromExercises` (step A's one pre-agreed endpoint shape, `prompts/02-flashcards.md`
	 * §API) with `source: {kind: 'concept', id}`, so the deck remembers where it came from.
	 *
	 * **Hidden when there is nothing to make a deck of**, rather than offered and then refused: a
	 * concept with no linked exercises has no cards in it, and a button that always fails is worse
	 * than no button. The exercise list it checks that against is the one the server says this
	 * reader may see, so a concept whose only exercises are unpublished is honestly empty here too.
	 *
	 * Behind BOTH flags, and they mean different things: `concepts` is the surface this sits on and
	 * is already enforced by the page's own `FeatureGate`; `flashcards` is the feature being reached
	 * for, and killing it has to take the button away as well as the endpoint (house rule 3).
	 *
	 * The confirmation **links to the deck**. It deliberately did not when this was written: step
	 * A's `/flashcards/[id]` did not exist on this branch, and a link to a route that is not there
	 * is the exact bug `CLAUDE.md` house rule 2 records finding in a browser ("an invite link
	 * pointing at a route renamed months earlier"), so the sentence named the deck and said the
	 * integrator would add the link. The integration landed the route and not the link, and the
	 * first run of `e2e/make-a-deck.mjs` against the real `POST /api/decks/` found the gap: the
	 * course and event buttons both offer the door and this one left the reader to go and find
	 * their new deck (HISTORY §17BU.D). `CourseContent.svelte`'s `.deck-note` is the shape copied.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { createDeckFromExercises } from '$lib/services/flashcards';
	import { getConceptExercises } from '$lib/services/concepts';
	import type { ConceptExerciseRef } from '$lib/types/concept';
	import type { FeatureFlagKey } from '$lib/types';

	/** Step A's kill switch, named once rather than spelled at the call site — the union in
	 *  `types/featureFlag.ts` is what then checks it. */
	const FLASHCARDS_FLAG: FeatureFlagKey = 'flashcards';

	let {
		slug,
		conceptId,
		title
	}: {
		slug: string;
		/** The concept's numeric id — what `Deck.source_id` stores beside `source_kind='concept'`. */
		conceptId: string;
		/** The concept's resolved title, which becomes the deck's name. */
		title: string;
	} = $props();

	let exercises = $state<ConceptExerciseRef[]>([]);
	let working = $state(false);
	/** The deck that came back, or `null` for "nothing made yet" — both halves together, because a
	 *  name with no id would draw a link to nowhere. */
	let made = $state<{ id: string; name: string } | null>(null);
	let error = $state('');

	const available = $derived(
		featureFlagsStore.isEnabled(FLASHCARDS_FLAG) && authStore.isAuthenticated
	);

	// The id-changed guard, keyed on the slug and the session (frontend/CLAUDE.md traps 2 and 3);
	// never at component top level, which would run during prerendering with no token (trap 5).
	let loadedFor = $state('');
	$effect(() => {
		if (!featureFlagsStore.isLoaded || !available) return;
		const key = `${slug}|${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load();
	});

	async function load() {
		exercises = await getConceptExercises(slug);
	}

	async function make() {
		if (working || exercises.length === 0) return;
		working = true;
		error = '';
		made = null;
		try {
			const deck = await createDeckFromExercises({
				name: m.paths_deck_name({ title }), // "Flashcards: {title}"
				exerciseIds: exercises.map((row) => row.id),
				source: { kind: 'concept', id: conceptId }
			});
			made = { id: deck.id, name: deck.name || m.paths_deck_name({ title }) };
		} catch {
			// One sentence for every failure, deliberately: the endpoint's own refusal vocabulary
			// (`not_owner`, `kind`, `cannot_manage`, `already_placed`) is all about PLACEMENT, and
			// this button never places anything — so there is nothing here to translate that a
			// person could act on (house rule 10: say what is known).
			error = m.paths_deck_failed(); // "The deck could not be made."
		} finally {
			working = false;
		}
	}
</script>

{#if available && exercises.length > 0}
	<button type="button" class="deck" disabled={working} onclick={make}>
		{working ? m.paths_deck_working() : m.paths_deck_make()}
		<!-- "Making the deck…" / "Make a deck from this concept" -->
	</button>
{/if}
{#if made}
	<p class="made" role="status">
		{m.paths_deck_made({ name: made.name })}
		<!-- "Deck made: {name}" -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `/flashcards/[id]` is a plain route with no localized address; `svelte/no-navigation-without-resolve` cannot see through a template literal without type-aware linting, which this project deliberately does not turn on (frontend/CLAUDE.md) -->
		<a href={`/flashcards/${made.id}`}>{m.paths_deck_open()}</a>
		<!-- "Open it" -->
	</p>
{/if}
{#if error}
	<p class="error">{error}</p>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.deck {
		@include mix.button-secondary;
		min-height: 36px;
		padding: 0 var(--space-3);
		font-size: var(--font-size-sm);
	}
	.made {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		margin: 0;
		white-space: normal;
	}
	/* `inherit` rather than the link colour: the pill picked its foreground against its own green
	   background, and a link colour chosen for the page background need not clear AA on this one.
	   Underlined, because without it "Open it" is the same green as the sentence it ends and does
	   not read as a door at all — which a screenshot shows and axe does not (house rule 2). */
	.made a {
		color: inherit;
		text-decoration: underline;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin: 0;
		white-space: normal;
	}
</style>
