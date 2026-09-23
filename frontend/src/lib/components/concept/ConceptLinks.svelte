<script lang="ts">
	/**
	 * Everything a concept is connected to, in both directions.
	 *
	 * Four outgoing groups — prerequisites, related concepts, exercises, materials — then "Linked
	 * from", which is the same rows read from the other end. Exercises and materials are drawn with
	 * the very cards a branch listing uses, so a reader recognises them; the rows themselves only
	 * carry a title, so the cards are fetched here (one bulk call for the exercises, one call per
	 * material, both in an `$effect` keyed on the ids rather than at component top level — trap 5).
	 *
	 * A `body`-origin row is what the article's own text says (`[[slug]]`), re-derived on every
	 * publish. It is marked as such and has no remove button: the way to remove it is to remove the
	 * mention, and a button that silently came back would be worse than no button.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import { getExercisesByIds } from '$lib/services/exercises';
	import { getMaterialById } from '$lib/services/materials';
	import { removeLink } from '$lib/services/concepts';
	import type { Material, ResolvedExercise } from '$lib/types';
	import type { ConceptBacklink, ConceptLink, ConceptLinkBlockReason } from '$lib/types/concept';
	import { LINK_BLOCK_LABELS, messageForError } from './labels';
	import LinkPicker from './LinkPicker.svelte';

	let {
		slug,
		links = $bindable([]),
		backlinks = [],
		blockReason = null
	}: {
		slug: string;
		links: ConceptLink[];
		backlinks?: ConceptBacklink[];
		/** Why this person may not add one. `null` means they may. */
		blockReason?: ConceptLinkBlockReason | null;
	} = $props();

	let exercises = $state<ResolvedExercise[]>([]);
	let materials = $state<Material[]>([]);
	let picking = $state(false);
	let error = $state('');

	const prerequisites = $derived(
		links.filter((l) => l.targetType === 'concept' && l.relation === 'prerequisite')
	);
	const relatedConcepts = $derived(
		links.filter((l) => l.targetType === 'concept' && l.relation === 'related')
	);
	const exerciseLinks = $derived(links.filter((l) => l.targetType === 'exercise'));
	const materialLinks = $derived(links.filter((l) => l.targetType === 'material'));

	// Keyed on the ids, not on the array: the list is replaced whole every time a link is added,
	// and re-fetching every card for that would be one request per click.
	let loadedFor = $state('');
	$effect(() => {
		const exerciseIds = exerciseLinks.map((l) => l.targetId);
		const materialIds = materialLinks.map((l) => l.targetId);
		const key = `${exerciseIds.join(',')}|${materialIds.join(',')}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load(exerciseIds, materialIds);
	});

	async function load(exerciseIds: string[], materialIds: string[]) {
		const [foundExercises, foundMaterials] = await Promise.all([
			exerciseIds.length ? getExercisesByIds(exerciseIds, getLocale()).catch(() => []) : [],
			Promise.all(materialIds.map((id) => getMaterialById(id).catch(() => undefined)))
		]);
		exercises = foundExercises;
		materials = foundMaterials.filter((material): material is Material => material !== undefined);
	}

	async function remove(link: ConceptLink) {
		error = '';
		try {
			await removeLink(link.id);
			links = links.filter((row) => row.id !== link.id);
		} catch (e) {
			error = messageForError(e);
		}
	}

	const hasAnything = $derived(links.length > 0 || backlinks.length > 0);
</script>

{#snippet conceptRows(rows: ConceptLink[])}
	<ul class="chips">
		{#each rows as link (link.id)}
			<li>
				<a href={resolve('/concepts/[slug]', { slug: link.targetSlug })}>
					{link.targetTitle || link.targetSlug}
				</a>
				{#if link.origin === 'body'}
					<span class="from-text" title={m.concept_link_fromTextHint()}>
						{m.concept_link_fromText()}
						<!-- "from the text" -->
					</span>
				{:else if link.canRemove}
					<button type="button" aria-label={m.common_remove()} onclick={() => remove(link)}
						>&times;</button
					>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<section class="links">
	<div class="links__head">
		<h2>{m.concept_links_heading()}</h2>
		<!-- "Connections" -->
		{#if blockReason}
			<span class="hint">{LINK_BLOCK_LABELS[blockReason]()}</span>
		{:else}
			<button type="button" class="ghost" onclick={() => (picking = true)}>
				{m.concept_links_add()}
				<!-- "Link something" -->
			</button>
		{/if}
	</div>

	{#if error}<p class="error">{error}</p>{/if}

	{#if !hasAnything}
		<p class="hint">{m.concept_links_empty()}</p>
		<!-- "Nothing is linked to this concept yet." -->
	{/if}

	{#if prerequisites.length > 0}
		<h3>{m.concept_links_prerequisites()}</h3>
		<!-- "Know this first" -->
		{@render conceptRows(prerequisites)}
	{/if}

	{#if relatedConcepts.length > 0}
		<h3>{m.concept_links_related()}</h3>
		<!-- "Related concepts" -->
		{@render conceptRows(relatedConcepts)}
	{/if}

	{#if exerciseLinks.length > 0}
		<h3>{m.concept_links_exercises()}</h3>
		<!-- "Exercises" -->
		<div class="cards">
			{#each exercises as exercise (exercise.id)}
				<ExerciseCard {exercise} />
			{/each}
		</div>
		{@render removals(exerciseLinks)}
	{/if}

	{#if materialLinks.length > 0}
		<h3>{m.concept_links_materials()}</h3>
		<!-- "Materials" -->
		<div class="cards">
			{#each materials as material (material.id)}
				<MaterialCard {material} />
			{/each}
		</div>
		{@render removals(materialLinks)}
	{/if}

	{#if backlinks.length > 0}
		<h3>{m.concept_links_backlinks()}</h3>
		<!-- "Linked from" -->
		<ul class="chips">
			{#each backlinks as backlink (backlink.linkId)}
				<li>
					<a href={resolve('/concepts/[slug]', { slug: backlink.slug })}>
						{backlink.title || backlink.slug}
					</a>
					{#if backlink.origin === 'body'}
						<span class="from-text">{m.concept_link_fromText()}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!-- The remove control for a card-shaped row: the card itself is a shared component and is not
     going to grow a concepts-specific button, so the unlink action sits under the group. -->
{#snippet removals(rows: ConceptLink[])}
	{#if rows.some((row) => row.canRemove || row.origin === 'body')}
		<ul class="chips chips--quiet">
			{#each rows as link (link.id)}
				<li>
					<span>{link.targetTitle}</span>
					{#if link.origin === 'body'}
						<span class="from-text">{m.concept_link_fromText()}</span>
					{:else if link.canRemove}
						<button type="button" onclick={() => remove(link)}>
							{m.concept_links_unlink()}
							<!-- "Unlink" -->
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#if picking}
	<LinkPicker
		{slug}
		onClose={() => (picking = false)}
		onadded={(link) => (links = [...links, link])}
	/>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.links {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
		h3 {
			margin: var(--space-2) 0 0;
			font-size: var(--font-size-sm);
		}
	}
	.links__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;

		li {
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
			padding: 2px var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: 999px;
			font-size: var(--font-size-xs);
		}
		a {
			color: var(--accent);
		}
		button {
			border: 0;
			background: none;
			color: var(--text-secondary);
			cursor: pointer;
			font: inherit;
		}
	}
	.chips--quiet li {
		border-style: dashed;
		color: var(--text-secondary);
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-2);
	}
	.from-text {
		color: var(--text-secondary);
		font-style: italic;
	}
	.ghost {
		@include mix.button-secondary;
		min-height: 36px;
		padding: 0 var(--space-3);
		font-size: var(--font-size-xs);
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin: 0;
		align-self: flex-start;
		white-space: normal;
	}
</style>
