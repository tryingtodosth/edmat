<script lang="ts">
	/**
	 * The contests hub (CONTESTS-BRIEF.md §3.A item 1). Replaces the prep's placeholder whole.
	 *
	 * Four tabs, and they are four different questions rather than four filters on one: "all" is
	 * the board, "mine" is what I founded or help run, "I am judging" is a queue of work, and
	 * "I am taking part" is what I owe. The server answers `?mine=1` for the union of the last
	 * three and the split happens here, from `myRole` and `isMember`, because they are on every
	 * card already — a second round trip per tab would buy nothing.
	 *
	 * `?tab=` lives in the URL (the shared `Tabs` component), so a reload keeps your place and a
	 * link to "I am judging" can be sent to somebody.
	 *
	 * The "New contest" button obeys BOTH switches: the `contests` flag (house rule 3 — a killed
	 * feature takes its buttons with it) and the creation gate, whose refusal sentence
	 * `CreationGateNote` draws in its place rather than leaving a puzzle.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { creationStore } from '$lib/state/creation.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import CreationGateNote from '$lib/components/shared/CreationGateNote.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Tabs from '$lib/components/shared/Tabs.svelte';
	import ContestCard from '$lib/components/contest/ContestCard.svelte';
	import { getContests } from '$lib/services/contests';
	import { CONTEST_STATUS_FLOW } from '$lib/types/contest';
	import { contestStatusLabel, presetName } from '$lib/utils/labels';
	import type { Contest, ContestStatus } from '$lib/types/contest';

	const TAB_IDS = ['all', 'mine', 'judging', 'entering'] as const;
	type TabId = (typeof TAB_IDS)[number];

	let all = $state<Contest[]>([]);
	let mine = $state<Contest[]>([]);
	let loading = $state(true);
	let failed = $state(false);
	let loadedFor = $state('');

	let status = $state<ContestStatus | ''>('');
	let preset = $state('');
	let query = $state('');
	// The DEBOUNCED copy, and the only one the load key reads. Without the split the `$effect`
	// below fires on every keystroke (its key contains the query) and the debounce buys nothing —
	// the timer would be racing a reload that had already started.
	let appliedQuery = $state('');

	const activeTab = $derived.by<TabId>(() => {
		const wanted = page.url.searchParams.get('tab');
		// `?mine=1` is the address the header's account menu uses — it is a tab, not a filter.
		if (!wanted && page.url.searchParams.get('mine') === '1') return 'mine';
		return (TAB_IDS as readonly string[]).includes(wanted ?? '') ? (wanted as TabId) : 'all';
	});

	// `allows()` is TRUE for a signed-out reader by design (creation.svelte.ts: the `…/new` page
	// answers them with a sign-in prompt), so the header button must ask about the session itself,
	// as /events and /organizations do. Without this a signed-out reader saw "New contest" in the
	// header while the empty state below it, which asks the session, offered a sign-in link —
	// found by the empty-states pass. Signed out, the header shows nothing; the empty state (or
	// the header's own Log in) is the door to an account.
	const canCreate = $derived(authStore.isAuthenticated && creationStore.allows('contest'));

	// Keyed on the filters AND on who is asking: a session resolving later changes what `mine`
	// can answer at all (frontend/CLAUDE.md trap 3 — `onMount` reads the flag exactly once).
	$effect(() => {
		const key = `${status}|${preset}|${appliedQuery}|${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load();
	});

	async function load() {
		loading = true;
		failed = false;
		const filters = {
			...(status ? { status: [status] } : {}),
			...(preset ? { preset: [preset] } : {}),
			...(appliedQuery ? { q: appliedQuery } : {})
		};
		try {
			all = await getContests(filters);
			mine = authStore.isAuthenticated ? await getContests({ ...filters, mine: true }) : [];
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	const judging = $derived(mine.filter((c) => c.canScore && !c.canManage));
	const entering = $derived(mine.filter((c) => !c.myRole && c.isMember));
	const organising = $derived(mine.filter((c) => c.myRole));

	const shown = $derived.by(() => {
		switch (activeTab) {
			case 'mine':
				return organising;
			case 'judging':
				return judging;
			case 'entering':
				return entering;
			default:
				return all;
		}
	});

	const tabs = $derived([
		{ id: 'all', label: m.contests_tabAll(), badge: all.length }, // "All"
		...(authStore.isAuthenticated
			? [
					{ id: 'mine', label: m.contests_tabMine(), badge: organising.length }, // "I run these"
					{ id: 'judging', label: m.contests_tabJudging(), badge: judging.length }, // "I am judging"
					{ id: 'entering', label: m.contests_tabEntering(), badge: entering.length } // "I am taking part"
				]
			: [])
	]);

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			appliedQuery = query.trim();
		}, 300);
	}

	// "Nothing matches" rather than "nothing exists" while any filter narrows the list — the empty
	// state then offers to clear them instead of to announce a contest.
	const filtered = $derived(Boolean(status || preset || appliedQuery));
	function clearFilters() {
		clearTimeout(searchTimer);
		status = '';
		preset = '';
		query = '';
		appliedQuery = '';
	}

	const PRESET_KEYS = [
		'challenge',
		'school',
		'staged',
		'university',
		'student_circle',
		'organization',
		'open_online',
		'team',
		'kuratorium',
		'olympiad'
	];

	onMount(() => {
		void creationStore.ensureLoaded(authStore.user?.id ?? null);
	});
</script>

<PageHead title={m.contests_title()} description={m.contests_hubDescription()} />
<!-- "Contests" / "Staged competitions with a jury, published results and the obligations a prize brings — run by the people who organise them, hosted here." -->

<FeatureGate feature="contests">
	<div class="page">
		<header class="head">
			<div>
				<h1>{m.contests_title()}</h1>
				<p class="lede">{m.contests_hubLede()}</p>
				<!-- "A contest here is somebody else's: they promise the prize, they judge, they answer complaints. EdMat hosts the announcement, the entries and the scoring, and nothing more." -->
			</div>
			{#if canCreate}
				<a class="primary" href={resolve('/contests/new')}>{m.contests_newContest()}</a>
				<!-- "New contest" -->
			{/if}
		</header>

		<CreationGateNote kind="contest" />

		<form class="filters" onsubmit={(event) => event.preventDefault()}>
			<label>
				<span>{m.contests_filterSearch()}</span>
				<!-- "Search" -->
				<input type="text" bind:value={query} oninput={onSearchInput} />
			</label>
			<label>
				<span>{m.contests_filterStatus()}</span>
				<!-- "Status" -->
				<select bind:value={status}>
					<option value="">{m.contests_filterAny()}</option>
					<!-- "Any" -->
					{#each CONTEST_STATUS_FLOW as value (value)}
						<option {value}>{contestStatusLabel(value)()}</option>
					{/each}
					<option value="cancelled">{contestStatusLabel('cancelled')()}</option>
				</select>
			</label>
			<label>
				<span>{m.contests_filterPreset()}</span>
				<!-- "Kind" -->
				<select bind:value={preset}>
					<option value="">{m.contests_filterAny()}</option>
					{#each PRESET_KEYS as value (value)}
						<option {value}>{presetName(value)()}</option>
					{/each}
				</select>
			</label>
		</form>

		<Tabs {tabs} active={activeTab} defaultTab="all" ariaLabel={m.contests_tabsLabel()} />
		<!-- "Which contests to show" -->

		<div id="tabpanel-{activeTab}" role="tabpanel" aria-labelledby="tab-{activeTab}">
			{#if loading}
				<p class="muted">{m.common_loading()}</p>
			{:else if failed}
				<p class="error" role="alert">{m.common_error()}</p>
			{:else if shown.length === 0}
				{#if activeTab === 'all'}
					<EmptyState
						name="contests"
						{filtered}
						onclear={clearFilters}
						message={m.empty_contestsAll()}
						action={{
							label: m.empty_contestsAnnounce(),
							href: resolve('/contests/new'),
							creation: 'contest',
							flag: 'contests'
						}}
						guide="contests"
					/>
					<!-- "Contests people run here have stages, a jury and published results. None has been announced yet." / "Announce a contest" -->
				{:else if activeTab === 'mine'}
					<EmptyState
						name="contests-mine"
						{filtered}
						onclear={clearFilters}
						message={m.empty_contestsMine()}
						action={{
							label: m.empty_contestsAnnounce(),
							href: resolve('/contests/new'),
							creation: 'contest',
							flag: 'contests'
						}}
						guide="contests"
					/>
					<!-- "Contests you organise or help run will be listed here." -->
				{:else if activeTab === 'judging'}
					<EmptyState
						name="contests-judging"
						{filtered}
						onclear={clearFilters}
						message={m.empty_contestsJudging()}
						guide="contests"
					/>
					<!-- "When an organiser puts you on a jury, the entries waiting for your marks will be here." -->
				{:else}
					<EmptyState
						name="contests-entering"
						{filtered}
						onclear={clearFilters}
						message={m.empty_contestsEntering()}
						action={{ label: m.empty_contestsBrowse(), href: resolve('/contests') }}
						guide="contests"
					/>
					<!-- "Contests you have signed up for will be listed here." / "Browse all contests" -->
				{/if}
			{:else}
				<ul class="cards">
					{#each shown as contest (contest.id)}
						<li><ContestCard {contest} /></li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 1000px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}
	h1 {
		margin: 0;
	}
	.lede {
		margin: 0.3rem 0 0;
		max-width: 60ch;
		color: var(--text-secondary);
	}
	a.primary {
		@include mix.button-primary;
		text-decoration: none;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
	}
	.filters label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.filters input,
	.filters select {
		padding: 0.35rem 0.45rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.8rem;
	}
	.muted {
		color: var(--text-secondary);
	}
	.error {
		color: var(--status-danger);
	}
</style>
