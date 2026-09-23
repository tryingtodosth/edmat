<script lang="ts">
	// The tag-hover menu's "add to different content" action — search for another Exercise,
	// Material or Concept and attach this same tag to it. Debounced text search, reusing the exact
	// services (searchExercises/searchMaterials/searchConcepts) built for this modal specifically,
	// since none existed as a branch-agnostic lookup before this feature needed one.
	import type { Material, ResolvedExercise, TaggableKind } from '$lib/types';
	import type { ConceptListRow } from '$lib/types/concept';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { searchExercises } from '$lib/services/exercises';
	import { searchMaterials } from '$lib/services/materials';
	import { searchConcepts } from '$lib/services/concepts';
	import { applyTagToContent } from '$lib/services/tags';
	import { compositionTracker } from '$lib/utils/textInput';
	import ModalShell from './ModalShell.svelte';

	let { tag, onClose }: { tag: string; onClose: () => void } = $props();

	// The third tab appears only while the concepts kill switch is on (house rule 3: a killed
	// feature loses its links, not just its pages), with the same moderator bypass `FeatureGate`
	// and the header use. The flag key is spelled here rather than imported from
	// `components/concept/labels.ts` on purpose — this modal opens from a tag chip on nearly every
	// page, and importing that module would pull the whole concepts service into their chunks for
	// one string. `FeatureFlagKey` is what checks the spelling.
	let canConcepts = $derived(featureFlagsStore.isEnabled('concepts') || authStore.isModerator);

	let kind = $state<TaggableKind>('exercise');
	let query = $state('');
	let exerciseResults = $state<ResolvedExercise[]>([]);
	let materialResults = $state<Material[]>([]);
	let conceptResults = $state<ConceptListRow[]>([]);
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
			conceptResults = [];
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
			} else if (forKind === 'material') {
				const results = await searchMaterials(term);
				if (inFlight !== token) return;
				materialResults = results;
			} else {
				const results = await searchConcepts(term);
				if (inFlight !== token) return;
				conceptResults = results;
			}
		} finally {
			if (inFlight === token) searching = false;
		}
	}

	function switchKind(next: TaggableKind) {
		kind = next;
		exerciseResults = [];
		materialResults = [];
		conceptResults = [];
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

	// Keyed by KIND and id, not by id alone. Ids are per-model numeric pks, so exercise 5, material
	// 5 and concept 5 all exist — a bare id set made tagging one of them show "Added" against the
	// other two the moment you switched tabs. Third kind, same set: the collision stopped being
	// hypothetical.
	function addedKey(kindOfRow: TaggableKind, objectId: string): string {
		return `${kindOfRow}:${objectId}`;
	}

	async function handleAdd(objectId: string) {
		error = '';
		try {
			await applyTagToContent(tag, kind, objectId);
			addedIds = new Set([...addedIds, addedKey(kind, objectId)]);
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
		{#if canConcepts}
			<button
				type="button"
				class:active={kind === 'concept'}
				role="tab"
				aria-selected={kind === 'concept'}
				onclick={() => switchKind('concept')}
			>
				{m.tag_kindConcept()}
				<!-- "Concept" -->
			</button>
		{/if}
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
					{#if alreadyHasTag(exercise.tags) && !addedIds.has(addedKey('exercise', exercise.id))}
						<span class="result-row__already">{m.tag_alreadyTagged()}</span>
					{:else}
						<button
							type="button"
							disabled={addedIds.has(addedKey('exercise', exercise.id))}
							onclick={() => handleAdd(exercise.id)}
						>
							{addedIds.has(addedKey('exercise', exercise.id)) ? m.tag_added() : m.tag_addAction()}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if kind === 'material'}
		{#if query.trim() && materialResults.length === 0}
			<p class="hint">{m.tag_noResults()}</p>
		{/if}
		<ul class="results">
			{#each materialResults as material (material.id)}
				<li class="result-row">
					<span class="result-row__title">{material.title}</span>
					{#if alreadyHasTag(material.tags) && !addedIds.has(addedKey('material', material.id))}
						<span class="result-row__already">{m.tag_alreadyTagged()}</span>
					{:else}
						<button
							type="button"
							disabled={addedIds.has(addedKey('material', material.id))}
							onclick={() => handleAdd(material.id)}
						>
							{addedIds.has(addedKey('material', material.id)) ? m.tag_added() : m.tag_addAction()}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		{#if query.trim() && conceptResults.length === 0}
			<p class="hint">{m.tag_noResults()}</p>
		{/if}
		<ul class="results">
			{#each conceptResults as concept (concept.id)}
				<li class="result-row">
					<span class="result-row__title">{concept.title}</span>
					{#if alreadyHasTag(concept.tags) && !addedIds.has(addedKey('concept', concept.id))}
						<span class="result-row__already">{m.tag_alreadyTagged()}</span>
					{:else}
						<button
							type="button"
							disabled={addedIds.has(addedKey('concept', concept.id))}
							onclick={() => handleAdd(concept.id)}
						>
							{addedIds.has(addedKey('concept', concept.id)) ? m.tag_added() : m.tag_addAction()}
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
