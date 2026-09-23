<script lang="ts">
	/**
	 * Linking a concept to an exercise, a material or another concept.
	 *
	 * The debounced-search shape is `AddTagToContentModal`'s, down to the in-flight token that
	 * keeps a slow earlier lookup from overwriting a newer one's results — nothing about the
	 * network orders two requests, and the kind is part of that identity because switching tabs
	 * re-runs the same term against a different endpoint.
	 *
	 * The relation select appears only for a concept target: "know this first" is a statement about
	 * two concepts, and the server answers 400 `relation` for anything else (which this would
	 * otherwise let somebody walk into).
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import { addLink, searchConcepts } from '$lib/services/concepts';
	import { searchExercises } from '$lib/services/exercises';
	import { searchMaterials } from '$lib/services/materials';
	import { compositionTracker } from '$lib/utils/textInput';
	import type { Material, ResolvedExercise } from '$lib/types';
	import type {
		ConceptLink,
		ConceptLinkTargetType,
		ConceptListRow,
		ConceptRelation
	} from '$lib/types/concept';
	import { messageForError, RELATION_LABELS } from './labels';

	let {
		slug,
		onClose,
		onadded = undefined
	}: {
		slug: string;
		onClose: () => void;
		onadded?: (link: ConceptLink) => void;
	} = $props();

	let kind = $state<ConceptLinkTargetType>('exercise');
	let relation = $state<ConceptRelation>('related');
	let query = $state('');
	let exercises = $state<ResolvedExercise[]>([]);
	let materials = $state<Material[]>([]);
	let concepts = $state<ConceptListRow[]>([]);
	let searching = $state(false);
	let error = $state('');
	let addedIds = $state<string[]>([]);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// An input method's intermediate text is not a search term, and the pauses somebody makes while
	// choosing a candidate are all longer than the debounce below.
	const composing = compositionTracker();

	function scheduleSearch() {
		if (composing.active) return;
		clearTimeout(debounceTimer);
		error = '';
		if (!query.trim()) {
			exercises = [];
			materials = [];
			concepts = [];
			return;
		}
		// Captured now rather than read inside `runSearch`, so the request and the results it is
		// allowed to write are talking about the same query.
		const term = query;
		debounceTimer = setTimeout(() => runSearch(term, kind), 350);
	}

	/** Which lookup the results on screen belong to. */
	let inFlight = '';

	async function runSearch(term: string, forKind: ConceptLinkTargetType) {
		const token = `${forKind}:${term}`;
		inFlight = token;
		searching = true;
		try {
			if (forKind === 'exercise') {
				const results = await searchExercises(term, getLocale());
				if (inFlight !== token) return;
				exercises = results;
			} else if (forKind === 'material') {
				const results = await searchMaterials(term);
				if (inFlight !== token) return;
				materials = results;
			} else {
				const results = await searchConcepts(term);
				if (inFlight !== token) return;
				concepts = results.filter((row) => row.slug !== slug);
			}
		} catch (e) {
			if (inFlight === token) error = messageForError(e);
		} finally {
			if (inFlight === token) searching = false;
		}
	}

	function switchKind(next: ConceptLinkTargetType) {
		kind = next;
		if (next !== 'concept') relation = 'related';
		exercises = [];
		materials = [];
		concepts = [];
		if (query.trim()) scheduleSearch();
	}

	async function add(targetId: string) {
		error = '';
		try {
			const link = await addLink(slug, kind, targetId, relation);
			addedIds = [...addedIds, `${kind}:${targetId}`];
			onadded?.(link);
		} catch (e) {
			error = messageForError(e);
		}
	}

	const KINDS: ConceptLinkTargetType[] = ['exercise', 'material', 'concept'];
	const KIND_LABELS: Record<ConceptLinkTargetType, () => string> = {
		exercise: m.concept_link_kindExercise, // "Exercise"
		material: m.concept_link_kindMaterial, // "Material"
		concept: m.concept_link_kindConcept // "Concept"
	};
	const RELATIONS: ConceptRelation[] = ['related', 'prerequisite'];

	const added = (id: string) => addedIds.includes(`${kind}:${id}`);
</script>

<ModalShell title={m.concept_link_heading()} {onClose}>
	<!-- "Link something to this concept" -->
	<div class="kinds" role="tablist">
		{#each KINDS as option (option)}
			<button
				type="button"
				role="tab"
				class:active={kind === option}
				aria-selected={kind === option}
				onclick={() => switchKind(option)}>{KIND_LABELS[option]()}</button
			>
		{/each}
	</div>

	{#if kind === 'concept'}
		<label class="field">
			<span>{m.concept_link_relation()}</span>
			<!-- "How are they related?" -->
			<select bind:value={relation}>
				{#each RELATIONS as option (option)}
					<option value={option}>{RELATION_LABELS[option]()}</option>
				{/each}
			</select>
		</label>
	{/if}

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
		placeholder={m.concept_link_searchPlaceholder()}
		aria-label={m.concept_link_searchPlaceholder()}
	/>

	{#if error}<p class="error">{error}</p>{/if}
	{#if searching}<p class="hint">{m.common_loading()}</p>{/if}

	<ul class="results">
		{#if kind === 'exercise'}
			{#each exercises as exercise (exercise.id)}
				<li>
					<MathTitle text={exercise.title} />
					<button type="button" disabled={added(exercise.id)} onclick={() => add(exercise.id)}>
						{added(exercise.id) ? m.concept_link_added() : m.common_add()}
						<!-- "Linked" / "Add" -->
					</button>
				</li>
			{/each}
		{:else if kind === 'material'}
			{#each materials as material (material.id)}
				<li>
					<MathTitle text={material.title} />
					<button type="button" disabled={added(material.id)} onclick={() => add(material.id)}>
						{added(material.id) ? m.concept_link_added() : m.common_add()}
					</button>
				</li>
			{/each}
		{:else}
			{#each concepts as concept (concept.id)}
				<li>
					<MathTitle text={concept.title || concept.slug} />
					<button type="button" disabled={added(concept.id)} onclick={() => add(concept.id)}>
						{added(concept.id) ? m.concept_link_added() : m.common_add()}
					</button>
				</li>
			{/each}
		{/if}
	</ul>
</ModalShell>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.kinds {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
		margin-bottom: var(--space-2);

		button {
			@include mix.focus-ring;
			min-height: 36px;
			padding: 0 var(--space-3);
			border: 1px solid var(--border-color);
			border-radius: 999px;
			background: var(--bg-surface);
			color: var(--text-primary);
			font: inherit;
			font-size: var(--font-size-sm);
			cursor: pointer;
		}
		button.active {
			border-color: var(--accent);
			color: var(--accent);
			font-weight: 600;
		}
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		margin-bottom: var(--space-2);
	}
	input[type='text'],
	select {
		@include mix.focus-ring;
		font: inherit;
		width: 100%;
		box-sizing: border-box;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.results {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		li {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-2);
			font-size: var(--font-size-sm);
			padding: var(--space-1) 0;
			border-bottom: 1px solid var(--border-color);
		}
		button {
			@include mix.button-secondary;
			min-height: 36px;
			padding: 0 var(--space-3);
			font-size: var(--font-size-xs);
		}
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin: 0;
		white-space: normal;
	}
</style>
