<script lang="ts">
	/** "N items in other languages are hidden — show them" (AUDIENCE-BRIEF.md §5). A list that
	 * silently drops most of the site reads as an empty site; this line is what keeps it honest.
	 * `path` is the request path the list came from (no query string). */
	import { m } from '$lib/paraglide/messages.js';
	import { hiddenCountsStore } from '$lib/state/hiddenCounts.svelte';
	import { contentLocalesStore } from '$lib/state/contentLocales.svelte';
	import { authStore } from '$lib/state/auth.svelte';

	let { path }: { path: string } = $props();
	const count = $derived(hiddenCountsStore.for(path));

	function showAll() {
		contentLocalesStore.showAll();
		if (authStore.isAuthenticated)
			void authStore.updateProfile({ contentLocales: contentLocalesStore.extras });
	}
</script>

{#if count > 0}
	<p class="hidden-notice" role="status">
		{m.contentLocales_hidden({ count })}
		<button type="button" onclick={showAll}>{m.contentLocales_showThem()}</button>
	</p>
{/if}

<style lang="scss">
	.hidden-notice {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		margin: 0.5rem 0 1rem;
		padding: 0.5rem 0.8rem;
		border-radius: 8px;
		// A passive notice with a choice is neither a warning nor a request (2026-10-07 colour pass):
		// warning is reserved for things that must be acted on. Grey on the alt surface, with the
		// button in the accent because it is the one interactive thing here.
		background: var(--bg-surface-alt);
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
	button {
		min-height: 44px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--accent);
		background: transparent;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
	}
</style>
