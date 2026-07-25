<script lang="ts">
	import type { Topic } from '$lib/types';
	import type { ExerciseFilters } from '$lib/services/exercises';
	import { m } from '$lib/paraglide/messages.js';
	import {
		DIFFICULTIES,
		DIFFICULTY_LABELS,
		SOURCE_TYPES,
		SOURCE_TYPE_LABELS
	} from '$lib/utils/labels';

	let {
		topics,
		filters = $bindable(),
		resultCount
	}: { topics: Topic[]; filters: ExerciseFilters; resultCount: number } = $props();

	function clear() {
		filters.topicId = undefined;
		filters.difficulty = undefined;
		filters.sourceType = undefined;
		filters.query = '';
	}

	let hasActiveFilters = $derived(
		Boolean(filters.topicId || filters.difficulty || filters.sourceType || filters.query)
	);
</script>

<aside class="filters">
	<h2>{m.filters_heading()}</h2>

	<label class="field">
		<span class="visually-hidden">{m.common_search()}</span>
		<input type="search" placeholder={m.filters_searchPlaceholder()} bind:value={filters.query} />
	</label>

	<label class="field">
		<span>{m.filters_topic()}</span>
		<select bind:value={filters.topicId}>
			<option value={undefined}>{m.filters_topic_all()}</option>
			{#each topics as topic (topic.id)}
				<option value={topic.id}>{topic.name}</option>
			{/each}
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
