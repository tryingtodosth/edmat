<script lang="ts">
	/** The decks placed on a course or an event (prompts/02-flashcards.md). Mounted once at the
	 * `learning: deck placements (A)` marker on `routes/courses/[id]/+page.svelte` and once on
	 * `routes/events/[id]/+page.svelte` — two markers, one component, nothing shared beyond it
	 * (prompts/01-prep.md's own note on why there is no `ManagementPanels`-style registry for the
	 * learning layer: one panel on two pages is not a registry's worth of indirection).
	 *
	 * **Draws nothing at all** when the kill switch is off (house rule 3 — the panel is a link to
	 * the feature, and a killed feature takes its links with it), when the API 404s (a reader who
	 * cannot see this node cannot see what is hung on it — house rule 4), and when there is nothing
	 * here and nothing this reader could do about it. A manager with no decks of their own gets one
	 * honest line rather than an empty select.
	 *
	 * It takes `nodeKind`/`nodeId` rather than a `NodeRef`, because unlike the management panels it
	 * does not mount inside anything that has already resolved one, and asking for the node again
	 * would be a second request for an answer the page above already has in its own shape.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { getMyDecks, getNodeDecks, placeDeck, removePlacement } from '$lib/services/flashcards';
	import type { Deck, NodeDeckPlacement } from '$lib/types/flashcards';
	import { deckRefusalMessage } from '$lib/utils/labels';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';

	let {
		nodeKind,
		nodeId,
		canManage = false
	}: { nodeKind: 'course' | 'event'; nodeId: string; canManage?: boolean } = $props();

	const canSee = $derived(featureFlagsStore.isEnabled('flashcards') || authStore.isModerator);

	let placements = $state<NodeDeckPlacement[]>([]);
	let myDecks = $state<Deck[]>([]);
	let unavailable = $state(false);
	let loadedFor = $state('');
	let chosen = $state('');
	let busy = $state('');
	let error = $state('');

	async function load() {
		try {
			placements = await getNodeDecks(nodeKind, nodeId);
			unavailable = false;
		} catch {
			// A 404 (not for this reader, or nothing there) and a network hiccup look the same from
			// here, and in both cases an empty panel is the honest thing to show rather than an
			// error nobody on this page can act on — `NeedsPanel` makes the same call.
			placements = [];
			unavailable = true;
		}
		if (canManage && authStore.isAuthenticated) {
			try {
				myDecks = await getMyDecks();
			} catch {
				myDecks = [];
			}
		}
	}

	// Keyed on the node AND on who is asking, the idempotency guard every panel here needs: every
	// `can*` answer changes the moment a session resolves, and an unguarded effect that reads the
	// state it writes re-fires itself (frontend/CLAUDE.md traps 2 and 4).
	$effect(() => {
		const key = `${nodeKind}:${nodeId}:${authStore.user?.id ?? 'anon'}:${canManage}`;
		if (!canSee || key === loadedFor) return;
		loadedFor = key;
		void load();
	});

	/** The decks not already on this node — offering one that is there would earn an
	 * `already_placed` refusal the person could have been spared. */
	const placeable = $derived(
		myDecks.filter((deck) => !placements.some((p) => p.deck.id === deck.id))
	);

	async function place() {
		if (!chosen) return;
		busy = 'place';
		error = '';
		try {
			await placeDeck(chosen, { kind: nodeKind, id: nodeId });
			chosen = '';
			await load();
		} catch (e) {
			error = deckRefusalMessage(e, m.decks_error());
		} finally {
			busy = '';
		}
	}

	async function unplace(id: string) {
		busy = id;
		error = '';
		try {
			await removePlacement(id);
			await load();
		} catch (e) {
			error = deckRefusalMessage(e, m.decks_error());
		} finally {
			busy = '';
		}
	}
</script>

{#if canSee && !unavailable && (placements.length > 0 || canManage)}
	<section class="decks-panel">
		<h2>{m.decks_panelHeading()}</h2>
		<!-- "Flashcards" -->

		{#if placements.length === 0}
			<p class="hint">{m.decks_panelEmpty()}</p>
			<!-- "No decks here yet." -->
		{:else}
			<ul>
				{#each placements as placement (placement.id)}
					<li>
						<div class="row__text">
							<a href={resolve(`/flashcards/${placement.deck.id}`)}>
								<MathTitle text={placement.deck.name} />
							</a>
							<span class="meta">
								{m.decks_cardCount({ count: placement.deck.cardCount })}
								<!-- "{count} cards" -->
								{#if placement.addedBy}
									· {m.decks_byOwner({ name: placement.addedBy.displayName })}
									<!-- "by {name}" -->
								{/if}
							</span>
						</div>
						<div class="row__actions">
							{#if placement.deck.cardCount > 0}
								<a class="study" href={resolve(`/flashcards/${placement.deck.id}/review`)}>
									{placement.deck.dueCount > 0
										? m.decks_dueCount({ count: placement.deck.dueCount })
										: m.decks_panelStudy()}
									<!-- "{count} to review" / "Study" -->
								</a>
							{/if}
							{#if canManage}
								<button
									type="button"
									class="link-button"
									disabled={busy === placement.id}
									onclick={() => unplace(placement.id)}
								>
									{m.decks_unplace()}
									<!-- "Remove from here" -->
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if canManage}
			{#if placeable.length > 0}
				<form onsubmit={(e) => (e.preventDefault(), place())}>
					<label>
						<span>{m.decks_panelPlace()}</span>
						<!-- "Place one of my decks here" -->
						<select bind:value={chosen}>
							<option value="">{m.decks_placeChoose()}</option>
							{#each placeable as deck (deck.id)}
								<option value={deck.id}>{deck.name}</option>
							{/each}
						</select>
					</label>
					<button type="submit" disabled={busy === 'place' || !chosen}>{m.decks_place()}</button>
					<!-- "Place" -->
				</form>
			{:else if myDecks.length === 0}
				<p class="hint">
					{m.decks_panelNoDecks()}
					<!-- "You have no decks to place yet." -->
					<a href={resolve('/flashcards')}>{m.decks_navMine()}</a>
					<!-- "My decks" -->
				</p>
			{/if}
		{/if}

		{#if error}
			<p class="error">{error}</p>
		{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.decks-panel {
		@include mix.card-surface;
		padding: var(--space-3);
		display: grid;
		gap: var(--space-2);
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-lg);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}

	li {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.row__text {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}

	.row__actions {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
	}

	.meta,
	.hint {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin: 0;
	}

	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
		margin: 0;
	}

	.study {
		@include mix.button-secondary;
		text-decoration: none;
		font-size: var(--font-size-sm);
	}

	form {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
		flex-wrap: wrap;

		label {
			display: grid;
			gap: 0.2rem;
			flex: 1 1 14rem;
			min-width: 0;
		}

		span {
			color: var(--text-secondary);
			font-size: var(--font-size-sm);
		}

		button {
			@include mix.button-secondary;
		}
	}

	.link-button {
		@include mix.focus-ring;
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
		padding: 0.1rem 0.2rem;

		&:disabled {
			cursor: progress;
			opacity: 0.6;
		}
	}
</style>
