<script lang="ts">
	/**
	 * A deck as its own summary: the name, how many cards, how many due today, where it came from
	 * and — when it has a placement — which course or event it sits on.
	 *
	 * A twin of what step A's `/flashcards` list draws, not a copy of it: on a real deck list each
	 * tile is a link into the deck and carries a review button, and a sample of those would be a
	 * sample of two dead controls. The fields are the read shape fixed in `prompts/02-flashcards.md`
	 * §API (`card_count`, `due_count`, `source_kind`, `is_public`, `placements`), so when step A
	 * lands, a reader comparing the two sees the same facts in the same order.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { ShowcaseDeck } from '$lib/content/showcase';

	let { deck }: { deck: ShowcaseDeck } = $props();

	const SOURCE_LABEL = {
		set: () => m.showcase_deckFromSet(), // "made from a set"
		lesson: () => m.showcase_deckFromLesson(), // "made from a lesson"
		session: () => m.showcase_deckFromSession(), // "made from a session"
		concept: () => m.showcase_deckFromConcept() // "made from a concept"
	};
	const source = $derived(deck.source ? SOURCE_LABEL[deck.source]() : '');
	// Joined in JS rather than interleaved in the template: `{source} · {#if}…{/if}` lost the space
	// after the separator to Svelte's whitespace handling, and "made from a set ·private to its
	// owner" is the kind of thing only a screenshot tells you about.
	const meta = $derived(
		[source, deck.isPublic ? '' : m.showcase_deckPrivate()].filter(Boolean).join(' · ')
	); // "private to its owner"
	const placement = $derived(
		deck.placedOn
			? deck.placedOn.kind === 'course'
				? m.showcase_deckPlacedOnCourse({ name: deck.placedOn.name }) // "placed on the course “{name}”"
				: m.showcase_deckPlacedOnEvent({ name: deck.placedOn.name }) // "placed on the event “{name}”"
			: ''
	);
</script>

<div class="deck">
	<p class="deck__name">{deck.name}</p>
	<p class="deck__counts">
		<span class="deck__count">{m.showcase_deckCards({ count: deck.cardCount })}</span>
		<!-- "{count} cards" -->
		{#if deck.dueCount > 0}
			<span class="deck__count deck__count--due"
				>{m.showcase_deckDue({ count: deck.dueCount })}</span
			>
			<!-- "{count} due today" -->
		{:else}
			<span class="deck__count">{m.showcase_deckNoneDue()}</span>
			<!-- "nothing due today" -->
		{/if}
	</p>
	<p class="deck__meta">{meta}</p>
	{#if placement}
		<p class="deck__placement">{placement}</p>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.deck {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-width: 26rem;
	}
	.deck__name {
		margin: 0;
		font-weight: 600;
	}
	.deck__counts {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.deck__count {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		font-size: var(--font-size-xs);
	}
	// Due today asks you, so it takes the info pair.
	.deck__count--due {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
		font-size: var(--font-size-xs);
		font-weight: 700;
	}
	.deck__meta,
	.deck__placement {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.deck__placement {
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-2);
		margin-top: var(--space-1);
	}
</style>
