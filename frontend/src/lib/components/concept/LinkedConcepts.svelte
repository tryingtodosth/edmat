<script lang="ts">
	/**
	 * The concept chips on an exercise or a material page: "this is about…".
	 *
	 * Renders NOTHING when there is nothing to show and nothing this reader could do about it — no
	 * heading, no empty state, no border. Most content is not linked to a concept, and a row that
	 * says "no concepts" on every page is worse than no row (the `AppearsInSessions` precedent).
	 * Nothing here changes the shape of an exercise or a material: they simply gain a row of chips.
	 *
	 * With the kill switch off this renders nothing at all for an ordinary reader, and the endpoint
	 * itself answers `[]` — the chips go away and the page around them keeps working (house rule
	 * 3). A moderator still sees them, mirroring the backend's own `is_staff` bypass.
	 *
	 * Linking from THIS end still posts to the concept's own endpoint
	 * (`POST /api/concepts/{slug}/links/`), because a link belongs to the concept — there is one
	 * rule about who may add one, in one place, whichever page the button was pressed on. A minor
	 * is refused by the server (400 `minor`) and told why, rather than being guessed at here.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import { addLink, getConceptsForTarget, searchConcepts } from '$lib/services/concepts';
	import { compositionTracker } from '$lib/utils/textInput';
	import type { ConceptBacklink, ConceptListRow } from '$lib/types/concept';
	import { CONCEPTS_FLAG, messageForError } from './labels';

	let {
		exerciseId,
		materialId
	}: {
		exerciseId?: string;
		materialId?: string;
	} = $props();

	const targetType = $derived<'exercise' | 'material'>(exerciseId ? 'exercise' : 'material');
	const targetId = $derived(exerciseId ?? materialId ?? '');

	let available = $state(false);
	let concepts = $state<ConceptBacklink[]>([]);
	let picking = $state(false);
	let query = $state('');
	let results = $state<ConceptListRow[]>([]);
	let error = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	const composing = compositionTracker();

	// In `onMount`, never at component top level: a service call at module/component top level runs
	// during SSR and prerendering with no token and no origin (frontend/CLAUDE.md trap 5).
	onMount(async () => {
		if (!featureFlagsStore.isEnabled(CONCEPTS_FLAG) && !authStore.isModerator) return;
		if (!targetId) return;
		available = true;
		concepts = await getConceptsForTarget(targetType, targetId);
	});

	let inFlight = '';
	function scheduleSearch() {
		if (composing.active) return;
		clearTimeout(debounceTimer);
		error = '';
		if (!query.trim()) {
			results = [];
			return;
		}
		const term = query;
		debounceTimer = setTimeout(async () => {
			inFlight = term;
			const found = await searchConcepts(term);
			// A slower earlier lookup must not overwrite a newer one's results.
			if (inFlight === term) results = found;
		}, 350);
	}

	async function link(concept: ConceptListRow) {
		error = '';
		try {
			await addLink(concept.slug, targetType, targetId);
			concepts = await getConceptsForTarget(targetType, targetId);
			picking = false;
			query = '';
			results = [];
		} catch (e) {
			error = messageForError(e);
		}
	}
</script>

{#if available && (concepts.length > 0 || authStore.isAuthenticated)}
	<section class="linked-concepts">
		<h2>{m.concept_linkedConcepts_heading()}</h2>
		<!-- "This is about" -->
		{#if concepts.length > 0}
			<ul>
				{#each concepts as concept (concept.linkId)}
					<li>
						<a href={resolve('/concepts/[slug]', { slug: concept.slug })} title={concept.summary}>
							{concept.title || concept.slug}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
		{#if authStore.isAuthenticated}
			<button type="button" class="add" onclick={() => (picking = true)}>
				{m.concept_linkedConcepts_add()}
				<!-- "Link a concept" -->
			</button>
		{/if}
	</section>
{/if}

{#if picking}
	<ModalShell title={m.concept_linkedConcepts_add()} onClose={() => (picking = false)}>
		<input
			type="text"
			bind:value={query}
			oninput={scheduleSearch}
			oncompositionstart={composing.start}
			oncompositionend={(e) => {
				composing.end();
				query = e.currentTarget.value;
				scheduleSearch();
			}}
			placeholder={m.concept_link_searchPlaceholder()}
			aria-label={m.concept_link_searchPlaceholder()}
		/>
		{#if error}<p class="error">{error}</p>{/if}
		<ul class="results">
			{#each results as concept (concept.id)}
				<li>
					<MathTitle text={concept.title || concept.slug} />
					<button type="button" onclick={() => link(concept)}>{m.common_add()}</button>
					<!-- "Add" -->
				</li>
			{/each}
		</ul>
	</ModalShell>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.linked-concepts {
		margin-top: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		align-items: flex-start;

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.linked-concepts li {
		display: inline-flex;
		padding: 2px var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		font-size: var(--font-size-xs);
	}
	a {
		color: var(--accent);
	}
	.add {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		cursor: pointer;

		&:hover {
			color: var(--accent);
		}
	}
	input[type='text'] {
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
		margin: var(--space-2) 0 0;
		flex-direction: column;

		li {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-2);
			font-size: var(--font-size-sm);
			padding: var(--space-1) 0;
			border: 0;
			border-bottom: 1px solid var(--border-color);
			border-radius: 0;
		}
		button {
			@include mix.button-secondary;
			min-height: 36px;
			padding: 0 var(--space-3);
			font-size: var(--font-size-xs);
		}
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin: 0;
		white-space: normal;
	}
</style>
