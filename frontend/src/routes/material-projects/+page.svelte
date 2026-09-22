<script lang="ts">
	// The two questions somebody has about co-authoring: what am I part of, and what could I join?
	//
	// Tabs rather than one list, with the choice in the URL (`?tab=`) the way the homepage does it —
	// so the back button steps between them, and a link to "looking for co-authors" is a link
	// somebody can send. `seeking` is the default because it is the public one: a signed-out visitor
	// landing here should see something rather than a prompt to sign in.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { getAllBranches } from '$lib/services/taxonomy';
	import { listMyProjects, listSeekingProjects } from '$lib/services/materialProjects';
	import type { Branch } from '$lib/types';
	import type { MaterialProject } from '$lib/types/materialProject';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import TaxonomyOptions from '$lib/components/shared/TaxonomyOptions.svelte';
	import ProjectCard from '$lib/components/coauthoring/ProjectCard.svelte';
	import { COAUTHORING_FLAG } from '$lib/components/coauthoring/labels';

	type TabId = 'mine' | 'seeking';

	let mine = $state<MaterialProject[]>([]);
	let seeking = $state<MaterialProject[]>([]);
	let branches = $state<Branch[]>([]);
	let branchFilter = $state('');
	let loading = $state(true);
	let failed = $state(false);

	let active = $derived.by((): TabId => {
		const asked = page.url.searchParams.get('tab');
		return asked === 'mine' ? 'mine' : 'seeking';
	});

	function selectTab(id: TabId) {
		// Built from the live URL rather than from `resolve()`: other parameters have to survive a
		// tab switch, and `resolve` cannot express "this page, with one parameter changed".
		const url = new URL(page.url);
		if (id === 'seeking') url.searchParams.delete('tab');
		else url.searchParams.set('tab', id);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, one query parameter changed
		goto(url, { keepFocus: true, noScroll: true });
	}

	function onTabKeydown(event: KeyboardEvent) {
		const order: TabId[] = ['seeking', 'mine'];
		const at = order.indexOf(active);
		let next: TabId | null = null;
		if (event.key === 'ArrowRight') next = order[(at + 1) % order.length];
		else if (event.key === 'ArrowLeft') next = order[(at - 1 + order.length) % order.length];
		if (!next) return;
		event.preventDefault();
		selectTab(next);
		// Focus follows selection in an automatically-activated tab list, or the arrow key moves the
		// panel and leaves focus on the tab that is no longer selected.
		document.getElementById(`coauth-tab-${next}`)?.focus();
	}

	async function load(tab: TabId, branch: string) {
		loading = true;
		failed = false;
		try {
			if (tab === 'mine') {
				mine = authStore.isAuthenticated ? await listMyProjects() : [];
			} else {
				seeking = await listSeekingProjects(branch || undefined);
			}
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	// Keyed on the tab, the filter AND whether a session has resolved: reading
	// `authStore.isAuthenticated` once at mount answers with what was true before the profile came
	// back, which is how a hard reload shows an empty "Mine" to somebody who is signed in
	// (frontend/CLAUDE.md trap 3).
	let loadedFor = $state('');
	$effect(() => {
		const key = `${active}:${branchFilter}:${authStore.isAuthenticated}`;
		if (key === loadedFor) return;
		loadedFor = key;
		load(active, branchFilter);
	});

	onMount(() => {
		getAllBranches()
			.then((rows) => (branches = rows))
			.catch(() => (branches = []));
	});

	let toDecide = $derived(mine.reduce((sum, p) => sum + p.pendingProposalsCount, 0));
	let canStart = $derived(
		featureFlagsStore.isEnabled('material_submissions') || authStore.isModerator
	);
</script>

<!-- "Co-authoring" / "Materials written by a team: version history, projects looking for
     co-authors, and a way to join one." -->
<PageHead title={m.coauth_browse_heading()} description={m.coauth_seo_browse()} />

<FeatureGate feature={COAUTHORING_FLAG}>
	<div class="page">
		<header class="head">
			<div>
				<h1>{m.coauth_browse_heading()}</h1>
				<!-- "Co-authoring" -->
				<p class="lead">{m.coauth_browse_lead()}</p>
				<!-- "Materials with a team behind them: every change is a version somebody accepted…" -->
			</div>
			{#if authStore.isAuthenticated && canStart}
				<a class="primary" href={resolve('/material-projects/new')}>
					{m.coauth_browse_start()}
					<!-- "Start a material together" -->
				</a>
			{/if}
		</header>

		<!-- `tabindex="-1"` on the list itself, with the roving tabindex on the tabs: the container
		     takes the keydown handler, so it has to be focusable for the role to be an honest claim
		     (the homepage's own tablist does the same). Its label is "Project lists". -->
		<div
			class="tabs"
			role="tablist"
			tabindex="-1"
			aria-label={m.coauth_browse_tabsLabel()}
			onkeydown={onTabKeydown}
		>
			<button
				type="button"
				role="tab"
				id="coauth-tab-seeking"
				class="tab"
				class:tab--active={active === 'seeking'}
				aria-selected={active === 'seeking'}
				aria-controls="coauth-panel-seeking"
				tabindex={active === 'seeking' ? 0 : -1}
				onclick={() => selectTab('seeking')}
			>
				{m.coauth_browse_tab_seeking()}
				<!-- "Looking for co-authors" -->
			</button>
			<button
				type="button"
				role="tab"
				id="coauth-tab-mine"
				class="tab"
				class:tab--active={active === 'mine'}
				aria-selected={active === 'mine'}
				aria-controls="coauth-panel-mine"
				tabindex={active === 'mine' ? 0 : -1}
				onclick={() => selectTab('mine')}
			>
				{m.coauth_browse_tab_mine()}
				<!-- "Mine" -->
			</button>
		</div>

		{#if active === 'seeking'}
			<div id="coauth-panel-seeking" role="tabpanel" aria-labelledby="coauth-tab-seeking">
				<label class="filter">
					<span>{m.submitMaterial_field_course()}</span>
					<!-- "Subject" -->
					<select bind:value={branchFilter}>
						<option value="">{m.coauth_browse_allBranches()}</option>
						<!-- "Every subject" -->
						<TaxonomyOptions nodes={branches} />
					</select>
				</label>

				{#if loading}
					<p class="hint">{m.common_loading()}</p>
					<!-- "Loading…" -->
				{:else if failed}
					<p class="hint">{m.common_error_generic()}</p>
					<!-- "Something went wrong." -->
				{:else if seeking.length === 0}
					<p class="hint">{m.coauth_browse_seekingEmpty()}</p>
					<!-- "No project is looking for co-authors right now." -->
				{:else}
					<ul class="cards">
						{#each seeking as project (project.id)}
							<li><ProjectCard {project} headingLevel={2} /></li>
						{/each}
					</ul>
				{/if}
			</div>
		{:else}
			<div id="coauth-panel-mine" role="tabpanel" aria-labelledby="coauth-tab-mine">
				{#if authStore.restoring}
					<p class="hint">{m.common_loading()}</p>
					<!-- "Loading…" -->
				{:else if !authStore.isAuthenticated}
					<p class="hint">
						<a href={resolve('/login')}>{m.coauth_browse_loginForMine()}</a>
						<!-- "Sign in to see the projects you are part of." -->
					</p>
				{:else if loading}
					<p class="hint">{m.common_loading()}</p>
					<!-- "Loading…" -->
				{:else if failed}
					<p class="hint">{m.common_error_generic()}</p>
					<!-- "Something went wrong." -->
				{:else if mine.length === 0}
					<p class="hint">{m.coauth_browse_mineEmpty()}</p>
					<!-- "You are not a co-author of anything yet." -->
				{:else}
					{#if toDecide > 0}
						<p class="waiting">
							{m.coauth_browse_toDecide()}: {toDecide}
							<!-- "Waiting for you to decide" -->
						</p>
					{/if}
					<ul class="cards">
						{#each mine as project (project.id)}
							<li><ProjectCard {project} headingLevel={2} /></li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;

		h1 {
			margin: 0;
		}
	}
	.lead {
		margin: var(--space-1) 0 0 0;
		color: var(--text-secondary);
	}
	.tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 1px solid var(--border-color);
	}
	.tab {
		@include mix.focus-ring;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		cursor: pointer;
	}
	.tab--active {
		color: var(--text-primary);
		border-bottom-color: var(--accent);
		font-weight: 600;
	}
	.filter {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		margin-bottom: var(--space-3);

		select {
			@include mix.focus-ring;
			font: inherit;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.hint {
		color: var(--text-secondary);

		a {
			color: var(--accent);
		}
	}
	.waiting {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
		align-self: flex-start;
		margin-bottom: var(--space-2);
	}
	.primary {
		@include mix.button-primary;
		min-height: 44px;
		padding: var(--space-2) var(--space-4);
		text-decoration: none;
	}
</style>
