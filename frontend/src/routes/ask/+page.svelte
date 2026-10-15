<script lang="ts">
	// "Ask a question" — the destination the homepage hero's "pytaj" never had (first-visitor audit
	// finding 16; the owner's decision of 2026-10-15: "ask as ppl should be allowed to post in
	// tags"). A question is a post anchored to a tag; this page is the composer framed as a
	// question, and once it is asked the reader lands on the tag's own page, where the answers go.
	//
	// `?tag=<slug>` preselects the tag (a link from a tag page or a chip). Not prerendered: it reads
	// the query and the session, and nothing here is first-paint material.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import type { Post } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import AskComposer from '$lib/components/activity/AskComposer.svelte';

	let presetTag = $derived(browser ? (page.url.searchParams.get('tag') ?? '') : '');
	// A question from a minor is held for a moderator (accounts/minors.py) — the server answers 201
	// with the post already hidden. Saying "published" then would be a lie; this says what happened.
	let heldIn = $state<string | null>(null);

	function handleCreated(post: Post) {
		if (post.isAutoHidden || !post.tagSlug) {
			heldIn = post.tagSlug ?? '';
			return;
		}
		// A tag is not always a clean slug ("całka z 1-formy"), and `resolve()` does not encode.
		goto(
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- built on resolve('/tags/[slug]'), one query parameter added
			`${resolve('/tags/[slug]', { slug: encodeURIComponent(post.tagSlug) })}?asked=${encodeURIComponent(post.id)}`
		);
	}
</script>

<PageHead title={m.ask_pageTitle()} description={m.ask_pageDescription()} />
<!-- "Ask a question" / "Ask a question in a tag — the people who follow it see it, and answers go underneath." -->

<FeatureGate feature="posts">
	<div class="page">
		<h1>{m.ask_pageTitle()}</h1>
		<!-- "Ask a question" -->
		<p class="subtitle">{m.ask_pageIntro()}</p>
		<!-- "Every question goes into a tag — a topic like #całki or #indukcja. People who follow the tag see it in their feed, and answers appear right under the question." -->

		{#if authStore.restoring}
			<p class="status">{m.common_loading()}</p>
		{:else if !authStore.isAuthenticated}
			<p class="login-prompt">
				<a href={resolve('/login')}>{m.ask_loginToAsk()}</a>
				<!-- "Sign in to ask a question" -->
			</p>
		{:else if heldIn !== null}
			<div class="held" role="status">
				<p>{m.ask_held()}</p>
				<!-- "Thanks! Your question waits for a moderator to look at it first, and appears under the tag once they have." -->
				{#if heldIn}
					<a href={resolve('/tags/[slug]', { slug: encodeURIComponent(heldIn) })}
						>{m.ask_goToTag({ tag: heldIn })}</a
					>
					<!-- "Go to #{tag}" -->
				{/if}
			</div>
		{:else}
			<AskComposer tag={presetTag} onCreated={handleCreated} />
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
	h1 {
		font-size: var(--font-size-xl);
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		max-width: 40rem;
	}
	.status {
		color: var(--text-secondary);
	}
	.login-prompt a {
		@include mix.button-primary;
		display: inline-block;
		text-decoration: none;
	}
	.held {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--status-info-bg);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
</style>
