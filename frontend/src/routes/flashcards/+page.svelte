<script lang="ts">
	/** `/flashcards` — my decks, and what is waiting (prompts/02-flashcards.md).
	 *
	 * Behind the `flashcards` kill switch: with the flag off this page draws the same "not
	 * available" line every gated route does and the account-menu entry that leads here is gone
	 * (house rule 3 — a killed feature removes its LINKS, not just its pages). The flag store fails
	 * OPEN until the first `/feature-flags/` response lands, so the page is not withheld from
	 * everybody for the length of one request.
	 *
	 * The initial load is in an `$effect` keyed on the session, not `onMount`: a hard reload reads
	 * `authStore.isAuthenticated` once in mount, possibly before the async `init()` resolves, and
	 * then shows an empty page to somebody with a valid token (frontend/CLAUDE.md trap 3).
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { createDeck, getDueSummary, getMyDecks } from '$lib/services/flashcards';
	import type { Deck, DueSummary } from '$lib/types/flashcards';
	import { deckSourceLabel } from '$lib/utils/labels';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	// The same expression `FeatureGate` uses to decide whether to draw the page at all — kept here
	// as well because the EFFECT must not fire a request the API would refuse with a 403 while the
	// switch is off (and `isModerator` mirrors the backend's own `is_staff` bypass).
	const canSee = $derived(featureFlagsStore.isEnabled('flashcards') || authStore.isModerator);

	let decks = $state<Deck[]>([]);
	let due = $state<DueSummary>({ decks: [], total: 0 });
	let loading = $state(true);
	let loadedFor = $state('');
	let newName = $state('');
	let busy = $state(false);
	let error = $state('');

	async function load() {
		loading = true;
		try {
			// Settled rather than awaited in sequence: two independent requests, and one failing
			// should not decide whether the other's answer appears.
			const [deckRows, summary] = await Promise.allSettled([getMyDecks(), getDueSummary()]);
			decks = deckRows.status === 'fulfilled' ? deckRows.value : [];
			due = summary.status === 'fulfilled' ? summary.value : { decks: [], total: 0 };
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const key = `${canSee ? 'on' : 'off'}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		if (!canSee || !authStore.isAuthenticated) {
			decks = [];
			due = { decks: [], total: 0 };
			loading = false;
			return;
		}
		void load();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const name = newName.trim();
		if (!name) return;
		busy = true;
		error = '';
		try {
			const created = await createDeck(name);
			decks = [created, ...decks];
			newName = '';
		} catch {
			error = m.decks_error(); // "That did not work. Try again."
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(m.decks_title())}</title>
</svelte:head>

<FeatureGate feature="flashcards">
	<div class="page">
		<header>
			<h1>{m.decks_title()}</h1>
			<!-- "My decks" -->
			<p class="subtitle">{m.decks_subtitle()}</p>
			<!-- "Decks of flashcards you have made, and what is waiting to be reviewed." -->
		</header>

		{#if authStore.restoring}
			<p class="session-restoring">{m.common_loading()}</p>
		{:else if !authStore.isAuthenticated}
			<!-- A gated page offers the DOOR, not only the refusal. This one printed "Sign in to keep
			     decks…" as flat text and left the reader to find /login themselves, while every other
			     gated page here (/notifications, /messages, /settings, /submit, /tutoring/watchlist)
			     makes the sign-in line itself the link. Same shape, same class name, and the
			     `restoring` branch above is the other half of that pattern: without it somebody
			     reloading with a valid token is shown a refusal for the length of one request. -->
			<p data-session-hidden class="login-prompt">
				<a href={resolve('/login')}>{m.decks_signInNote()}</a>
				<!-- "Sign in to keep decks and a review schedule." -->
			</p>
		{:else}
			<p class="due" data-testid="due-summary">
				{#if due.total > 0}
					{m.decks_dueSummary({ cards: due.total, decks: due.decks.length })}
					<!-- "{cards} cards waiting across {decks} decks." -->
				{:else}
					{m.decks_dueSummaryNone()}
					<!-- "Nothing is waiting right now." -->
				{/if}
			</p>

			<form class="new-deck" onsubmit={submit}>
				<!-- type="text", never type="number" — frontend/CLAUDE.md trap 1; this one is a name
			     anyway, but the rule is that every bound input here is a string. -->
				<input
					type="text"
					bind:value={newName}
					maxlength="120"
					placeholder={m.decks_newNamePlaceholder()}
				/>
				<button type="submit" disabled={busy || !newName.trim()}>{m.decks_create()}</button>
				<!-- "Create deck" -->
			</form>
			{#if error}
				<p class="error">{error}</p>
			{/if}

			{#if loading}
				<p class="status">{m.common_loading()}</p>
			{:else if decks.length === 0}
				<p class="status">{m.decks_empty()}</p>
				<!-- "No decks yet. Make one from a saved set, or start an empty one below." -->
			{:else}
				<ul class="decks">
					{#each decks as deck (deck.id)}
						<li class="deck">
							<div class="deck__head">
								<h2><MathTitle text={deck.name} /></h2>
								<span class="deck__due" class:deck__due--none={deck.dueCount === 0}>
									{deck.dueCount > 0
										? m.decks_dueCount({ count: deck.dueCount })
										: m.decks_dueNone()}
									<!-- "{count} to review" / "Nothing to review" -->
								</span>
							</div>
							<p class="deck__meta">
								{m.decks_cardCount({ count: deck.cardCount })}
								<!-- "{count} cards" -->
								· {deckSourceLabel(deck.sourceKind)}
							</p>
							<div class="deck__actions">
								<a class="deck__open" href={resolve(`/flashcards/${deck.id}`)}>{m.decks_open()}</a>
								<!-- "Open" -->
								{#if deck.cardCount > 0}
									<a class="deck__review" href={resolve(`/flashcards/${deck.id}/review`)}>
										{m.decks_review()}
										<!-- "Review" -->
									</a>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

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

	.subtitle,
	.status {
		color: var(--text-secondary);
		margin: 0;
	}

	// The same two rules /notifications gives its own sign-in line: the prompt reads as secondary
	// copy, and the link inside it reads as a link.
	.login-prompt {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.login-prompt a {
		color: var(--accent);
		font-weight: 600;
	}

	.due {
		@include mix.card-surface;
		margin: 0;
		padding: var(--space-3);
	}

	.new-deck {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;

		input {
			flex: 1 1 14rem;
			min-width: 0;
		}

		button {
			@include mix.button-primary;
		}
	}

	.error {
		color: var(--status-danger);
		margin: 0;
	}

	.decks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}

	.deck {
		@include mix.card-surface;
		padding: var(--space-3);
		display: grid;
		gap: var(--space-2);
	}

	.deck__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;

		h2 {
			margin: 0;
			font-size: var(--font-size-lg);
		}
	}

	.deck__due {
		color: var(--accent);
		font-size: var(--font-size-sm);
		white-space: nowrap;

		&--none {
			color: var(--text-secondary);
		}
	}

	.deck__meta {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}

	.deck__actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.deck__open {
		@include mix.button-secondary;
		text-decoration: none;
	}

	.deck__review {
		@include mix.button-primary;
		text-decoration: none;
	}
</style>
