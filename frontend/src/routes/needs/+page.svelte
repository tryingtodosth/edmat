<script lang="ts">
	// The public "help wanted" board (MANAGEMENT-BRIEF.md §3.C). Wrapped in `FeatureGate` for the
	// same reason every other gated route is: without it a visitor reaches the real page and only
	// discovers the switch is off from a raw 403 on the first fetch.
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { Need, NeedBoardFilters, NeedKind } from '$lib/types/need';
	import { getNeeds } from '$lib/services/needs';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { NEED_KINDS, NEED_KIND_LABELS, NEED_STATUS_LABELS } from '$lib/utils/labels';
	import { formatDateTime } from '$lib/utils/datetime';
	import { pageTitle } from '$lib/utils/pageTitle';

	let needs = $state<Need[]>([]);
	let loading = $state(true);
	let failed = $state(false);

	let kind = $state<NeedKind | ''>('');
	let remote = $state(false);
	let query = $state('');
	let nodeKind = $state<'' | 'course' | 'event' | 'material'>('');

	async function load() {
		loading = true;
		failed = false;
		const filters: NeedBoardFilters = {};
		if (kind) filters.kind = kind;
		if (remote) filters.remote = true;
		if (query.trim()) filters.q = query.trim();
		if (nodeKind) filters.nodeKind = nodeKind;
		try {
			needs = await getNeeds(filters);
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(load, 300);
	}
</script>

<svelte:head>
	<title>{pageTitle(m.needs_browseHeading())}</title>
</svelte:head>

<FeatureGate feature="needs">
	<div class="page">
		<header class="head">
			<div>
				<h1>{m.needs_browseHeading()}</h1>
				<p class="lead">{m.needs_browseLead()}</p>
			</div>
		</header>

		<div class="filters">
			<select bind:value={kind} onchange={load} aria-label={m.needs_formKindLabel()}>
				<option value="">{m.needs_filter_allKinds()}</option>
				{#each NEED_KINDS as k (k)}
					<option value={k}>{NEED_KIND_LABELS[k]()}</option>
				{/each}
			</select>
			<select bind:value={nodeKind} onchange={load} aria-label={m.needs_formKindLabel()}>
				<option value="">{m.needs_filter_nodeKind_all()}</option>
				<option value="course">{m.needs_filter_nodeKind_course()}</option>
				<option value="event">{m.needs_filter_nodeKind_event()}</option>
				<option value="material">{m.needs_filter_nodeKind_material()}</option>
			</select>
			<label class="checkbox">
				<input type="checkbox" bind:checked={remote} onchange={load} />
				<span>{m.needs_filter_remoteOnly()}</span>
			</label>
			<input
				type="text"
				class="search"
				bind:value={query}
				oninput={onSearchInput}
				placeholder={m.needs_searchPlaceholder()}
				aria-label={m.needs_searchPlaceholder()}
			/>
		</div>

		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if failed}
			<p class="status">{m.common_error_generic()}</p>
		{:else if needs.length === 0}
			<p class="status">{m.needs_browseEmpty()}</p>
		{:else}
			<div class="grid">
				{#each needs as need (need.id)}
					<a class="card" href={resolve('/needs/[id]', { id: need.id })}>
						<div class="card__head">
							<strong>{need.title}</strong>
							<span class="pill pill--{need.status}">{NEED_STATUS_LABELS[need.status]()}</span>
						</div>
						{#if need.node}
							<p class="node">{m.needs_onNode({ title: need.node.title })}</p>
						{/if}
						<div class="meta">
							<span class="kind">{NEED_KIND_LABELS[need.kind]()}</span>
							<span>{m.needs_wantedCount({ count: need.wantedCount })}</span>
							{#if need.isRemote}<span class="badge">{m.needs_remoteBadge()}</span>{/if}
							{#if need.estimatedHours}<span
									>{m.needs_estimatedHours({ hours: need.estimatedHours })}</span
								>{/if}
							{#if need.deadline}<span
									>{m.needs_deadlineLabel({ date: formatDateTime(need.deadline) })}</span
								>{/if}
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.head h1 {
		margin: 0 0 0.3rem;
	}
	.lead {
		color: var(--text-secondary);
		max-width: 60ch;
		margin: 0;
	}
	.filters {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		align-items: center;
	}
	select,
	input.search {
		font: inherit;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		min-height: 40px;
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.9rem;
	}
	.status {
		color: var(--text-secondary);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.card {
		display: block;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.8rem 1rem;
		background: var(--bg-surface);
		color: inherit;
		text-decoration: none;
	}
	.card__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.node {
		color: var(--text-secondary);
		font-size: 0.85rem;
		margin: 0.3rem 0;
	}
	.meta {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		font-size: 0.82rem;
		color: var(--text-secondary);
		margin-top: 0.4rem;
	}
	.badge {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 0.4rem;
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		flex-shrink: 0;
	}
	.pill--open {
		background: var(--status-success-bg);
		color: var(--status-success);
		border-color: transparent;
	}
	.pill--in_progress {
		background: var(--status-warning-bg);
		color: var(--status-warning);
		border-color: transparent;
	}
	.pill--fulfilled,
	.pill--cancelled {
		opacity: 0.7;
	}
</style>
