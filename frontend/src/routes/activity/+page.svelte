<script lang="ts">
	// The full activity feed (root CLAUDE.md §17AI): composer on top (signed in + the `posts`
	// flag), an All/Followed toggle, kind + discipline filters, burst grouping, and an id-cursor
	// "load more". Filters live in the URL (?kind=&discipline=&branch=&tag=&view=) so a filtered
	// feed is shareable and the anchor chips on posts have somewhere real to link — the same
	// tab-in-the-URL reasoning the homepage already follows.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import type { FeedItem, FeedKind, FixedAnchor, Discipline, Post } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getActivityFeed } from '$lib/services/activity';
	import { getDisciplines } from '$lib/services/taxonomy';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import ActivityRow from '$lib/components/activity/ActivityRow.svelte';
	import PostComposer from '$lib/components/activity/PostComposer.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	const PAGE_SIZE = 20;

	let items = $state<FeedItem[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let failed = $state(false);
	let hasMore = $state(false);
	let disciplines = $state<Discipline[]>([]);
	let composerNotice = $state(false);

	// Derived from the URL on every render, not latched at mount — the same reasoning the
	// homepage's own ?tab= handling documents (flags/auth resolve asynchronously).
	let view = $derived.by((): 'all' | 'followed' => {
		if (!browser) return 'all';
		return page.url.searchParams.get('view') === 'followed' && authStore.isAuthenticated
			? 'followed'
			: 'all';
	});
	let kindFilter = $derived(browser ? (page.url.searchParams.get('kind') ?? '') : '');
	let disciplineFilter = $derived(browser ? (page.url.searchParams.get('discipline') ?? '') : '');
	let branchFilter = $derived(browser ? (page.url.searchParams.get('branch') ?? '') : '');
	let tagFilter = $derived(browser ? (page.url.searchParams.get('tag') ?? '') : '');
	let topicFilter = $derived(browser ? (page.url.searchParams.get('topic') ?? '') : '');
	// A human name for the anchor filter, carried in the URL by whatever linked here (an anchor
	// chip, a claim popover) — display only; the id params are what actually filter.
	let anchorLabelParam = $derived(browser ? (page.url.searchParams.get('label') ?? '') : '');

	/** The single anchor this page is filtered to, if any — what the composer posts into. */
	let fixedAnchor = $derived.by((): FixedAnchor | null => {
		if (topicFilter)
			return {
				kind: 'topic',
				id: topicFilter,
				label: anchorLabelParam || m.activity_topicFallback()
			};
		if (tagFilter) return { kind: 'tag', id: tagFilter, label: `#${tagFilter}` };
		if (branchFilter)
			return { kind: 'branch', id: branchFilter, label: anchorLabelParam || branchFilter };
		if (disciplineFilter)
			return {
				kind: 'discipline',
				id: disciplineFilter,
				label: anchorLabelParam || disciplineFilter
			};
		return null;
	});

	function setParam(key: string, value: string) {
		const url = new URL(page.url);
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, one query parameter changed
		goto(url, { keepFocus: true, noScroll: true });
	}

	async function load(append = false) {
		if (append) loadingMore = true;
		else loading = true;
		failed = false;
		try {
			const fetched = await getActivityFeed({
				kind: (kindFilter || undefined) as FeedKind | undefined,
				disciplineId: disciplineFilter || undefined,
				branchId: branchFilter || undefined,
				tagSlug: tagFilter || undefined,
				topicId: topicFilter || undefined,
				followed: view === 'followed',
				beforeId: append && items.length > 0 ? items[items.length - 1].id : undefined,
				limit: PAGE_SIZE
			});
			items = append ? [...items, ...fetched] : fetched;
			hasMore = fetched.length === PAGE_SIZE;
		} catch {
			failed = true;
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	// Refetch whenever a URL-borne filter changes. `untrack` around the load-state writes, the
	// homepage's own documented pattern for exactly this effect shape.
	$effect(() => {
		void view;
		void kindFilter;
		void disciplineFilter;
		void branchFilter;
		void tagFilter;
		void topicFilter;
		untrack(() => {
			load();
		});
	});

	$effect(() => {
		if (disciplines.length === 0) {
			untrack(() => {
				getDisciplines()
					.then((d) => (disciplines = d))
					.catch(() => {});
			});
		}
	});

	function handlePostCreated(_post: Post) {
		composerNotice = true;
		load();
	}

	/** Burst grouping, per fetched window: a run of ≥3 consecutive rows by the same actor and kind
	 * collapses into one expandable row ("Ania added 12 solutions"). Grouping only WITHIN what is
	 * loaded — a burst cut by a page boundary shows as two, an accepted edge of cursor paging. */
	type FeedBlock = { single: FeedItem } | { burst: FeedItem[] };
	let expanded = $state<Record<string, boolean>>({});
	let blocks = $derived.by((): FeedBlock[] => {
		const out: FeedBlock[] = [];
		let run: FeedItem[] = [];
		const flush = () => {
			if (run.length >= 3) out.push({ burst: run });
			else run.forEach((item) => out.push({ single: item }));
			run = [];
		};
		for (const item of items) {
			const previous = run[run.length - 1];
			if (
				previous &&
				previous.kind === item.kind &&
				previous.actorId === item.actorId &&
				item.kind !== 'post'
			) {
				run.push(item);
			} else {
				flush();
				run = [item];
			}
		}
		flush();
		return out;
	});

	function burstLabel(burst: FeedItem[]): string {
		const first = burst[0];
		const name = first.actorDisplayName || m.notification_someone(); // "Someone"
		return m.activity_burst({ name, count: burst.length }); // "{name} — {count} similar actions"
	}
</script>

<PageHead title={m.activity_pageTitle()} description={m.activity_pageDescription()} />

<div class="page">
	<h1>{m.activity_pageTitle()}</h1>
	<p class="subtitle">{m.activity_pageSubtitle()}</p>

	{#if authStore.isAuthenticated && featureFlagsStore.isEnabled('posts')}
		{#if composerNotice}
			<p class="notice">{m.post_published()}</p>
		{/if}
		<PostComposer onCreated={handlePostCreated} {fixedAnchor} />
	{/if}

	<div class="controls">
		{#if authStore.isAuthenticated}
			<div class="view-toggle" role="group" aria-label={m.activity_viewLabel()}>
				<button type="button" class:active={view === 'all'} onclick={() => setParam('view', '')}
					>{m.activity_viewAll()}</button
				>
				<button
					type="button"
					class:active={view === 'followed'}
					onclick={() => setParam('view', 'followed')}>{m.activity_viewFollowed()}</button
				>
			</div>
		{/if}
		<label class="filter">
			<span>{m.activity_filterKind()}</span>
			<select value={kindFilter} onchange={(e) => setParam('kind', e.currentTarget.value)}>
				<option value="">{m.activity_filterAllKinds()}</option>
				<option value="exercise">{m.activity_kind_exercise()}</option>
				<option value="material">{m.activity_kind_material()}</option>
				<option value="solution_entry">{m.activity_kind_solution()}</option>
				<option value="translation">{m.activity_kind_translation()}</option>
				<option value="course">{m.activity_kind_course()}</option>
				<option value="event">{m.activity_kind_event()}</option>
				<option value="service">{m.activity_kind_service()}</option>
				{#if featureFlagsStore.isEnabled('posts')}
					<option value="post">{m.activity_kind_post()}</option>
				{/if}
				<option value="review">{m.activity_kind_review()}</option>
				<option value="claim">{m.activity_kind_claim()}</option>
				<option value="comment">{m.activity_kind_comment()}</option>
			</select>
		</label>
		<label class="filter">
			<span>{m.activity_filterDiscipline()}</span>
			<select
				value={disciplineFilter}
				onchange={(e) => setParam('discipline', e.currentTarget.value)}
			>
				<option value="">{m.activity_filterAllDisciplines()}</option>
				{#each disciplines as discipline (discipline.id)}
					<option value={discipline.id}>{discipline.name}</option>
				{/each}
			</select>
		</label>
		{#if branchFilter || tagFilter}
			<button
				type="button"
				class="clear"
				onclick={() => {
					setParam('branch', '');
					setParam('tag', '');
				}}>{m.activity_clearAnchor({ anchor: tagFilter ? `#${tagFilter}` : branchFilter })}</button
			>
		{/if}
	</div>

	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if failed}
		<p class="status">{m.common_error_generic()}</p>
	{:else if items.length === 0}
		<p class="status">
			{view === 'followed' ? m.activity_emptyFollowed() : m.home_noResults()}
		</p>
	{:else}
		<div class="feed">
			{#each blocks as block, index (index)}
				{#if 'single' in block}
					<ActivityRow item={block.single} />
				{:else if expanded[block.burst[0].id]}
					{#each block.burst as item (item.id)}
						<ActivityRow {item} />
					{/each}
				{:else}
					<button
						type="button"
						class="burst"
						onclick={() => (expanded = { ...expanded, [block.burst[0].id]: true })}
					>
						{burstLabel(block.burst)}
					</button>
				{/if}
			{/each}
		</div>
		{#if hasMore}
			<button type="button" class="load-more" disabled={loadingMore} onclick={() => load(true)}
				>{loadingMore ? m.common_loading() : m.activity_loadMore()}</button
			>
		{/if}
	{/if}

	<p class="back"><a href={resolve('/')}>{m.common_home()}</a></p>
</div>

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
	h1 {
		font-size: var(--font-size-xl);
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.view-toggle {
		display: inline-flex;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		overflow: hidden;
		button {
			background: var(--bg-surface);
			border: none;
			padding: var(--space-1) var(--space-3);
			font-size: var(--font-size-xs);
			font-weight: 600;
			color: var(--text-secondary);
			cursor: pointer;
		}
		button.active {
			background: var(--accent);
			color: var(--bg-surface);
		}
	}
	.filter {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-weight: 600;
		select {
			font: inherit;
			padding: var(--space-1);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.clear {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
	}
	.feed {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.burst {
		text-align: left;
		background: var(--bg-surface-alt);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.load-more {
		@include mix.button-secondary;
		align-self: center;
		font-size: var(--font-size-sm);
	}
	.status {
		color: var(--text-secondary);
	}
	.back a {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
</style>
