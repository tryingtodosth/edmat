<script lang="ts">
	import { onMount } from 'svelte';
	import type { Discipline } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getBranchesForDiscipline, getDisciplines } from '$lib/services/taxonomy';
	import DisciplineCard from '$lib/components/discipline/DisciplineCard.svelte';
	import Loading from '$lib/components/shared/Loading.svelte';
	import SavedCopyNotice from '$lib/components/shared/SavedCopyNotice.svelte';
	import { cached } from '$lib/state/offlineCache.svelte';
	import { splitByStatus } from '$lib/utils/taxonomy';

	let fields = $state<Discipline[]>([]);
	let courseCounts = $state<Record<string, number>>({});
	let loading = $state(true);
	// A saved copy paints on the first frame, so this page opens with the disciplines you saw last
	// time rather than an empty grid — and says so if the network never answers.
	let savedAt = $state<number | null>(null);
	let offline = $state(false);
	let stale = $state(false);

	// Anybody signed in may propose a discipline, and everybody else's proposal is live but
	// `pending` until a moderator agrees. Rather than hiding those — which would make proposing one
	// useless until somebody wakes up — they are grouped under "Others", so the settled vocabulary
	// reads as settled while a suggestion is still findable and filable against.
	let grouped = $derived(splitByStatus(fields));
	let settled = $derived(grouped.settled);
	let proposed = $derived(grouped.proposed);

	onMount(async () => {
		await cached('disciplines', getDisciplines, (result) => {
			if (!result.data) return;
			fields = result.data;
			// Content is on screen the moment there is any, cached or fresh — the spinner is for
			// having nothing to show, not for "a request is in flight".
			loading = false;
			savedAt = result.fromCache ? result.savedAt : null;
			offline = result.offline;
			stale = result.stale;
		}).catch(() => {
			// Nothing cached and the network failed: the empty state is then the honest answer.
		});
		loading = false;

		const counts: Record<string, number> = {};
		await Promise.all(
			fields.map(async (f) => {
				try {
					counts[f.id] = (await getBranchesForDiscipline(f.id)).length;
				} catch {
					counts[f.id] = 0;
				}
			})
		);
		courseCounts = counts;
	});
</script>

<svelte:head>
	<title>{m.nav_browse()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.nav_browse()}</h1>
	{#if loading}
		<Loading variant="card" count={3} />
	{:else}
		{#if offline}
			<SavedCopyNotice {savedAt} {stale} />
		{/if}
		<div class="grid">
			{#each settled as field (field.id)}
				<DisciplineCard {field} courseCount={courseCounts[field.id] ?? 0} />
			{/each}
		</div>

		{#if proposed.length > 0}
			<section class="proposed">
				<h2>{m.taxonomy_others()}</h2>
				<p class="hint">{m.taxonomy_propose_pending()}</p>
				<div class="grid">
					{#each proposed as field (field.id)}
						<DisciplineCard {field} courseCount={courseCounts[field.id] ?? 0} />
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
		border-top: 1px dashed var(--border);
	}
	.proposed .hint {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
	}
</style>
