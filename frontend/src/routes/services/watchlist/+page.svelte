<script lang="ts">
	// "Add certain tutor offers to a watchlist to compare listings" — the comparison view itself.
	// A plain grid of ServiceCard, same as the browse page's own grid, reused directly rather than
	// a bespoke side-by-side comparison table: every field worth comparing (rate, courses, rating)
	// already renders on the card, and this app has no precedent anywhere for a dedicated
	// column-per-listing comparison table to match instead.
	import { resolve } from '$app/paths';
	import type { ServiceWatch } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { getWatchlist, unwatchService } from '$lib/services/tutoring';
	import { getCourseById } from '$lib/services/taxonomy';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';

	let watches = $state<ServiceWatch[]>([]);
	let courseNamesByServiceId = $state<Record<string, string[]>>({});
	let loading = $state(true);

	async function load() {
		loading = true;
		watches = await getWatchlist();
		const entries = await Promise.all(
			watches.map(async (w) => {
				const courses = await Promise.all(w.service.courseIds.map((id) => getCourseById(id)));
				return [w.service.id, courses.filter((c) => c !== undefined).map((c) => c!.name)] as const;
			})
		);
		courseNamesByServiceId = Object.fromEntries(entries);
		loading = false;
	}

	async function handleRemove(watchId: string) {
		await unwatchService(watchId);
		watches = watches.filter((w) => w.id !== watchId);
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
		<div class="grid">
			{#each watches as watch (watch.id)}
				<div class="watch-item">
					<ServiceCard
						service={watch.service}
						courseNames={courseNamesByServiceId[watch.service.id] ?? []}
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
