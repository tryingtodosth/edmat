<script lang="ts">
	// The materials search/filter/sort overhaul's own cross-branch browse hub — before this route
	// existed, materials could only be seen scoped inside one branch's own Materials tab, and the
	// backend's real GET /api/materials/ (type/topic/tag/min_level/q/sort, plus the personalized
	// GET /api/materials/recommended/) had no frontend page consuming it at all. Two real sections:
	// a personalized "Recommended" strip (RecommendedMaterials.svelte) above a full, filterable,
	// sortable grid across every branch at once — both respecting the same shared
	// simple/advanced `materialsUiStore` mode every other materials surface in this app now reads.
	import type { Discipline, Material, MaterialBrowseFilters } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getDisciplines } from '$lib/services/taxonomy';
	import { browseMaterials } from '$lib/services/materials';
	import MaterialFilterBar from '$lib/components/material/MaterialFilterBar.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import RecommendedMaterials from '$lib/components/material/RecommendedMaterials.svelte';
	import NewSinceNotice from '$lib/components/shared/NewSinceNotice.svelte';
	import SavedCopyNotice from '$lib/components/shared/SavedCopyNotice.svelte';
	import StaleRow from '$lib/components/shared/StaleRow.svelte';
	import { cachedList, type TrackedRow } from '$lib/state/cachedList.svelte';

	let fields = $state<Discipline[]>([]);
	let materials = $state<TrackedRow<Material>[]>([]);
	let filters = $state<MaterialBrowseFilters>({});
	let loading = $state(true);
	let newCount = $state(0);
	let offline = $state(false);

	let savedAt = $derived(
		materials.length ? Math.max(...materials.map((row) => row.confirmedAt)) : null
	);
	let stale = $derived(savedAt !== null && Date.now() - savedAt > 24 * 60 * 60 * 1000);

	$effect(() => {
		getDisciplines().then((f) => (fields = f));
	});

	// Every filter field is read synchronously here so Svelte's own effect tracking picks each one
	// up individually — the same shape routes/branches/[branch]/+page.svelte's own exercise-filter
	// effect already uses.
	$effect(() => {
		const query = filters.query;
		const type = filters.type;
		const tag = filters.tag;
		const disciplineId = filters.disciplineId;
		const branchId = filters.branchId;
		const topicId = filters.topicId;
		const minLevel = filters.minLevel;
		const sort = filters.sort;
		const active = { query, type, tag, disciplineId, branchId, topicId, minLevel, sort };
		loading = true;
		newCount = 0;
		offline = false;

		// Only the unfiltered view is cached, and that is a deliberate limit rather than a shortcut.
		// Two reasons: a merge across two different queries is meaningless — every row the new filter
		// excludes would be reported as "removed by the server" and every row it includes as "new
		// since you last looked", when nothing changed but the question — and keeping a separate
		// saved list per filter combination would spend the whole localStorage budget on searches
		// nobody returns to. Somebody who has typed a query is also asking a live question, where
		// showing them the previous answer first is the opposite of helpful.
		const isDefaultView = Object.values(active).every((v) => v === undefined || v === '');

		if (!isDefaultView) {
			browseMaterials(active).then((list) => {
				// Just fetched, so every row is current and draws at full strength — the wrapper is
				// kept rather than branched around so both paths render through one template.
				const now = Date.now();
				materials = list.map((item) => ({ item, confirmedAt: now, isNew: false }));
				loading = false;
			});
			return;
		}

		cachedList<Material>(
			'materials:all',
			() => browseMaterials(active),
			(result) => {
				materials = result.rows;
				newCount = result.newCount;
				offline = result.offline;
				loading = false;
			}
		).catch(() => {
			loading = false;
		});
	});
</script>

<svelte:head>
	<title>{m.materialsHub_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<header>
		<h1>{m.materialsHub_heading()}</h1>
		<p>{m.materialsHub_subtitle()}</p>
	</header>

	<RecommendedMaterials />

	<div class="layout">
		<MaterialFilterBar bind:filters resultCount={materials.length} scope="global" {fields} />
		<!-- The two notices sit outside `.grid` deliberately: it is an auto-fill card grid, so a
		     notice placed inside it becomes a 280px cell alongside the cards rather than a line
		     spanning the results it describes. -->
		<div class="results">
			{#if !loading && materials.length > 0}
				{#if offline}
					<SavedCopyNotice {savedAt} {stale} />
				{/if}
				<NewSinceNotice count={newCount} />
			{/if}
			<div class="grid">
				{#if loading}
					<p class="loading">{m.common_loading()}</p>
				{:else if materials.length === 0}
					<p class="empty">{m.home_noResults()}</p>
				{:else}
					{#each materials as row (row.item.id)}
						<StaleRow confirmedAt={row.confirmedAt}>
							<MaterialCard material={row.item} />
						</StaleRow>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>

<style lang="scss">
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	header p {
		color: var(--text-secondary);
		margin-top: var(--space-2);
	}
	.layout {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: var(--space-4);
		align-items: start;
	}
	// The filter bar and the results are the two columns of `.layout`, so the notices and the card
	// grid have to be stacked inside one element to stay in the results column.
	.results {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-3);
	}
	.loading,
	.empty {
		color: var(--text-secondary);
	}

	@media (max-width: 780px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}
</style>
