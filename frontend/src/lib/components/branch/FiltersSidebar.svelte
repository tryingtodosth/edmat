<script lang="ts">
	import { onMount } from 'svelte';
	import type { Topic } from '$lib/types';
	import type { ExerciseFilters } from '$lib/services/exercises';
	import { m } from '$lib/paraglide/messages.js';
	import TaxonomyOptions from '$lib/components/shared/TaxonomyOptions.svelte';
	import {
		DIFFICULTIES,
		DIFFICULTY_LABELS,
		SOURCE_TYPES,
		SOURCE_TYPE_LABELS
	} from '$lib/utils/labels';
	import { createSearchCommitter } from '$lib/utils/textInput';

	let {
		topics,
		filters = $bindable(),
		resultCount
	}: { topics: Topic[]; filters: ExerciseFilters; resultCount: number } = $props();

	// The box holds what the visitor is typing; `filters.query` holds the question actually being
	// asked of the server. Keeping the two apart is what turns a word into one request instead of one
	// per letter, and it is why the debounce lives here rather than around the branch page's own
	// fetching effect — that effect also runs for the three selects below, and a dropdown pick should
	// answer at once rather than waiting out a delay meant for typing.
	let draft = $state(filters.query ?? '');
	let boxEl = $state<HTMLInputElement | undefined>(undefined);
	const search = createSearchCommitter((query) => (filters.query = query), {
		initial: filters.query ?? ''
	});

	// This page is rendered on the server, so somebody can start typing into the box a second or two
	// before the client has attached a single handler to it. `bind:value` recovers that text into
	// `draft` on hydration — but no `oninput` ever ran for it, so nothing scheduled a search and the
	// box would sit showing a word the results never answered. Read it off the element rather than off
	// `draft`, so this holds regardless of how the binding hydrates.
	onMount(() => {
		const typedBeforeHydration = boxEl?.value ?? '';
		if (typedBeforeHydration && typedBeforeHydration !== search.committed) {
			draft = typedBeforeHydration;
			search.typed(typedBeforeHydration);
		}
	});

	// `filters.query` is written from outside this component too: `clear()` below, and the branch page
	// resetting the whole filter object when the visitor navigates to a different branch. Adopt such
	// a change so the box does not go on showing a word that is no longer filtering anything —
	// comparing against what this box itself last pushed, so its own writes arrive as an echo and are
	// ignored rather than fought.
	$effect(() => {
		const external = filters.query ?? '';
		if (external === search.committed) return;
		search.adopt(external);
		draft = external;
	});

	function clear() {
		filters.topicId = undefined;
		filters.difficulty = undefined;
		filters.sourceType = undefined;
		filters.query = '';
		// Clearing has to reach the box itself, not only the committed query: a query below the
		// minimum length was never committed, so `filters.query` is already '' and the effect above
		// would correctly see nothing to do while the text sat there.
		search.adopt('');
		draft = '';
	}

	// Reads `draft`, not `filters.query`, deliberately: text too short to have been committed is
	// still text on screen, and offering no way to clear it would leave the visitor looking at a
	// query that is quietly being ignored.
	let hasActiveFilters = $derived(
		Boolean(filters.topicId || filters.difficulty || filters.sourceType || draft)
	);
</script>

<aside class="filters">
	<h2>{m.filters_heading()}</h2>

	<label class="field">
		<span class="visually-hidden">{m.common_search()}</span>
		<!-- `bind:value` keeps the box's own display state, and the handlers read the value off their
		     own event rather than off `draft`, so nothing depends on which of the two runs first. A
		     one-way `value={draft}` was tried and reverted: it overwrites anything typed before
		     hydration, which on this page is a real one-to-two-second window. -->
		<input
			bind:this={boxEl}
			type="search"
			placeholder={m.filters_searchPlaceholder()}
			bind:value={draft}
			oninput={(e) => search.typed(e.currentTarget.value)}
			oncompositionstart={search.compositionStart}
			oncompositionend={(e) => search.compositionEnd(e.currentTarget.value)}
		/>
	</label>

	<label class="field">
		<span>{m.filters_topic()}</span>
		<select bind:value={filters.topicId}>
			<option value={undefined}>{m.filters_topic_all()}</option>
			<TaxonomyOptions nodes={topics} />
		</select>
	</label>

	<label class="field">
		<span>{m.filters_difficulty()}</span>
		<select bind:value={filters.difficulty}>
			<option value={undefined}>{m.filters_difficulty_all()}</option>
			{#each DIFFICULTIES as d (d)}
				<option value={d}>{DIFFICULTY_LABELS[d]()}</option>
			{/each}
		</select>
	</label>

	<label class="field">
		<span>{m.filters_sourceType()}</span>
		<select bind:value={filters.sourceType}>
			<option value={undefined}>{m.filters_sourceType_all()}</option>
			{#each SOURCE_TYPES as s (s)}
				<option value={s}>{SOURCE_TYPE_LABELS[s]()}</option>
			{/each}
		</select>
	</label>

	<div class="filters__footer">
		<span class="result-count">{m.filters_resultCount({ count: resultCount })}</span>
		{#if hasActiveFilters}
			<button type="button" class="link-button" onclick={clear}>{m.filters_clear()}</button>
		{/if}
	</div>
</aside>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.filters {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h2 {
		font-size: var(--font-size-base);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	input,
	select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
	}
	.filters__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
	}
	.result-count {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.link-button {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		color: var(--accent);
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
</style>
