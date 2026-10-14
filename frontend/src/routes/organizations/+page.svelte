<script lang="ts">
	/**
	 * The organisation directory — every body on the platform, and the ones this reader is in.
	 *
	 * Two tabs rather than two routes, because "all" and "mine" are the same list under a different
	 * `WHERE`; the tab is component state rather than a search parameter so that this page stays
	 * prerenderable if it is ever added to the prerender list (a `+page.ts` that reads
	 * `url.searchParams` fails the build — frontend/CLAUDE.md, "First paint").
	 *
	 * The initial load is in `onMount`, never at component top level: a service call at the top level
	 * runs during SSR with no token, and an uncaught 401 there once took down the whole dev server.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	// The creation gate (learning step F): founding a body is one of the four founding acts
	// `config/creation.py` governs.
	import { creationStore } from '$lib/state/creation.svelte';
	import CreationGateNote from '$lib/components/shared/CreationGateNote.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { getOrganizations } from '$lib/services/organizations';
	import type { OrganizationKind, OrganizationSummary } from '$lib/types/organization';
	import { ORGANIZATION_KIND_LABELS } from '$lib/utils/labels';

	let organizations = $state<OrganizationSummary[]>([]);
	let loading = $state(true);
	let tab = $state<'all' | 'mine'>('all');
	let search = $state('');
	let kind = $state<OrganizationKind | ''>('');

	const KINDS: OrganizationKind[] = [
		'university',
		'faculty',
		'school',
		'student_circle',
		'ngo',
		'company',
		'other'
	];

	async function load() {
		loading = true;
		try {
			organizations = await getOrganizations({
				q: search.trim() || undefined,
				kind: kind || undefined,
				mine: tab === 'mine'
			});
		} catch {
			organizations = [];
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function choose(next: 'all' | 'mine') {
		if (tab === next) return;
		tab = next;
		void load();
	}

	// The filters as they stand, not as last sent: an empty list under a search offers to clear it.
	const filtered = $derived(Boolean(search.trim() || kind));
	function clearFilters() {
		search = '';
		kind = '';
		void load();
	}

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		void load();
	}
</script>

<PageHead title={m.orgs_browseTitle()} description={m.orgs_browseIntro()} />
<!-- "Organisations" / "Bodies that stand behind what happens here — faculties, schools, student circles and the rest." -->

<FeatureGate feature="organizations">
	<div class="page">
		<header class="head">
			<h1>{m.orgs_browseTitle()}</h1>
			<!-- "Organisations" -->
			{#if authStore.isAuthenticated && creationStore.allows('organization')}
				<a class="new" href={resolve('/organizations/new')}>
					{m.orgs_newTitle()}
					<!-- "New organisation" -->
				</a>
			{/if}
		</header>
		<div class="lead">
			<p class="intro">{m.orgs_browseIntro()}</p>
			<!-- "Bodies that stand behind what happens here — faculties, schools, student circles and the rest." -->
			<p class="intro">{m.empty_orgsLead()}</p>
			<!-- "Each one has its own page with its people and the courses, events and materials it runs." -->
		</div>
		<!-- Below the page's own introduction, not above it: looking at the screenshot, the refusal
		     was arriving before the reader had been told what organisations are. -->
		<CreationGateNote kind="organization" />

		<div class="tabs" role="tablist">
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'all'}
				class:active={tab === 'all'}
				onclick={() => choose('all')}
			>
				{m.orgs_tabAll()}
				<!-- "All" -->
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'mine'}
				class:active={tab === 'mine'}
				onclick={() => choose('mine')}
			>
				{m.orgs_tabMine()}
				<!-- "Mine" -->
			</button>
		</div>

		<form class="filters" onsubmit={submitSearch}>
			<label class="field">
				<span>{m.orgs_searchLabel()}</span>
				<!-- "Search" -->
				<input type="text" bind:value={search} placeholder={m.orgs_searchPlaceholder()} />
				<!-- "Name or city" -->
			</label>
			<label class="field">
				<span>{m.orgs_filterKind()}</span>
				<!-- "Kind" -->
				<select bind:value={kind} onchange={() => load()}>
					<option value="">{m.orgs_filterAnyKind()}</option>
					<!-- "Any kind" -->
					{#each KINDS as value (value)}
						<option {value}>{ORGANIZATION_KIND_LABELS[value]()}</option>
					{/each}
				</select>
			</label>
			<button type="submit">{m.orgs_searchLabel()}</button>
			<!-- "Search" -->
		</form>

		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if tab === 'mine' && !authStore.isAuthenticated}
			<p class="status">{m.orgs_signInForMine()}</p>
			<!-- "Sign in to see the organisations you are in." -->
		{:else if organizations.length === 0}
			<!-- There is no manual chapter on organisations yet (the manual's own "Not written yet"
			     list says so), so the link is to the one page that shows an organisation at work. -->
			<EmptyState
				name={tab === 'mine' ? 'organizations-mine' : 'organizations'}
				{filtered}
				onclear={clearFilters}
				message={tab === 'mine' ? m.empty_orgsMine() : m.empty_orgsAll()}
				action={{
					label: m.empty_orgsFound(),
					href: resolve('/organizations/new'),
					creation: 'organization'
				}}
				showcase="schools"
			/>
			<!-- "Organisations you belong to will be listed here. Someone who runs one can add you, or you can found your own." / "This is where faculties, schools and student circles show who they are and what they run. None is listed yet." / "Found an organisation" -->
		{:else}
			<ul class="orgs">
				{#each organizations as org (org.id)}
					<li>
						<a class="card" href={resolve('/organizations/[slug]', { slug: org.slug })}>
							<strong>
								{org.name}
								{#if !org.isActive}
									<span class="dissolved">{m.orgs_dissolvedBadge()}</span>
									<!-- "Dissolved" -->
								{/if}
							</strong>
							<span class="meta">
								{ORGANIZATION_KIND_LABELS[org.kind]?.() ?? org.kind}{org.city
									? ` · ${org.city}`
									: ''}
							</span>
							<span class="meta">
								<!-- Label first, number second, in both languages: "1 members" is wrong in
								     English and "1 powiązań" is wrong in Polish, and neither catalogue has
								     plural forms (the same "1 versions" the coop roster shipped with). -->
								{m.orgs_memberCountLabel()}
								{org.memberCount} · {m.orgs_linkCountLabel()}
								{org.linkCount}
								<!-- "Members:" / "Linked:" -->
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 820px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-4) var(--space-6);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: baseline;
		justify-content: space-between;
	}
	.intro,
	.status {
		color: var(--text-secondary);
	}
	// The two lead sentences, then air before the creation-gate note: without the bottom margin the
	// note's box sat flush against the last line of text.
	.lead {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: var(--space-1) 0 var(--space-3);
	}
	.lead .intro {
		margin: 0;
	}
	.tabs {
		display: flex;
		gap: 0.4rem;
		margin: var(--space-3) 0;
	}
	.tabs button {
		border: 1px solid var(--border-color);
		border-radius: 999px;
		background: transparent;
		padding: 0.25rem 0.8rem;
		color: inherit;
		cursor: pointer;
	}
	.tabs button.active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: flex-end;
		margin-bottom: var(--space-4);
	}
	.field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	.orgs {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.6rem;
	}
	.card {
		display: grid;
		gap: 0.15rem;
		border: 1px solid var(--border-color);
		border-radius: 10px;
		padding: 0.7rem 0.9rem;
		text-decoration: none;
		color: inherit;
	}
	.card:hover {
		border-color: var(--accent);
	}
	.meta {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.dissolved {
		font-size: 0.75rem;
		color: var(--text-secondary);
		font-weight: normal;
	}
	.new {
		font-size: 0.9rem;
	}
</style>
