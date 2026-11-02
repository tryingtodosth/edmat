<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Branch, Discipline } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getBranchesForDiscipline, getDisciplineById } from '$lib/services/taxonomy';
	import BranchCard from '$lib/components/branch/BranchCard.svelte';
	import BrowseLens from '$lib/components/shared/BrowseLens.svelte';
	import { audienceFilterStore } from '$lib/state/audienceFilter.svelte';
	import { splitByLens } from '$lib/utils/audienceCounts';
	import { isPending, splitByStatus } from '$lib/utils/taxonomy';
	import PendingBadge from '$lib/components/shared/PendingBadge.svelte';
	import { taxonomyStore } from '$lib/state/taxonomy.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let field = $state<Discipline | undefined>(undefined);
	let branches = $state<Branch[]>([]);
	// Proposed branches are real and browsable, just grouped under "Others" until a moderator
	// agrees — see lib/utils/taxonomy.ts for why they are neither hidden nor mixed in.
	let grouped = $derived(splitByStatus(branches));
	// The lens decides the order and what folds under "For other groups" (see routes/disciplines).
	// The counts ride on each branch (taxonomy/counts.py). Until 2026-11-02 this page fetched every
	// exercise of every branch to count them — ~750 rows per visit — and because that request
	// carried `?audience=`, a primary-school reader saw a grid of zeros with nothing saying why.
	let bands = $derived(audienceFilterStore.bands);
	let lens = $derived(splitByLens(grouped.settled, bands));
	let loading = $state(true);
	let notFound = $state(false);

	async function load(disciplineId: string) {
		loading = true;
		notFound = false;
		// The preloaded tree answers both of these without a request, so a click from the index
		// paints immediately. It still falls back to a direct fetch, because a deep link to this URL
		// can arrive before the preload has finished — and because a node proposed in another tab
		// would not be in the copy this one loaded.
		await taxonomyStore.preload();
		const f = taxonomyStore.disciplineById(disciplineId) ?? (await getDisciplineById(disciplineId));
		if (!f) {
			notFound = true;
			loading = false;
			return;
		}
		field = f;
		const known = taxonomyStore.branchesFor(disciplineId);
		branches = known.length > 0 ? known : await getBranchesForDiscipline(disciplineId);
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
	<title>{pageTitle(field?.name)}</title>
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
		<!-- Under the title, as on the index and the branch page: the page says WHAT it is first,
		     then through which lens it is drawn. -->
		<BrowseLens nodes={branches} />
		<h2>{m.discipline_branchesHeading()}</h2>
		<div class="grid">
			{#each lens.shown as branch (branch.id)}
				<BranchCard {branch} {bands} />
			{/each}
		</div>

		{#if lens.folded.length > 0}
			<details class="folded" data-testid="browse-folded" open={lens.shown.length === 0}>
				<summary>{m.browse_otherGroups({ count: lens.folded.length })}</summary>
				<!-- "For other groups ({count})" -->
				<p class="hint">{m.browse_otherGroupsHint()}</p>
				<div class="grid">
					{#each lens.folded as branch (branch.id)}
						<BranchCard {branch} {bands} folded />
					{/each}
				</div>
			</details>
		{/if}

		<!-- Same shape as the disciplines index: a suggestion stays findable and filable against,
		     under a heading that says it has not been agreed to yet. -->
		{#if grouped.proposed.length > 0}
			<section class="proposed">
				<h2>{m.taxonomy_others()}</h2>
				<p class="hint">{m.taxonomy_propose_pending()}</p>
				<div class="grid">
					{#each grouped.proposed as branch (branch.id)}
						<BranchCard {branch} {bands} showPending={false} />
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
	/* "For other groups" — same shape as on routes/disciplines. */
	.folded {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		summary {
			cursor: pointer;
			min-height: 44px;
			display: flex;
			align-items: center;
			color: var(--text-secondary);
			font-weight: 600;
		}
		.grid {
			margin-top: var(--space-2);
		}
	}
	.folded .hint,
	.proposed .hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
