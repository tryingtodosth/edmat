<script lang="ts">
	// The navbar "Random exercise" control — see CLAUDE.md's own "Random Exercise" note for the
	// full design. Clicking the dice icon itself does an immediate smart roll with whatever filters
	// are currently set (none, by default); the chevron opens a small popover covering every
	// Exercise field that's actually meaningful to filter a random pick by.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Branch, Discipline, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import {
		getRandomExercise,
		getAllTags,
		type RandomExerciseFilters
	} from '$lib/services/exercises';
	import { getBranchesForDiscipline, getDisciplines, getTopicsForBranch } from '$lib/services/taxonomy';
	import { browsingHistoryStore } from '$lib/state/browsingHistory.svelte';
	import {
		DIFFICULTIES,
		DIFFICULTY_LABELS,
		SOURCE_TYPES,
		SOURCE_TYPE_LABELS
	} from '$lib/utils/labels';

	let menuOpen = $state(false);
	let rolling = $state(false);
	let noMatch = $state(false);
	let container: HTMLDivElement | undefined = $state();

	let fields = $state<Discipline[]>([]);
	let branches = $state<Branch[]>([]);
	let topics = $state<Topic[]>([]);
	let allTags = $state<string[]>([]);
	let optionsLoaded = $state(false);

	let filters = $state<RandomExerciseFilters>({});

	async function loadFilterOptions() {
		if (optionsLoaded) return;
		optionsLoaded = true;
		[fields, allTags] = await Promise.all([getDisciplines(), getAllTags()]);
	}

	async function onFieldChange(next: string) {
		filters.disciplineId = next || undefined;
		filters.branchId = undefined;
		filters.topicId = undefined;
		branches = filters.disciplineId ? await getBranchesForDiscipline(filters.disciplineId) : [];
		topics = [];
	}

	async function onCourseChange(next: string) {
		filters.branchId = next || undefined;
		filters.topicId = undefined;
		topics = filters.branchId ? await getTopicsForBranch(filters.branchId) : [];
	}

	function clearFilters() {
		filters = {};
		branches = [];
		topics = [];
	}

	async function roll() {
		rolling = true;
		noMatch = false;
		const exercise = await getRandomExercise(
			getLocale(),
			filters,
			browsingHistoryStore.seenIds,
			browsingHistoryStore.topicAffinity
		);
		rolling = false;
		if (!exercise) {
			noMatch = true;
			return;
		}
		menuOpen = false;
		goto(resolve('/exercises/[id]', { id: exercise.id }));
	}

	function toggleMenu() {
		menuOpen = !menuOpen;
		if (menuOpen) loadFilterOptions();
	}

	function handleWindowClick(event: MouseEvent) {
		if (menuOpen && container && !container.contains(event.target as Node)) {
			menuOpen = false;
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') menuOpen = false;
	}
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<div class="random-picker" bind:this={container}>
	<div class="random-picker__buttons">
		<button
			type="button"
			class="dice-button"
			onclick={roll}
			disabled={rolling}
			title={m.random_quickRoll()}
			aria-label={m.random_quickRoll()}
		>
			<span aria-hidden="true">🎲</span>
		</button>
		<button
			type="button"
			class="menu-toggle"
			onclick={toggleMenu}
			aria-expanded={menuOpen}
			aria-label={m.random_openFilters()}
		>
			<span aria-hidden="true">▾</span>
		</button>
	</div>

	{#if menuOpen}
		<div class="random-menu no-print" role="menu">
			<h3>{m.random_heading()}</h3>
			<p class="subtitle">{m.random_subtitle()}</p>

			<label class="field">
				<span>{m.random_field()}</span>
				<select
					value={filters.disciplineId ?? ''}
					onchange={(e) => onFieldChange((e.target as HTMLSelectElement).value)}
				>
					<option value="">{m.random_any()}</option>
					{#each fields as field (field.id)}
						<option value={field.id}>{field.name}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>{m.random_course()}</span>
				<select
					value={filters.branchId ?? ''}
					disabled={branches.length === 0}
					onchange={(e) => onCourseChange((e.target as HTMLSelectElement).value)}
				>
					<option value="">{m.random_any()}</option>
					{#each branches as branch (branch.id)}
						<option value={branch.id}>{branch.name}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>{m.random_topic()}</span>
				<select bind:value={filters.topicId} disabled={topics.length === 0}>
					<option value={undefined}>{m.random_any()}</option>
					{#each topics as topic (topic.id)}
						<option value={topic.id}>{topic.name}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>{m.filters_difficulty()}</span>
				<select bind:value={filters.difficulty}>
					<option value={undefined}>{m.random_any()}</option>
					{#each DIFFICULTIES as d (d)}
						<option value={d}>{DIFFICULTY_LABELS[d]()}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>{m.filters_sourceType()}</span>
				<select bind:value={filters.sourceType}>
					<option value={undefined}>{m.random_any()}</option>
					{#each SOURCE_TYPES as s (s)}
						<option value={s}>{SOURCE_TYPE_LABELS[s]()}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>{m.random_tag()}</span>
				<select bind:value={filters.tag}>
					<option value={undefined}>{m.random_any()}</option>
					{#each allTags as tag (tag)}
						<option value={tag}>{tag}</option>
					{/each}
				</select>
			</label>

			<label class="checkbox">
				<input type="checkbox" bind:checked={filters.verifiedOnly} />
				{m.random_verifiedOnly()}
			</label>

			{#if noMatch}
				<p class="notice">{m.random_noMatch()}</p>
			{/if}

			<div class="random-menu__actions">
				<button type="button" class="clear" onclick={clearFilters}>{m.filters_clear()}</button>
				<button type="button" class="roll" onclick={roll} disabled={rolling}>
					<span aria-hidden="true">🎲</span>
					{m.random_roll()}
				</button>
			</div>
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.random-picker {
		position: relative;
	}
	.random-picker__buttons {
		display: flex;
		align-items: stretch;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.dice-button,
	.menu-toggle {
		@include mix.focus-ring;
		background: var(--bg-surface);
		border: none;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-base);
		&:hover:not(:disabled) {
			background: var(--bg-surface-alt);
		}
		&:disabled {
			opacity: 0.5;
			cursor: wait;
		}
	}
	.menu-toggle {
		border-left: 1px solid var(--border-color);
		font-size: var(--font-size-xs);
		padding-inline: var(--space-1);
	}

	.random-menu {
		@include mix.card-surface;
		position: absolute;
		top: calc(100% + var(--space-2));
		right: 0;
		width: 280px;
		max-height: 80vh;
		overflow-y: auto;
		box-shadow: var(--shadow-popover);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		z-index: var(--z-popover);
	}
	.random-menu h3 {
		font-size: var(--font-size-base);
	}
	.subtitle {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	select,
	input[type='checkbox'] {
		@include mix.focus-ring;
	}
	select {
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		&:disabled {
			opacity: 0.5;
		}
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	.notice {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.random-menu__actions {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
	}
	.clear {
		@include mix.button-secondary;
		font-size: var(--font-size-xs);
	}
	.roll {
		@include mix.button-primary;
		flex: 1;
		font-size: var(--font-size-xs);
		&:disabled {
			cursor: wait;
		}
	}
</style>
