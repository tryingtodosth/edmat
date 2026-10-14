<script lang="ts">
	// One goal and its definition of done (`backend/goals/`, owner 2026-10-08). The page a goal's
	// discussion key resolves to (`utils/discussionKeys.ts`: `goals/5` -> here), so a moderator
	// reading "Held: 2" next to a goal can see which goal that is, and the address a reader can
	// share for one goal rather than for a whole board.
	//
	// `GoalCard` does the work, exactly as it does inside `GoalsPanel` — the same affordances in
	// both places, which is why it is a component and not two copies. What this page adds is the
	// breadcrumb back to the node, and the single thread at the bottom (`PageDiscussion`, which
	// fetches the one policy itself: a panel batches because it has rows, a page has one).
	import { m } from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import type { Goal } from '$lib/types/goal';
	import { getGoal } from '$lib/services/goals';
	import { authStore } from '$lib/state/auth.svelte';
	import { ApiError } from '$lib/api/client';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import GoalCard from '$lib/components/goal/GoalCard.svelte';
	import PageDiscussion from '$lib/components/discussion/PageDiscussion.svelte';
	import { discussionKeyFor } from '$lib/utils/discussionKeys';
	import { nodeHref } from '$lib/utils/nodeHref';

	const id = $derived(page.params.id!);

	let goal = $state<Goal | null>(null);
	let loading = $state(true);
	let notFound = $state(false);

	// Keyed on the id AND on the session, with the guard frontend/CLAUDE.md trap 2 requires:
	// `canEdit`/`canTick` arrive with the row and change the moment a session resolves.
	let loadedFor = $state('');
	$effect(() => {
		const key = `${id}:${authStore.user?.id ?? 'anon'}`;
		if (!id || key === loadedFor) return;
		loadedFor = key;
		void load(key);
	});

	async function load(key: string) {
		loading = true;
		notFound = false;
		try {
			const found = await getGoal(id);
			if (loadedFor !== key) return;
			goal = found;
		} catch (err) {
			if (loadedFor !== key) return;
			// 404 is the honest answer for a goal on a node this reader cannot see (house rule 4),
			// and the page says the same thing for both cases rather than guessing which it was.
			notFound = !(err instanceof ApiError) || err.status === 404;
			goal = null;
		} finally {
			if (loadedFor === key) loading = false;
		}
	}
</script>

<PageHead title={goal?.title ?? m.goals_pageTitle()} description={m.goals_pageDescription()} />
<!-- "Goal" / "A goal and its definition of done." -->

<FeatureGate feature="goals">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if notFound || !goal}
			<p class="status">{m.goals_notFound()}</p>
			<!-- "This goal isn't here, or you can't see it." -->
		{:else}
			{#if goal.node}
				<p class="breadcrumb">
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- nodeHref() calls resolve() itself; the rule only sees this attribute -->
					<a href={nodeHref(goal.node)}>{goal.node.title}</a>
				</p>
			{/if}
			<GoalCard
				{goal}
				linkTitle={false}
				attachments="open"
				onChanged={(updated) => (goal = updated)}
			/>
			<PageDiscussion page={discussionKeyFor('goals', goal.id)} title={goal.title} />
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 760px;
		margin: 0 auto;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-3);
	}
	.breadcrumb {
		margin: 0;
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
