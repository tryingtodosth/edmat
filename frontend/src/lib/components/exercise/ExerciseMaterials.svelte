<script lang="ts">
	/** "From material …" — the exercise page's end of the same row `MaterialExercises.svelte` draws
	 * from the material's end (backend `ExerciseMaterialLink`).
	 *
	 * Read-only apart from the picker: a link is only ever CREATED through the material's endpoint,
	 * so there is one create path to keep correct, and this component calls it with the pair the
	 * other way round. Published materials only — an unpublished one has no page to link to.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import type { ExerciseLinkRole, ExerciseMaterialLink, Material } from '$lib/types';
	import {
		AlreadyLinkedError,
		getMaterialsForExercise,
		linkExerciseToMaterial
	} from '$lib/services/exerciseLinks';
	import { searchMaterials } from '$lib/services/materials';
	import { authStore } from '$lib/state/auth.svelte';
	import { EXERCISE_LINK_ROLES, EXERCISE_LINK_ROLE_LABELS } from '$lib/utils/labels';

	let { exerciseId }: { exerciseId: string } = $props();

	let links = $state<ExerciseMaterialLink[]>([]);
	let error = $state<string | null>(null);

	let picking = $state(false);
	let query = $state('');
	let results = $state<Material[]>([]);
	let searching = $state(false);
	let picked = $state<Material | null>(null);
	let role = $state<ExerciseLinkRole>('source');
	let locator = $state('');
	let linking = $state(false);

	// Guarded on the id, not just mounted once: `/exercises/[id]` is a dynamic route, and an
	// `$effect` keyed on `exerciseId` re-fires with no navigation at all (frontend/CLAUDE.md trap
	// 2). `onMount` plus an explicit re-load on a changed id is the shape that does not double-fetch.
	let loadedFor = $state<string | null>(null);

	async function load() {
		if (loadedFor === exerciseId) return;
		loadedFor = exerciseId;
		try {
			links = await getMaterialsForExercise(exerciseId, getLocale());
		} catch {
			links = [];
		}
	}

	onMount(load);
	$effect(() => {
		if (exerciseId !== loadedFor) load();
	});

	async function runSearch() {
		const q = query.trim();
		if (!q) {
			results = [];
			return;
		}
		searching = true;
		try {
			results = await searchMaterials(q);
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
			await linkExerciseToMaterial(picked.id, {
				exerciseId,
				role,
				locator: locator.trim() || undefined
			});
			// The material's endpoint answers with the EXERCISE embedded, which is the wrong half for
			// this list — so this one case genuinely re-reads rather than splicing a mismatched row in.
			loadedFor = null;
			await load();
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
</script>

{#if links.length > 0 || authStore.isAuthenticated}
	<section class="exercise-materials content-section">
		<div class="exercise-materials__head">
			<h2>{m.exLink_exerciseHeading()}</h2>
			<!-- "Original text": From material -->
			{#if authStore.isAuthenticated}
				<button type="button" class="action" onclick={() => ((picking = !picking), (error = null))}>
					{m.exLink_linkMaterialTrigger()}
					<!-- "Original text": Link a material -->
				</button>
			{/if}
		</div>

		{#if links.length === 0}
			<p class="status">{m.exLink_exerciseEmpty()}</p>
			<!-- "Original text": This exercise is not linked to any material yet. -->
		{:else}
			<ul class="material-list">
				{#each links as link (link.id)}
					<li>
						{#if link.material}
							<a href={resolve('/materials/[id]', { id: link.material.id })}
								>{link.material.title}</a
							>
						{/if}
						<span class="chip">{EXERCISE_LINK_ROLE_LABELS[link.role]()}</span>
						{#if link.locator}<span class="chip chip--locator">{link.locator}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if picking}
			<div class="picker no-print">
				<label class="picker__field">
					<span>{m.exLink_materialSearchPlaceholder()}</span>
					<!-- "Original text": Search materials by title… -->
					<input
						type="text"
						bind:value={query}
						placeholder={m.exLink_materialSearchPlaceholder()}
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
									{result.title}
								</button>
							</li>
						{/each}
					</ul>
				{:else if query.trim() && !searching}
					<p class="status">{m.exLink_materialNoResults()}</p>
					<!-- "Original text": No materials match that. -->
				{/if}

				{#if picked}
					<p class="picker__picked">{m.exLink_pickedMaterial({ title: picked.title })}</p>
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
	</section>
{/if}

<style lang="scss">
	.exercise-materials {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.exercise-materials__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.action {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}
	.material-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		li {
			display: flex;
			gap: 0.5rem;
			align-items: baseline;
			flex-wrap: wrap;
		}
		a {
			color: var(--accent);
		}
	}
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--danger, #c0392b);
		font-size: var(--font-size-sm);
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
	.picker__picked {
		font-size: var(--font-size-sm);
	}
</style>
