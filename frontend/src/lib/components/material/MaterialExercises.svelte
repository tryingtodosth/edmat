<script lang="ts">
	/** "Exercises from this material" — the material page's half of the exercise↔material link.
	 *
	 * Two ways in, because they are genuinely different acts: **Add an exercise** writes a NEW one
	 * through the ordinary moderated submission (pre-linked, via `/submit?material=…`), so what
	 * comes out the other end is a normal exercise that browses in its branch like any other and
	 * also lists here; **Link an existing exercise** attaches one that is already in the database.
	 *
	 * Nothing here is moderation-gated — a link is additive, reversible metadata, the same call
	 * coverage claims and tags already make. The remove control is hidden for somebody who almost
	 * certainly may not use it, but the API's 404 is the real answer: this is a hint, not a gate.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import type { ExerciseLinkRole, ExerciseMaterialLink, ResolvedExercise } from '$lib/types';
	import {
		AlreadyLinkedError,
		getExercisesForMaterial,
		linkExerciseToMaterial,
		unlinkExerciseFromMaterial
	} from '$lib/services/exerciseLinks';
	import { getExercisesForBranch, searchExercises } from '$lib/services/exercises';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { EXERCISE_LINK_ROLES, EXERCISE_LINK_ROLE_LABELS } from '$lib/utils/labels';
	import ExerciseCard from '$lib/components/exercise/ExerciseCard.svelte';

	let {
		materialId,
		branchId,
		submittedByUserId
	}: {
		materialId: string;
		/** The material's own branch — what the picker searches FIRST, before falling back to a
		 * cross-branch search. */
		branchId: string;
		/** Who submitted the material, if anybody. Part of the hint for whether to draw the remove
		 * control; the API's 404 is the real answer. */
		submittedByUserId?: string;
	} = $props();

	let links = $state<ExerciseMaterialLink[]>([]);
	let error = $state<string | null>(null);

	// The picker. Closed by default — it is a second action on a page that already has several, and
	// an always-open search box reads as the main thing to do here, which it is not.
	let picking = $state(false);
	let query = $state('');
	let results = $state<ResolvedExercise[]>([]);
	let searching = $state(false);
	let picked = $state<ResolvedExercise | null>(null);
	let role = $state<ExerciseLinkRole>('source');
	let locator = $state('');
	let linking = $state(false);

	// Same gate the header's Add… menu uses — `|| isModerator` mirrors `FeatureGate` and the
	// backend's own `feature_gate`, so a moderator can still reach a killed surface. House rule 3:
	// a kill switch takes the LINK away, not only the page behind it.
	let canSubmitExercise = $derived(
		featureFlagsStore.isEnabled('exercise_submissions') || authStore.isModerator
	);

	// `$effect` rather than a bare `onMount` read: `authStore` resolves asynchronously, so a value
	// read once at mount bakes in the pre-restore answer (frontend/CLAUDE.md trap 3).
	let myUserId = $derived(authStore.user?.id);

	function canRemove(link: ExerciseMaterialLink): boolean {
		if (!authStore.isAuthenticated) return false;
		return (
			authStore.canModerate ||
			link.addedByUserId === myUserId ||
			(submittedByUserId !== undefined && submittedByUserId === myUserId)
		);
	}

	async function load() {
		try {
			links = await getExercisesForMaterial(materialId, getLocale());
		} catch {
			links = [];
		}
	}

	onMount(load);

	/** The material's own branch first, because that is where an exercise from this material almost
	 * always lives; a cross-branch search is the fallback rather than the default, so the common
	 * case is not buried under near-identical titles from other subjects. */
	async function runSearch() {
		const q = query.trim();
		if (!q) {
			results = [];
			return;
		}
		searching = true;
		try {
			const inBranch = await getExercisesForBranch(branchId, getLocale(), { query: q });
			results = inBranch.length > 0 ? inBranch : await searchExercises(q, getLocale());
		} catch {
			results = [];
		} finally {
			searching = false;
		}
	}

	async function link() {
		if (!picked) return;
		linking = true;
		error = null;
		try {
			const created = await linkExerciseToMaterial(materialId, {
				exerciseId: picked.id,
				role,
				locator: locator.trim() || undefined
			});
			// Written straight into the list rather than re-fetching: the row the API just returned
			// is the row, and a reload would drop the reader back to the top of a long page.
			links = [...links, created];
			picking = false;
			picked = null;
			query = '';
			results = [];
			locator = '';
			role = 'source';
		} catch (e) {
			error = e instanceof AlreadyLinkedError ? m.exLink_alreadyLinked() : m.exLink_linkFailed(); // "That exercise is already linked to this material." / "Couldn't link that exercise. Please try again."
		} finally {
			linking = false;
		}
	}

	async function remove(link: ExerciseMaterialLink) {
		error = null;
		try {
			await unlinkExerciseFromMaterial(link.id);
			links = links.filter((l) => l.id !== link.id);
		} catch {
			error = m.exLink_removeFailed(); // "Couldn't remove that link."
		}
	}
</script>

