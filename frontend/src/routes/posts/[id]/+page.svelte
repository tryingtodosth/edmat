<script lang="ts">
	// One micro-post's own page — where a comment-reply notification lands, and what the feed's
	// permalink opens. Same id-changed idempotency guard every dynamic route here carries.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Post } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getPostById } from '$lib/services/activity';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PostCard from '$lib/components/activity/PostCard.svelte';

	let post = $state<Post | undefined>(undefined);
	let loading = $state(true);
	let notFound = $state(false);

	async function load(id: string) {
		loading = true;
		notFound = false;
		try {
			post = await getPostById(id);
			notFound = post === undefined;
		} catch {
			notFound = true;
		} finally {
			loading = false;
		}
	}

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		load(id);
	});
</script>

<svelte:head>
	<title>{m.post_pageTitle()} — {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="posts">
	<div class="page">
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/')}>{m.common_home()}</a> ›
			<a href={resolve('/activity')}>{m.activity_pageTitle()}</a>
		</nav>
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if notFound || !post}
			<p class="status">{m.post_notFound()}</p>
		{:else}
			<PostCard {post} linkTitle={false} expandThread={true} />
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	.status {
		color: var(--text-secondary);
	}
</style>
