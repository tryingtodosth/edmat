<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import DisciplineCard from '$lib/components/discipline/DisciplineCard.svelte';
	import BrowseLens from '$lib/components/shared/BrowseLens.svelte';
	import { audienceFilterStore } from '$lib/state/audienceFilter.svelte';
	import { splitByLens } from '$lib/utils/audienceCounts';
	import Loading from '$lib/components/shared/Loading.svelte';
	import SavedCopyNotice from '$lib/components/shared/SavedCopyNotice.svelte';
	import { taxonomyStore } from '$lib/state/taxonomy.svelte';
	import { splitByStatus } from '$lib/utils/taxonomy';
	import { pageTitle } from '$lib/utils/pageTitle';

	// Read from the preloaded tree rather than fetching here. The root layout has usually already
	// warmed it, so this page paints on the first frame; `preload` is still called because a direct
	// visit to this URL is the one case where it has not.
	//
	// It also replaces a real N+1: the branch count per card used to be one request PER discipline,
	// which is the whole point of having every branch already in hand.
	let fields = $derived(taxonomyStore.disciplines);
	let branchCounts = $derived(
		Object.fromEntries(fields.map((f) => [f.id, taxonomyStore.branchesFor(f.id).length]))
	);
	// Audience first (owner, 2026-11-02): the reader's lens decides what leads — disciplines with
	// something for it, biggest first — and what folds under "For other groups". Nothing is hidden.
	let bands = $derived(audienceFilterStore.bands);
	let loading = $derived(!taxonomyStore.loaded);
	// A saved copy paints on the first frame, so this page opens with the disciplines you saw last
	// time rather than an empty grid — and says so if the network never answers.
	let savedAt = $derived(taxonomyStore.savedAt);
	let offline = $derived(taxonomyStore.offline);
	let stale = $derived(false);

	// Anybody signed in may propose a discipline, and everybody else's proposal is live but
	// `pending` until a moderator agrees. Rather than hiding those — which would make proposing one
	// useless until somebody wakes up — they are grouped under "Others", so the settled vocabulary
	// reads as settled while a suggestion is still findable and filable against.
	let grouped = $derived(splitByStatus(fields));
	let lens = $derived(splitByLens(grouped.settled, bands));
	let proposed = $derived(grouped.proposed);

	onMount(() => taxonomyStore.preload());
</script>

<svelte:head>
	<title>{pageTitle(m.browse_heading())}</title>
	<!-- "Disciplines" -->
</svelte:head>

<div class="page">
	<h1>{m.browse_heading()}</h1>
	<BrowseLens nodes={fields} />
	{#if loading}
		<Loading variant="card" count={3} />
	{:else}
		{#if offline}
			<SavedCopyNotice {savedAt} {stale} />
		{/if}
		<div class="grid">
			{#each lens.shown as discipline (discipline.id)}
				<DisciplineCard {discipline} {bands} branchCount={branchCounts[discipline.id] ?? 0} />
			{/each}
		</div>

		{#if lens.folded.length > 0}
			<details class="folded" data-testid="browse-folded" open={lens.shown.length === 0}>
				<summary>{m.browse_otherGroups({ count: lens.folded.length })}</summary>
				<!-- "For other groups ({count})" -->
				<p class="hint">{m.browse_otherGroupsHint()}</p>
				<div class="grid">
					{#each lens.folded as discipline (discipline.id)}
						<DisciplineCard
							{discipline}
							{bands}
							folded
							branchCount={branchCounts[discipline.id] ?? 0}
						/>
					{/each}
				</div>
			</details>
		{/if}

		{#if proposed.length > 0}
			<section class="proposed">
				<h2>{m.taxonomy_others()}</h2>
				<p class="hint">{m.taxonomy_propose_pending()}</p>
				<div class="grid">
					{#each proposed as discipline (discipline.id)}
						<DisciplineCard
							{discipline}
							{bands}
							branchCount={branchCounts[discipline.id] ?? 0}
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
	h1 {
		font-size: var(--font-size-xl);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
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
	/* "For other groups": folded, not hidden (owner, 2026-11-02). Open by itself only when the lens
	   admits nothing at all, so the page is never a heading over an empty grid. */
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
