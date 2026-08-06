<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Branch, Discipline } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getBranchesForDiscipline, getDisciplineById } from '$lib/services/taxonomy';
	import { getExercisesForBranch } from '$lib/services/exercises';
	import BranchCard from '$lib/components/branch/BranchCard.svelte';
	import { isPending, splitByStatus } from '$lib/utils/taxonomy';
	import PendingBadge from '$lib/components/shared/PendingBadge.svelte';

	let field = $state<Discipline | undefined>(undefined);
	let branches = $state<Branch[]>([]);
	// Proposed branches are real and browsable, just grouped under "Others" until a moderator
	// agrees — see lib/utils/taxonomy.ts for why they are neither hidden nor mixed in.
	let grouped = $derived(splitByStatus(branches));
	let exerciseCounts = $state<Record<string, number>>({});
	let loading = $state(true);
	let notFound = $state(false);

	async function load(disciplineId: string) {
		loading = true;
		notFound = false;
		const f = await getDisciplineById(disciplineId);
		if (!f) {
			notFound = true;
			loading = false;
			return;
		}
		field = f;
		branches = await getBranchesForDiscipline(disciplineId);
		const counts: Record<string, number> = {};
		await Promise.all(
			branches.map(async (c) => {
				counts[c.id] = (await getExercisesForBranch(c.id, getLocale())).length;
			})
		);
		exerciseCounts = counts;
		loading = false;
	}

	// See routes/exercises/[id]/+page.svelte's own note on why this guard exists — an
	// id-changed check keeps a spuriously-refiring $effect idempotent instead of just hoping it
	// never refires without a real navigation.
	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.discipline!;
		if (id === loadedForId) return;
		loadedForId = id;
		load(id);
	});
</script>

<svelte:head>
	<title>{field?.name ?? m.common_appName()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<!-- "Breadcrumb" -->
	<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
		<a href={resolve('/disciplines')}>{m.common_home()}</a>
	</nav>

	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else if notFound}
		<p class="empty">{m.discipline_notFound()}</p>
	{:else if field}
		<header>
			<!-- The grouping on the page you came from says this for a whole section; once you are
			     looking at one node on its own there is nothing left to carry it. -->
			<h1>
				{field.name}
				{#if isPending(field)}<PendingBadge />{/if}
			</h1>
			<p>{field.description}</p>
		</header>
		<h2>{m.discipline_branchesHeading()}</h2>
		<div class="grid">
			{#each grouped.settled as branch (branch.id)}
				<BranchCard {branch} exerciseCount={exerciseCounts[branch.id] ?? 0} />
			{/each}
		</div>

		<!-- Same shape as the disciplines index: a suggestion stays findable and filable against,
		     under a heading that says it has not been agreed to yet. -->
		{#if grouped.proposed.length > 0}
			<section class="proposed">
				<h2>{m.taxonomy_others()}</h2>
				<p class="hint">{m.taxonomy_propose_pending()}</p>
				<div class="grid">
					{#each grouped.proposed as branch (branch.id)}
						<BranchCard
							{branch}
							exerciseCount={exerciseCounts[branch.id] ?? 0}
							showPending={false}
						/>
					{/each}
				</div>
			</section>
		{/if}
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
	.breadcrumb {
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
		}
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	header p {
		color: var(--text-secondary);
		margin-top: var(--space-1);
	}
	h2 {
		font-size: var(--font-size-lg);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.loading,
	.empty {
		color: var(--text-secondary);
	}
	/* The "Others" section. Set apart rather than merely appended: a suggestion nobody has agreed
	   to yet should not read as part of the settled vocabulary just because it sorts after it. */
	.proposed {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px dashed var(--border-color);
	}
	.proposed .hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
