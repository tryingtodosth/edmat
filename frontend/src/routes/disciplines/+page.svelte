<script lang="ts">
	import { onMount } from 'svelte';
	import type { Discipline } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getBranchesForDiscipline, getDisciplines } from '$lib/services/taxonomy';
	import DisciplineCard from '$lib/components/discipline/DisciplineCard.svelte';

	let fields = $state<Discipline[]>([]);
	let courseCounts = $state<Record<string, number>>({});
	let loading = $state(true);

	onMount(async () => {
		fields = await getDisciplines();
		const counts: Record<string, number> = {};
		await Promise.all(
			fields.map(async (f) => {
				counts[f.id] = (await getBranchesForDiscipline(f.id)).length;
			})
		);
		courseCounts = counts;
		loading = false;
	});
</script>

<svelte:head>
	<title>{m.nav_browse()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.nav_browse()}</h1>
	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else}
		<div class="grid">
			{#each fields as field (field.id)}
				<DisciplineCard {field} courseCount={courseCounts[field.id] ?? 0} />
			{/each}
		</div>
	{/if}
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
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.loading {
		color: var(--text-secondary);
	}
</style>
