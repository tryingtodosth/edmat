<script lang="ts" generics="T">
	/**
	 * One dashboard section: heading, loading, an error with a retry, and the data handed to its
	 * body. It reloads whenever `deps` changes (the period, or the recompute counter), and drops the
	 * answer of any load that was overtaken by a newer one.
	 *
	 * The load runs in an $effect, never at component top level: a top-level service call runs
	 * during SSR with no token (frontend CLAUDE.md trap 5). The page only mounts sections once it
	 * knows the visitor is staff, so there is no auth flag to race.
	 */
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	interface Props {
		id: string;
		title: string;
		intro?: string;
		load: () => Promise<T>;
		/** Anything that should trigger a reload when it changes. */
		deps: string;
		children: Snippet<[T]>;
	}
	let { id, title, intro, load, deps, children }: Props = $props();

	let data = $state<T | null>(null);
	let loading = $state(true);
	let error = $state('');
	let ticket = 0;

	async function run() {
		const mine = ++ticket;
		loading = true;
		error = '';
		try {
			const result = await load();
			if (mine === ticket) data = result;
		} catch (e) {
			if (mine === ticket) error = e instanceof Error ? e.message : String(e);
		} finally {
			if (mine === ticket) loading = false;
		}
	}

	$effect(() => {
		void deps;
		untrack(run);
	});
</script>

<section class="section" aria-labelledby={`an-${id}`} aria-busy={loading}>
	<h2 id={`an-${id}`}>{title}</h2>
	{#if intro}<p class="intro">{intro}</p>{/if}
	{#if error}
		<p class="error" role="alert">
			{m.analytics_loadFailed({ error })}<!-- "Could not load this section: {error}" -->
			<button type="button" class="retry" onclick={run}>{m.analytics_retry()}</button
			><!-- "Try again" -->
		</p>
	{/if}
	{#if data !== null}
		<div class:stale={loading}>
			{@render children(data as T)}
		</div>
	{:else if loading}
		<p class="loading">{m.common_loading()}</p>
		<!-- "Loading…" -->
	{/if}
</section>

<style lang="scss">
	.section {
		margin-top: var(--space-6);
		padding: var(--space-4);
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		min-width: 0;
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-lg);
	}
	.intro,
	.loading {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin: 0 0 var(--space-3);
	}
	.error {
		color: var(--status-danger);
	}
	.retry {
		margin-left: var(--space-2);
	}
	.stale {
		opacity: 0.6;
	}
	// Shared by every table in every section (they are slotted in as children).
	.section :global(.table-wrap) {
		overflow-x: auto;
		max-width: 100%;
	}
	.section :global(table.atable) {
		border-collapse: collapse;
		width: 100%;
		font-size: var(--font-size-sm);
	}
	.section :global(table.atable caption) {
		text-align: left;
		font-weight: 600;
		padding: var(--space-2) 0;
	}
	.section :global(table.atable th),
	.section :global(table.atable td) {
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--border-color);
		text-align: left;
		vertical-align: top;
	}
	.section :global(table.atable th) {
		color: var(--text-secondary);
		font-weight: 600;
		white-space: nowrap;
	}
	.section :global(table.atable .num) {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.section :global(.mono) {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		word-break: break-all;
	}
	.section :global(.note) {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin: var(--space-2) 0;
	}
	.section :global(h3) {
		font-size: var(--font-size-base);
		margin: var(--space-4) 0 var(--space-2);
	}
	.section :global(.grid2) {
		display: grid;
		gap: var(--space-4);
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
	}
	.section :global(.grid2 > *) {
		min-width: 0;
	}
</style>
