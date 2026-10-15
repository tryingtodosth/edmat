<script lang="ts">
	// One tag's page: the questions and posts asked in it, newest first, each with its answers
	// underneath (WP15, 2026-10-15 — "ask as ppl should be allowed to post in tags"). Before this a
	// tag had no page of its own; its chip opened the activity feed filtered to it, which mixes in
	// every exercise event carrying the tag and forgets anything older than the feed's 90 days. This
	// lists the Post table itself (`GET /api/posts/?tag=`), so a question stays on its tag.
	//
	// The whole page lives behind the `posts` switch: what it lists IS posts, and a killed feature's
	// page goes with its links (house rule 3). The tag-filtered feed is still linked from here for
	// everything else that happened under the tag.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { Post } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { getPostsForTag } from '$lib/services/activity';
	import { getTagBySlug } from '$lib/services/tags';
	import { authStore } from '$lib/state/auth.svelte';
	import { tagFollowStore } from '$lib/state/tagFollows.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import HiddenLanguagesNotice from '$lib/components/shared/HiddenLanguagesNotice.svelte';
	import PostCard from '$lib/components/activity/PostCard.svelte';
	import AskComposer from '$lib/components/activity/AskComposer.svelte';

	const PAGE_SIZE = 20;

	let slug = $derived(page.params.slug ?? '');
	let posts = $state<Post[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let failed = $state(false);
	let notFound = $state(false);
	let hasMore = $state(false);
	let asking = $state(false);
	let notice = $state<'asked' | 'held' | 'created' | 'reused' | null>(null);

	// `?asked=<id>` is set by /ask after a question lands here — say so once.
	let askedParam = $derived(browser ? page.url.searchParams.get('asked') : null);
	// `&tagged=new|existing` rides along when the question named its tag by typing it (WP16).
	let taggedParam = $derived(browser ? page.url.searchParams.get('tagged') : null);

	async function load(tag: string, append = false) {
		if (append) loadingMore = true;
		else loading = true;
		failed = false;
		try {
			if (!append) {
				// The tag itself first: a removed or never-existing tag is "no such tag", not an
				// empty list that invites somebody to ask into nothing.
				await getTagBySlug(tag);
			}
			const fetched = await getPostsForTag(tag, {
				beforeId: append && posts.length > 0 ? posts[posts.length - 1].id : undefined,
				limit: PAGE_SIZE
			});
			posts = append ? [...posts, ...fetched] : fetched;
			hasMore = fetched.length === PAGE_SIZE;
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) notFound = true;
			else failed = true;
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	// Trap 2 in frontend/CLAUDE.md: a dynamic route's load needs an id-changed guard.
	let loadedFor = $state<string | undefined>(undefined);
	// And no request while the switch is off: `FeatureGate` hides the page, but this script still
	// runs underneath it, and a 403 nobody reads is still a 403 in the console. The flags fail OPEN
	// before they load, so wait for them rather than fire a request the API will refuse.
	let allowed = $derived(
		featureFlagsStore.isLoaded && (featureFlagsStore.isEnabled('posts') || authStore.isModerator)
	);
	$effect(() => {
		const tag = slug;
		if (!allowed || !tag || tag === loadedFor) return;
		loadedFor = tag;
		notFound = false;
		asking = false;
		notice = !askedParam
			? null
			: taggedParam === 'new'
				? 'created'
				: taggedParam === 'existing'
					? 'reused'
					: 'asked';
		load(tag);
	});

	$effect(() => {
		if (authStore.isAuthenticated) tagFollowStore.ensureLoaded();
	});

	function handleCreated(post: Post) {
		asking = false;
		if (post.isAutoHidden) {
			notice = 'held';
			return;
		}
		if (post.tagSlug && post.tagSlug !== slug) {
			// The reader changed the tag in the composer (or named a new one): the question lives
			// on THAT tag's page, so go there rather than draw it in this tag's list.
			const tagged =
				post.tagCreated === undefined ? '' : `&tagged=${post.tagCreated ? 'new' : 'existing'}`;
			goto(
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- built on resolve('/tags/[slug]'), query parameters added
				`${resolve('/tags/[slug]', { slug: encodeURIComponent(post.tagSlug) })}?asked=${encodeURIComponent(post.id)}${tagged}`
			);
			return;
		}
		notice = 'asked';
		posts = [post, ...posts];
	}

	let following = $derived(authStore.isAuthenticated && tagFollowStore.isFollowing(slug));
	async function toggleFollow() {
		if (following) await tagFollowStore.unfollow(slug);
		else await tagFollowStore.follow(slug);
	}
</script>

<PageHead title={`#${slug}`} description={m.ask_tagPageDescription({ tag: slug })} />
<!-- "Questions and posts in #{tag} on EdMat, with their answers." -->

<FeatureGate feature="posts">
	<div class="page">
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/')}>{m.common_home()}</a> ›
			<a href={resolve('/activity')}>{m.activity_pageTitle()}</a>
		</nav>

		<header class="head">
			<h1>#{slug}</h1>
			{#if !notFound}
				<p class="subtitle">{m.ask_tagPageIntro()}</p>
				<!-- "Questions and posts in this tag. Ask yours — the people who follow the tag will see it." -->
				<div class="head__actions">
					{#if authStore.isAuthenticated}
						{#if !asking}
							<button type="button" class="primary" onclick={() => (asking = true)}
								>{m.ask_inThisTag()}</button
							>
							<!-- "Ask a question in this tag" -->
						{/if}
						<button type="button" class="secondary" aria-pressed={following} onclick={toggleFollow}
							>{following ? m.tag_unfollow() : m.tag_follow()}</button
						>
					{:else}
						<a class="primary" href={resolve('/login')}>{m.ask_loginToAsk()}</a>
						<!-- "Sign in to ask a question" -->
					{/if}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built on resolve('/activity'), query parameters only -->
					<a class="more" href={`${resolve('/activity')}?tag=${encodeURIComponent(slug)}`}
						>{m.ask_allActivity()}</a
					>
					<!-- "All activity with this tag" -->
				</div>
			{/if}
		</header>

		{#if notice === 'asked'}
			<p class="notice" role="status">{m.ask_asked()}</p>
			<!-- "Your question is up. You will get a notification when somebody answers." -->
		{:else if notice === 'created'}
			<p class="notice" role="status">{m.tagnew_createdNotice({ tag: slug })}</p>
			<!-- "Tag #{tag} is created and your question is up in it." -->
		{:else if notice === 'reused'}
			<p class="notice" role="status">{m.tagnew_reusedNotice({ tag: slug })}</p>
			<!-- "A tag like that already existed, so your question went into #{tag}." -->
		{:else if notice === 'held'}
			<p class="notice notice--held" role="status">{m.ask_held()}</p>
		{/if}

		{#if asking}
			<AskComposer tag={slug} onCreated={handleCreated} />
			<button type="button" class="cancel" onclick={() => (asking = false)}
				>{m.common_cancel()}</button
			>
		{/if}

		{#if notFound}
			<p class="status">{m.ask_tagNotFound()}</p>
			<!-- "There is no such tag — it may have been removed." -->
		{:else}
			<h2 class="list-heading">{m.ask_questionsHeading()}</h2>
			<!-- "Questions in this tag" -->
			<HiddenLanguagesNotice path="/posts/" />
			{#if loading}
				<p class="status">{m.common_loading()}</p>
			{:else if failed}
				<p class="status">{m.common_error_generic()}</p>
			{:else if posts.length === 0}
				<EmptyState
					name="tag-questions"
					message={m.ask_tagEmpty()}
					action={asking
						? undefined
						: { label: m.ask_inThisTag(), onclick: () => (asking = true), signedIn: true }}
				/>
				<!-- "Nobody has asked anything in this tag yet. A question asked here reaches everyone who follows it." -->
			{:else}
				<div class="list">
					{#each posts as post (post.id)}
						<PostCard {post} />
					{/each}
				</div>
				{#if hasMore}
					<button
						type="button"
						class="secondary load-more"
						disabled={loadingMore}
						onclick={() => load(slug, true)}
						>{loadingMore ? m.common_loading() : m.activity_loadMore()}</button
					>
				{/if}
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		h1 {
			font-size: var(--font-size-xl);
			overflow-wrap: anywhere;
		}
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		max-width: 40rem;
	}
	.head__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.primary {
		@include mix.button-primary;
		text-decoration: none;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.more {
		color: var(--accent);
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.cancel {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.notice--held {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
		white-space: normal;
	}
	.list-heading {
		font-size: var(--font-size-lg);
		margin-top: var(--space-2);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.load-more {
		align-self: center;
	}
	.status {
		color: var(--text-secondary);
	}
</style>
