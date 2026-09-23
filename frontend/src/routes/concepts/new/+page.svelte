<script lang="ts">
	/**
	 * Starting a concept: the node, its first article and that article's first revision, in one
	 * request.
	 *
	 * Anybody signed in may start one. Whether it goes live at once or waits for a person is the
	 * server's decision (`can_autopublish`: staff, verified contributors, governors of one of the
	 * concept's branches — and never a minor), and the button label is only a best guess at it made
	 * from what this browser already knows. The sentence AFTER the save reads the real answer, so a
	 * wrong guess costs a label and never a lie.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ArticleEditor from '$lib/components/concept/ArticleEditor.svelte';
	import { CONCEPTS_FLAG } from '$lib/components/concept/labels';
	import { getAllBranches } from '$lib/services/taxonomy';
	import { authStore } from '$lib/state/auth.svelte';
	import type { Branch } from '$lib/types';

	let branches = $state<Branch[]>([]);

	// In `onMount`, not at component top level: this page is not prerendered, but the rule is the
	// same one — a service call at top level runs during SSR with no token (trap 5).
	onMount(async () => {
		branches = await getAllBranches().catch(() => []);
	});

	/** A guess, and labelled as one in the editor's own hint. The server decides. */
	const willPublish = $derived(
		Boolean(authStore.user?.isModerator || authStore.user?.isVerifiedContributor)
	);
</script>

<!-- "Start a concept"; the description is "Write the first article of a new concept page." -->
<PageHead title={m.concept_new_heading()} description={m.concept_seo_new()} />

<FeatureGate feature={CONCEPTS_FLAG}>
	<div class="page">
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/concepts')}>{m.concept_hub_heading()}</a>
			<!-- "Concepts" -->
		</nav>

		<h1>{m.concept_new_heading()}</h1>
		<!-- "Start a concept" -->

		{#if !authStore.isAuthenticated}
			<p class="hint">{m.concept_new_signIn()}</p>
			<!-- "Sign in to start a concept." -->
		{:else}
			<ArticleEditor
				mode="create"
				{branches}
				{willPublish}
				onsaved={(outcome) => {
					// A draft has no page to go to yet — it is private, and it lives in the
					// concept's own "your unfinished work" list once there is a concept to show it
					// on. Anything that was actually sent goes to the concept.
					if (outcome.status !== 'draft') {
						void goto(resolve('/concepts/[slug]', { slug: outcome.slug }));
					}
				}}
			/>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 820px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		h1 {
			margin: 0;
		}
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);

		a {
			color: var(--accent);
		}
	}
	.hint {
		margin: 0;
		color: var(--text-secondary);
	}
</style>
