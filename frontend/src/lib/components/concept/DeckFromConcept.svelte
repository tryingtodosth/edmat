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
	 * There is deliberately no link to the deck that comes back. `/flashcards/[id]` is step A's
	 * route and does not exist on this branch; a link to a route that is not there is the exact bug
	 * `CLAUDE.md` house rule 2 records finding in a browser ("an invite link pointing at a route
	 * renamed months earlier"). The confirmation names the deck; the integrator adds the link.
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
	let made = $state('');
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
		made = '';
		try {
			const deck = await createDeckFromExercises({
				name: m.paths_deck_name({ title }), // "Flashcards: {title}"
				exerciseIds: exercises.map((row) => row.id),
				source: { kind: 'concept', id: conceptId }
			});
			made = deck.name || m.paths_deck_name({ title });
		} catch {
			// One sentence for every failure, deliberately: until step A's endpoint exists there is
			// no refusal vocabulary to translate, and inventing reasons it might answer with would
			// be guessing at somebody else's API (house rule 10 — say what is known).
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
	<p class="made" role="status">{m.paths_deck_made({ name: made })}</p>
	<!-- "Deck made: {name}" -->
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
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin: 0;
		white-space: normal;
	}
</style>
