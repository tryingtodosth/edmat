<script lang="ts">
	// The tag-hover menu's "add to different content" action — search for another Exercise or
	// Material and attach this same tag to it. Debounced text search, reusing the exact services
	// (searchExercises/searchMaterials) built for this modal specifically, since neither existed as
	// a course-agnostic lookup before this feature needed one.
	import type { Material, ResolvedExercise, TaggableKind } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { searchExercises } from '$lib/services/exercises';
	import { searchMaterials } from '$lib/services/materials';
	import { applyTagToContent } from '$lib/services/tags';
	import ModalShell from './ModalShell.svelte';

	let { tag, onClose }: { tag: string; onClose: () => void } = $props();

	let kind = $state<TaggableKind>('exercise');
	let query = $state('');
	let exerciseResults = $state<ResolvedExercise[]>([]);
	let materialResults = $state<Material[]>([]);
	let searching = $state(false);
	let addedIds = $state<Set<string>>(new Set());
	let error = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	function scheduleSearch() {
		clearTimeout(debounceTimer);
		error = '';
		if (!query.trim()) {
			exerciseResults = [];
			materialResults = [];
			return;
		}
		debounceTimer = setTimeout(runSearch, 350);
	}

	async function runSearch() {
		searching = true;
		try {
			if (kind === 'exercise') {
				exerciseResults = await searchExercises(query, getLocale());
			} else {
				materialResults = await searchMaterials(query);
			}
		} finally {
			searching = false;
		}
	}

	function switchKind(next: TaggableKind) {
		kind = next;
		exerciseResults = [];
		materialResults = [];
		if (query.trim()) scheduleSearch();
	}

	async function handleAdd(objectId: string) {
		error = '';
		try {
			await applyTagToContent(tag, kind, objectId);
			addedIds = new Set([...addedIds, objectId]);
		} catch {
			error = m.common_error_generic();
		}
	}
</script>

<ModalShell title={m.tag_addToContentHeading({ tag })} {onClose}>
	<div class="kind-toggle" role="tablist">
		<button
			type="button"
			class:active={kind === 'exercise'}
			role="tab"
			aria-selected={kind === 'exercise'}
			onclick={() => switchKind('exercise')}
		>
			{m.tag_kindExercise()}
		</button>
		<button
			type="button"
			class:active={kind === 'material'}
			role="tab"
			aria-selected={kind === 'material'}
			onclick={() => switchKind('material')}
		>
			{m.tag_kindMaterial()}
		</button>
	</div>

	<input
		type="text"
		bind:value={query}
		oninput={scheduleSearch}
		placeholder={m.tag_searchPlaceholder()}
		aria-label={m.tag_searchPlaceholder()}
	/>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if searching}
		<p class="hint">{m.common_loading()}</p>
	{:else if kind === 'exercise'}
		{#if query.trim() && exerciseResults.length === 0}
			<p class="hint">{m.tag_noResults()}</p>
		{/if}
		<ul class="results">
			{#each exerciseResults as exercise (exercise.id)}
				<li class="result-row">
					<span class="result-row__title">{exercise.title}</span>
					<button
						type="button"
						disabled={addedIds.has(exercise.id)}
						onclick={() => handleAdd(exercise.id)}
					>
						{addedIds.has(exercise.id) ? m.tag_added() : m.tag_addAction()}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		{#if query.trim() && materialResults.length === 0}
			<p class="hint">{m.tag_noResults()}</p>
		{/if}
		<ul class="results">
			{#each materialResults as material (material.id)}
				<li class="result-row">
					<span class="result-row__title">{material.title}</span>
					<button
						type="button"
						disabled={addedIds.has(material.id)}
						onclick={() => handleAdd(material.id)}
					>
						{addedIds.has(material.id) ? m.tag_added() : m.tag_addAction()}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</ModalShell>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.kind-toggle {
		display: flex;
		gap: var(--space-2);
		button {
			@include mix.button-secondary;
			&.active {
				background: var(--accent);
				color: var(--accent-contrast);
				border-color: var(--accent);
			}
		}
	}
	input[type='text'] {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
	.results {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 320px;
		overflow-y: auto;
	}
	.result-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		&:hover {
			background: var(--bg-surface-alt);
		}
		button {
			@include mix.button-secondary;
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-xs);
			flex-shrink: 0;
		}
	}
	.result-row__title {
		font-size: var(--font-size-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
