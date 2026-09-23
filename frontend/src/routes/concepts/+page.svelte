<script lang="ts">
	/**
	 * The concepts hub: everything the site has a page about, filterable.
	 *
	 * The URL is the single source of truth for what is being asked — `?q=`, `?letter=`,
	 * `?branch=`, `?tag=`, `?sort=` — so a filtered view is a link somebody can send. The list is
	 * read inside an `$effect` keyed on that query string, which is also what keeps this page
	 * prerenderable: an effect never runs on the server, where there is no query string to read and
	 * no origin to fetch from (`+page.ts` says the same thing from the other side).
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import HiddenLanguagesNotice from '$lib/components/shared/HiddenLanguagesNotice.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ConceptCard from '$lib/components/concept/ConceptCard.svelte';
	import { CONCEPTS_FLAG } from '$lib/components/concept/labels';
	import { getConcepts } from '$lib/services/concepts';
	import { getAllTags } from '$lib/services/exercises';
	import { getAllBranches } from '$lib/services/taxonomy';
	import { authStore } from '$lib/state/auth.svelte';
	import type { Branch } from '$lib/types';
	import type { ConceptListRow } from '$lib/types/concept';

	const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

	let concepts = $state<ConceptListRow[]>([]);
	let branches = $state<Branch[]>([]);
	let tags = $state<string[]>([]);
	let loading = $state(true);
	let failed = $state(false);

	// What the URL currently says. Read inside effects only — never at component top level, which
	// is also where prerendering would run it (frontend/CLAUDE.md trap 5 and the prerender rule).
	let query = $state('');
	let letter = $state('');
	let branchId = $state('');
	let tag = $state('');
	let sort = $state<'title' | 'updated'>('updated');

	/** The lists behind the two selects. Fetched once, and never blocking the concepts themselves. */
	let optionsLoaded = $state(false);
	$effect(() => {
		if (optionsLoaded) return;
		optionsLoaded = true;
		getAllBranches()
			.then((found) => (branches = found))
			.catch(() => (branches = []));
		getAllTags()
			.then((found) => (tags = found))
			.catch(() => (tags = []));
	});

	// Keyed on the whole query string AND the session: a signed-in moderator sees rows a stranger
	// does not, and a hard reload resolves the session after the first paint (trap 3).
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const search = page.url.search;
		const key = `${search}|${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		const params = new URLSearchParams(search);
		query = params.get('q') ?? '';
		letter = params.get('letter') ?? '';
		branchId = params.get('branch') ?? '';
		tag = params.get('tag') ?? '';
		sort = params.get('sort') === 'title' ? 'title' : 'updated';
		void load();
	});

	async function load() {
		loading = true;
		failed = false;
		try {
			concepts = await getConcepts({
				query: query || undefined,
				letter: letter || undefined,
				branchId: branchId || undefined,
				tag: tag || undefined,
				sort
			});
		} catch {
			concepts = [];
			failed = true;
		} finally {
			loading = false;
		}
	}

	/** Every filter change rewrites the URL rather than the list: one source of truth, and a
	 *  filtered view stays a link. `replaceState` so the back button leaves the hub in one press. */
	function apply(patch: Record<string, string>) {
		// Built by CONSTRUCTION rather than by mutating a `URLSearchParams` — a mutable instance of
		// a built-in class is `svelte/prefer-svelte-reactivity`'s own refusal, and there is nothing
		// here that wants to be reactive anyway: this object exists for one line.
		const merged = { ...Object.fromEntries(new URLSearchParams(page.url.search)), ...patch };
		const search = new URLSearchParams(
			Object.entries(merged).filter(([, value]) => value !== '')
		).toString();
		const options = { replaceState: true, keepFocus: true, noScroll: true };
		// The route IS resolved; `no-navigation-without-resolve` cannot see through the query
		// string appended to it (the `/courses/[id]/manage` precedent, which says the same).
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		if (search) void goto(`${resolve('/concepts')}?${search}`, options);
		else void goto(resolve('/concepts'), options);
	}

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => apply({ q: value }), 350);
	}
</script>

<!-- "Concepts"; the description is "Community-written pages about the ideas exercises and
     materials are about — one for each kind of reader." -->
<PageHead title={m.concept_hub_heading()} description={m.concept_seo_hub()} />

<FeatureGate feature={CONCEPTS_FLAG}>
	<div class="page">
		<header>
			<h1>{m.concept_hub_heading()}</h1>
			<!-- "Concepts" -->
			<p>{m.concept_hub_subtitle()}</p>
			<!-- "Pages about the ideas behind the exercises — written for different readers." -->
			<HiddenLanguagesNotice path="/concepts/" />
			{#if authStore.isAuthenticated}
				<a class="new" href={resolve('/concepts/new')}>{m.concept_hub_new()}</a>
				<!-- "Start a concept" -->
			{/if}
		</header>

		<div class="filters">
			<label class="field">
				<span>{m.common_search()}</span>
				<!-- "Search" -->
				<input
					type="text"
					value={query}
					oninput={onSearchInput}
					placeholder={m.concept_hub_searchPlaceholder()}
				/>
			</label>

			<label class="field">
				<span>{m.concept_hub_branch()}</span>
				<!-- "Subject" -->
				<select value={branchId} onchange={(e) => apply({ branch: e.currentTarget.value })}>
					<option value="">{m.concept_hub_anyBranch()}</option>
					<!-- "Any subject" -->
					{#each branches as branch (branch.id)}
						<option value={branch.id}>{branch.name}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>{m.concept_hub_tag()}</span>
				<!-- "Tag" -->
				<select value={tag} onchange={(e) => apply({ tag: e.currentTarget.value })}>
					<option value="">{m.concept_hub_anyTag()}</option>
					<!-- "Any tag" -->
					{#each tags as option (option)}
						<option value={option}>{option}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>{m.concept_hub_sort()}</span>
				<!-- "Order" -->
				<select value={sort} onchange={(e) => apply({ sort: e.currentTarget.value })}>
					<option value="updated">{m.concept_hub_sortUpdated()}</option>
					<!-- "Recently changed" -->
					<option value="title">{m.concept_hub_sortTitle()}</option>
					<!-- "By title" -->
				</select>
			</label>
		</div>

		<nav class="letters" aria-label={m.concept_hub_letters()}>
			<!-- "Jump to a letter" -->
			<button type="button" class:on={!letter} onclick={() => apply({ letter: '' })}>
				{m.concept_hub_allLetters()}
				<!-- "All" -->
			</button>
			{#each LETTERS as option (option)}
				<button type="button" class:on={letter === option} onclick={() => apply({ letter: option })}
					>{option.toUpperCase()}</button
				>
			{/each}
		</nav>

		{#if loading}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if failed}
			<p class="hint">{m.common_error_generic()}</p>
			<!-- "Something went wrong." -->
		{:else if concepts.length === 0}
			<p class="hint">{m.concept_hub_empty()}</p>
			<!-- "Nothing here yet." -->
		{:else}
			<div class="grid">
				{#each concepts as concept (concept.id)}
					<!-- `h2`: on this page the cards follow the `h1` with no section heading between
					     them (axe `heading-order`). -->
					<ConceptCard {concept} headingLevel={2} />
				{/each}
			</div>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		h1 {
			margin: 0;
		}
		p {
			margin: 0;
			color: var(--text-secondary);
		}
	}
	.new {
		align-self: flex-start;
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
	.filters {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		align-items: flex-end;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);

		input,
		select {
			@include mix.focus-ring;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.letters {
		display: flex;
		gap: 2px;
		flex-wrap: wrap;

		button {
			@include mix.focus-ring;
			min-width: 32px;
			min-height: 32px;
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			font: inherit;
			font-size: var(--font-size-xs);
			cursor: pointer;
		}
		button.on {
			border-color: var(--accent);
			color: var(--accent);
			font-weight: 600;
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-3);
	}
	.hint {
		margin: 0;
		color: var(--text-secondary);
	}
</style>
