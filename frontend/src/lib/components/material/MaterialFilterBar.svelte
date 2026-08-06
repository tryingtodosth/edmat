<script lang="ts">
	// The materials search/filter/sort overhaul's own real filter/sort UI — reused by both the
	// cross-branch browse hub (routes/materials/+page.svelte, `scope: 'global'`) and the per-branch
	// Materials tab (routes/branches/[branch]/+page.svelte, `scope: 'branch'`), rather than two
	// independent, drifting implementations. Reads `materialsUiStore.mode` directly (not a prop) so
	// every mount of this bar always reflects the ONE real, shared "simple vs advanced" preference
	// — set from Settings, or via this bar's own quick toggle, both write to the same store.
	import type { Branch, Discipline, MaterialBrowseFilters, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getBranchesForDiscipline, getTopicsForBranch } from '$lib/services/taxonomy';
	import { materialsUiStore } from '$lib/state/materialsUi.svelte';
	import TaxonomyOptions from '$lib/components/shared/TaxonomyOptions.svelte';
	import {
		MATERIAL_SORTS,
		MATERIAL_SORT_LABELS,
		MATERIAL_TYPES,
		MATERIAL_TYPE_LABELS
	} from '$lib/utils/labels';

	let {
		filters = $bindable(),
		resultCount,
		scope,
		fields = [],
		topics: courseTopics = []
	}: {
		filters: MaterialBrowseFilters;
		resultCount: number;
		scope: 'branch' | 'global';
		fields?: Discipline[];
		topics?: Topic[];
	} = $props();

	// Global scope only: cascading field -> branch -> topic, the exact same pattern
	// RandomExerciseButton.svelte already established for the identical field/branch/topic
	// cascade — reused deliberately, not reinvented, since it's already the app's own proven shape
	// for "pick a field, then a branch scoped to it, then a topic scoped to that."
	let branches = $state<Branch[]>([]);
	let globalTopics = $state<Topic[]>([]);

	async function onFieldChange(next: string) {
		filters.disciplineId = next || undefined;
		filters.branchId = undefined;
		filters.topicId = undefined;
		branches = filters.disciplineId ? await getBranchesForDiscipline(filters.disciplineId) : [];
		globalTopics = [];
	}

	async function onCourseChange(next: string) {
		filters.branchId = next || undefined;
		filters.topicId = undefined;
		globalTopics = filters.branchId ? await getTopicsForBranch(filters.branchId) : [];
	}

	// `scope === 'branch'` always has its topic list handed in directly (the branch is already
	// known/fixed by the URL); `scope === 'global'` only has one once a branch has been picked.
	let topicOptions = $derived(scope === 'branch' ? courseTopics : globalTopics);

	function clear() {
		if (scope === 'global') {
			filters.disciplineId = undefined;
			filters.branchId = undefined;
			branches = [];
			globalTopics = [];
		}
		filters.type = undefined;
		filters.tag = undefined;
		filters.topicId = undefined;
		filters.minLevel = undefined;
		filters.query = '';
		filters.sort = undefined;
	}

	let hasActiveFilters = $derived(
		Boolean(
			filters.type ||
			filters.tag ||
			filters.topicId ||
			filters.minLevel ||
			filters.query ||
			filters.sort ||
			(scope === 'global' && (filters.disciplineId || filters.branchId))
		)
	);

	let advanced = $derived(materialsUiStore.mode === 'advanced');
</script>

<div class="material-filters">
	<div class="material-filters__header">
		<h2>{m.materialFilters_heading()}</h2>
		<button
			type="button"
			class="mode-toggle"
			onclick={() => materialsUiStore.toggle()}
			title={m.materialFilters_modeToggleHint()}
		>
			{advanced ? m.materialFilters_modeAdvanced() : m.materialFilters_modeSimple()}
		</button>
	</div>

	<label class="field">
		<span class="visually-hidden">{m.common_search()}</span>
		<input
			type="search"
			placeholder={m.materialFilters_searchPlaceholder()}
			bind:value={filters.query}
		/>
	</label>

	<label class="field">
		<span>{m.materialFilters_type()}</span>
		<select bind:value={filters.type}>
			<option value={undefined}>{m.materialFilters_type_all()}</option>
			{#each MATERIAL_TYPES as type (type)}
				<option value={type}>{MATERIAL_TYPE_LABELS[type]()}</option>
			{/each}
		</select>
	</label>

	<label class="field">
		<span>{m.materialFilters_sort()}</span>
		<select bind:value={filters.sort}>
			<option value={undefined}>{m.materialFilters_sort_default()}</option>
			{#each MATERIAL_SORTS as sort (sort)}
				<option value={sort}>{MATERIAL_SORT_LABELS[sort]()}</option>
			{/each}
		</select>
	</label>

	{#if advanced}
		<div class="advanced-section">
			{#if scope === 'global'}
				<label class="field">
					<span>{m.materialFilters_field()}</span>
					<select
						value={filters.disciplineId ?? ''}
						onchange={(e) => onFieldChange((e.target as HTMLSelectElement).value)}
					>
						<option value="">{m.materialFilters_field_all()}</option>
						<TaxonomyOptions nodes={fields} />
					</select>
				</label>

				<label class="field">
					<span>{m.materialFilters_course()}</span>
					<select
						value={filters.branchId ?? ''}
						disabled={!filters.disciplineId}
						onchange={(e) => onCourseChange((e.target as HTMLSelectElement).value)}
					>
						<option value="">{m.materialFilters_course_all()}</option>
						<TaxonomyOptions nodes={branches} />
					</select>
				</label>
			{/if}

			<label class="field">
				<span>{m.filters_topic()}</span>
				<select bind:value={filters.topicId} disabled={topicOptions.length === 0}>
					<option value={undefined}>{m.filters_topic_all()}</option>
					<TaxonomyOptions nodes={topicOptions} />
				</select>
			</label>

			<label class="field">
				<span>{m.materialFilters_minLevel({ level: filters.minLevel ?? 0 })}</span>
				<input
					type="range"
					min="0"
					max="100"
					step="5"
					value={filters.minLevel ?? 0}
					oninput={(e) => {
						const v = Number((e.target as HTMLInputElement).value);
						filters.minLevel = v > 0 ? v : undefined;
					}}
				/>
			</label>

			<label class="field">
				<span>{m.materialFilters_tag()}</span>
				<input
					type="text"
					placeholder={m.materialFilters_tagPlaceholder()}
					bind:value={filters.tag}
				/>
			</label>
		</div>
	{/if}

	<div class="material-filters__footer">
		<span class="result-count">{m.filters_resultCount({ count: resultCount })}</span>
		{#if hasActiveFilters}
			<button type="button" class="link-button" onclick={clear}>{m.filters_clear()}</button>
		{/if}
	</div>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.material-filters {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.material-filters__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	h2 {
		font-size: var(--font-size-base);
	}
	.mode-toggle {
		@include mix.focus-ring;
		@include mix.status-pill(var(--accent), var(--accent-soft));
		border: none;
		cursor: pointer;
		font-weight: 600;
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
		color: var(--text-primary);
	}
	input[type='range'] {
		padding: 0;
	}
	.advanced-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px dashed var(--border-color);
	}
	.material-filters__footer {
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
