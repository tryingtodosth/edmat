<script lang="ts">
	// The tag-hover menu's "add to different content" action — search for another Exercise or
	// Material and attach this same tag to it. Debounced text search, reusing the exact services
	// (searchExercises/searchMaterials) built for this modal specifically, since neither existed as
	// a branch-agnostic lookup before this feature needed one.
	import type { Material, ResolvedExercise, TaggableKind } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { searchExercises } from '$lib/services/exercises';
	import { searchMaterials } from '$lib/services/materials';
	import { applyTagToContent } from '$lib/services/tags';
	import { compositionTracker } from '$lib/utils/textInput';
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

	// An input method's intermediate text is not a search term, and the pauses somebody makes while
	// choosing a candidate are all longer than the debounce below — so without this the debounce
	// would faithfully search for each half-formed string on the way. This box keeps its own timer
	// rather than moving to `createSearchCommitter`: it searches from one character (a tag lookup is
	// a narrow list, not the whole corpus) and `switchKind` re-runs the same query immediately, so
	// the committer's own policy would have to be argued out of both.
	const composing = compositionTracker();

	function scheduleSearch() {
		if (composing.active) return;
		clearTimeout(debounceTimer);
		error = '';
		if (!query.trim()) {
			exerciseResults = [];
			materialResults = [];
			return;
		}
		// Captured now rather than read inside `runSearch`, so the request and the results it is
		// allowed to write are talking about the same query.
		const term = query;
		debounceTimer = setTimeout(() => runSearch(term, kind), 350);
	}

	/** Which lookup the results on screen belong to. A slower earlier request must not overwrite a
	 *  newer one's results — nothing about the network orders two in-flight lookups — and the kind is
	 *  part of the identity, not just the term: switching tabs re-runs the SAME term against a
	 *  different endpoint, so comparing terms alone would let the abandoned one through. */
	let inFlight = '';

	async function runSearch(term: string, forKind: TaggableKind) {
		const token = `${forKind}:${term}`;
		inFlight = token;
		searching = true;
		try {
			if (forKind === 'exercise') {
				const results = await searchExercises(term, getLocale());
				if (inFlight !== token) return;
				exerciseResults = results;
			} else {
				const results = await searchMaterials(term);
				if (inFlight !== token) return;
				materialResults = results;
			}
		} finally {
			if (inFlight === token) searching = false;
		}
	}

	function switchKind(next: TaggableKind) {
		kind = next;
		exerciseResults = [];
		materialResults = [];
		if (query.trim()) scheduleSearch();
	}

	// Re-applying an already-present tag is a harmless no-notification no-op server-side, but the
	// modal used to say nothing about it — a result already carrying this tag showed the same
	// clickable "Add" as any other, and clicking it just silently "succeeded" a second time with no
	// visible difference from a genuinely new application. Both `ResolvedExercise`/`Material` search
	// results already carry their own real `tags: string[]` (used elsewhere by TagChip itself), so
	// this needed no backend change — just checking it before the button ever becomes clickable.
	function alreadyHasTag(resultTags: string[]): boolean {
		return resultTags.includes(tag);
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
		oncompositionstart={composing.start}
		oncompositionend={(e) => {
			composing.end();
			// Taken off the event rather than trusting `query` to have caught up: browsers disagree
			// on whether `input` fires before or after `compositionend`, and this works either way.
			query = e.currentTarget.value;
			scheduleSearch();
		}}
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
					{#if alreadyHasTag(exercise.tags) && !addedIds.has(exercise.id)}
						<span class="result-row__already">{m.tag_alreadyTagged()}</span>
					{:else}
						<button
							type="button"
							disabled={addedIds.has(exercise.id)}
							onclick={() => handleAdd(exercise.id)}
						>
							{addedIds.has(exercise.id) ? m.tag_added() : m.tag_addAction()}
						</button>
					{/if}
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
					{#if alreadyHasTag(material.tags) && !addedIds.has(material.id)}
						<span class="result-row__already">{m.tag_alreadyTagged()}</span>
					{:else}
						<button
							type="button"
							disabled={addedIds.has(material.id)}
							onclick={() => handleAdd(material.id)}
						>
							{addedIds.has(material.id) ? m.tag_added() : m.tag_addAction()}
						</button>
					{/if}
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
	.result-row__already {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		flex-shrink: 0;
	}
</style>
