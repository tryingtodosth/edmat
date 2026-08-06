<script lang="ts">
	// "Add certain tutor offers to a watchlist to compare listings" — the comparison view itself.
	// A plain grid of ServiceCard, same as the browse page's own grid, reused directly rather than
	// a bespoke side-by-side comparison table: every field worth comparing (rate, branches, rating)
	// already renders on the card, and this app has no precedent anywhere for a dedicated
	// column-per-listing comparison table to match instead.
	import { resolve } from '$app/paths';
	import type { ServiceWatch } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { getWatchlist, unwatchService } from '$lib/services/tutoring';
	import { getBranchById } from '$lib/services/taxonomy';
	import { cachedList, opacityFor, type TrackedRow } from '$lib/state/cachedList.svelte';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';
	import NewSinceNotice from '$lib/components/shared/NewSinceNotice.svelte';

	// A watchlist is the list this pattern fits best on this whole surface: it is deliberately
	// re-visited (that is what "compare these" means), it is small, and the rows are almost always
	// the same ones — so painting the saved copy first is nearly always painting the right answer,
	// and the fade is what tells you how long it has been since anybody checked the rate you are
	// comparing against.
	let watches = $state<TrackedRow<ServiceWatch>[]>([]);
	let newSinceLastVisit = $state(0);
	let courseNamesByServiceId = $state<Record<string, string[]>>({});
	let loading = $state(true);

	async function resolveBranchNames(rows: TrackedRow<ServiceWatch>[]) {
		const entries = await Promise.all(
			rows.map(async ({ item }) => {
				const branches = await Promise.all(item.service.branchIds.map((id) => getBranchById(id)));
				return [
					item.service.id,
					branches.filter((c) => c !== undefined).map((c) => c!.name)
				] as const;
			})
		);
		courseNamesByServiceId = Object.fromEntries(entries);
	}

	async function load() {
		loading = true;
		newSinceLastVisit = 0;
		await cachedList<ServiceWatch>('watchlist', getWatchlist, (result) => {
			watches = result.rows;
			newSinceLastVisit = result.newCount;
			loading = false;
			// Branch names are resolved per row and not awaited here: the cards are already on
			// screen from the cached rows, and holding the whole list back for a label that arrives
			// a moment later would give back exactly the head start the cache just bought.
			resolveBranchNames(result.rows);
		});
		loading = false;
	}

	async function handleRemove(watchId: string) {
		await unwatchService(watchId);
		watches = watches.filter((w) => w.item.id !== watchId);
	}

	let loadedOnce = $state(false);
	$effect(() => {
		if (authStore.isAuthenticated && !loadedOnce) {
			loadedOnce = true;
			load();
		}
	});
</script>

<svelte:head>
	<title>{m.services_watchlistHeading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<div>
		<h1>{m.services_watchlistHeading()}</h1>
		<p class="subtitle">{m.services_watchlistSubtitle()}</p>
	</div>

	{#if !authStore.isAuthenticated}
		<p class="login-prompt">
			<a href={resolve('/login')}>{m.services_watchlistLoginRequired()}</a>
		</p>
	{:else if loading}
		<p class="empty">{m.common_loading()}</p>
	{:else if watches.length === 0}
		<p class="empty">{m.services_watchlistEmpty()}</p>
	{:else}
		<NewSinceNotice count={newSinceLastVisit} />
		<div class="grid">
			{#each watches as row (row.item.id)}
				{@const watch = row.item}
				<div class="watch-item" style="opacity: {opacityFor(row.confirmedAt)}">
					<ServiceCard
						service={watch.service}
						branchNames={courseNamesByServiceId[watch.service.id] ?? []}
					/>
					<button type="button" class="remove" onclick={() => handleRemove(watch.id)}>
						{m.services_removeFromWatchlist()}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 900px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.empty {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.login-prompt {
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.watch-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.remove {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
		align-self: flex-start;
		color: var(--status-danger);
		border-color: var(--status-danger);
	}
</style>
