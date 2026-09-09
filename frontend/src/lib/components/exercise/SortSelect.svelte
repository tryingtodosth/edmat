<script lang="ts">
	/** The exercise sort control (AUDIENCE-BRIEF.md §4): eight keys, each with a natural direction,
	 * and a flip. The choice lives in the URL (shareable) and the last one is remembered locally. */
	import { m } from '$lib/paraglide/messages.js';
	import type { ExerciseSort } from '$lib/services/exercises';
	import { EXERCISE_SORTS, EXERCISE_SORT_LABELS } from '$lib/utils/labels';

	let {
		sort = $bindable<ExerciseSort | ''>(''),
		dir = $bindable<'asc' | 'desc' | ''>('')
	}: { sort: ExerciseSort | ''; dir: 'asc' | 'desc' | '' } = $props();
</script>

<div class="sort" role="group" aria-label={m.sort_label()}>
	<label>
		<span>{m.sort_label()}</span>
		<select bind:value={sort}>
			<option value="">{m.sort_default()}</option>
			{#each EXERCISE_SORTS as key (key)}
				<option value={key}>{EXERCISE_SORT_LABELS[key]()}</option>
			{/each}
		</select>
	</label>
	{#if sort}
		<button
			type="button"
			aria-label={m.sort_flip()}
			title={m.sort_flip()}
			onclick={() => (dir = dir === 'asc' ? 'desc' : dir === 'desc' ? '' : 'asc')}
		>
			{dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕'}
		</button>
	{/if}
</div>

<style lang="scss">
	.sort {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 0.6rem;
		font-size: 0.9rem;
	}
	label {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	select,
	button {
		font: inherit;
		min-height: 40px;
		padding: 0 0.6rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
	}
</style>