<section class="material-exercises">
	<div class="material-exercises__head">
		<h2>{m.exLink_materialHeading()}</h2>
		<!-- "Original text": Exercises from this material -->
		{#if authStore.isAuthenticated}
			<div class="material-exercises__actions">
				{#if canSubmitExercise}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- an internal route built from resolve('/submit') plus a query string the eslint rule can't statically see through, same as the profile page's "send a message" link -->
					<a
						class="action"
						href={`${resolve('/submit')}?material=${encodeURIComponent(materialId)}`}
					>
						+ {m.exLink_addTrigger()}
						<!-- "Original text": Add an exercise -->
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
				<button type="button" class="action" onclick={() => ((picking = !picking), (error = null))}>
					{m.exLink_linkExistingTrigger()}
					<!-- "Original text": Link an existing exercise -->
				</button>
			</div>
		{/if}
	</div>
	<p class="hint">{m.exLink_materialHint()}</p>
	<!-- "Original text": Exercises transcribed from this material, and exercises that practise what it teaches. -->

	{#if picking}
		<div class="picker">
			<label class="picker__field">
				<span>{m.exLink_searchPlaceholder()}</span>
				<!-- "Original text": Search exercises by title… -->
				<input
					type="text"
					bind:value={query}
					placeholder={m.exLink_searchPlaceholder()}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							runSearch();
						}
					}}
				/>
			</label>
			<button type="button" class="picker__search" onclick={runSearch} disabled={searching}>
				{m.common_search()}
				<!-- "Original text": Search -->
			</button>
			<p class="hint">{m.exLink_searchHintBranch()}</p>
			<!-- "Original text": Searching this material's branch first. -->

			{#if results.length > 0}
				<ul class="picker__results">
					{#each results as result (result.id)}
						<li>
							<button
								type="button"
								class="picker__result"
								class:is-picked={picked?.id === result.id}
								onclick={() => (picked = result)}
							>
								<span class="picker__number">#{result.number}</span>
								{result.title}
							</button>
						</li>
					{/each}
				</ul>
			{:else if query.trim() && !searching}
				<p class="status">{m.exLink_searchNoResults()}</p>
				<!-- "Original text": No exercises match that. -->
			{/if}

			{#if picked}
				<p class="picker__picked">{m.exLink_pickedExercise({ title: picked.title })}</p>
				<!-- "Original text": Linking: {title} -->
				<div class="picker__row">
					<label class="picker__field">
						<span>{m.exLink_roleLabel()}</span>
						<!-- "Original text": Kind of link -->
						<select bind:value={role}>
							{#each EXERCISE_LINK_ROLES as r (r)}
								<option value={r}>{EXERCISE_LINK_ROLE_LABELS[r]()}</option>
							{/each}
						</select>
					</label>
					<label class="picker__field">
						<span>{m.exLink_locatorLabel()} <em>({m.common_optional()})</em></span>
						<!-- "Original text": Where in the material / optional -->
						<input
							type="text"
							bind:value={locator}
							maxlength="120"
							placeholder={m.exLink_locatorPlaceholder()}
						/>
					</label>
				</div>
				<div class="picker__row">
					<button type="button" class="picker__link" onclick={link} disabled={linking}>
						{m.exLink_linkButton()}
						<!-- "Original text": Link -->
					</button>
					<button type="button" class="picker__cancel" onclick={() => (picking = false)}>
						{m.common_cancel()}
						<!-- "Original text": Cancel -->
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if links.length === 0}
		<p class="status">{m.exLink_materialEmpty()}</p>
		<!-- "Original text": No exercises are linked to this material yet. -->
	{:else}
		<ul class="link-grid">
			{#each links as link (link.id)}
				<li class="link-row">
					{#if link.exercise}
						<ExerciseCard exercise={link.exercise} />
					{/if}
					<div class="link-row__meta">
						<span class="chip">{EXERCISE_LINK_ROLE_LABELS[link.role]()}</span>
						{#if link.locator}<span class="chip chip--locator">{link.locator}</span>{/if}
						{#if link.addedByDisplayName}
							<span class="muted">{m.exLink_addedBy({ name: link.addedByDisplayName })}</span>
							<!-- "Original text": added by {name} -->
						{/if}
						{#if canRemove(link)}
							<button
								type="button"
								class="link-row__remove"
								title={m.exLink_remove()}
								aria-label={m.exLink_remove()}
								onclick={() => remove(link)}
							>
								&times;
							</button>
							<!-- "Original text": Remove this link -->
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style lang="scss">
	.material-exercises {
		margin-top: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.material-exercises__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.material-exercises__actions {
		display: flex;
		/* A link and a button side by side: without baseline alignment and one set of font metrics
		   the button's own line height put its label visibly lower than the link's. */
		align-items: baseline;
		gap: var(--space-3, 1rem);
		flex-wrap: wrap;
	}
	.action {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
		font-family: inherit;
		font-size: var(--font-size-sm);
		line-height: inherit;
	}
	.hint,
	.status,
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--danger, #c0392b);
		font-size: var(--font-size-sm);
	}
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 6px);
	}
	.picker__field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1 1 12rem;
		font-size: var(--font-size-sm);
	}
	.picker__row {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		align-items: flex-end;
	}
	.picker__results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		max-height: 14rem;
		overflow-y: auto;
	}
	.picker__result {
		width: 100%;
		text-align: left;
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-sm, 4px);
		padding: 0.3rem 0.4rem;
		cursor: pointer;
		color: var(--text-primary);
		&:hover,
		&.is-picked {
			border-color: var(--accent);
		}
	}
	.picker__number {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		margin-right: 0.4rem;
	}
	.picker__picked {
		font-size: var(--font-size-sm);
	}
	.link-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
		grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
	}
	.link-row {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.link-row__meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.link-row__remove {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-secondary);
		font-size: 1rem;
		line-height: 1;
		padding: 0 0.2rem;
		&:hover {
			color: var(--danger, #c0392b);
		}
	}
	.chip {
		font-size: var(--font-size-xs);
		padding: 0.1rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-secondary);
	}
	.chip--locator {
		font-variant-numeric: tabular-nums;
	}
</style>
