<script lang="ts">
	// One task at full size. This route exists because `tasks/work.py` hands the work dashboard a
	// FRONTEND path for every row (`/tasks/12`, MANAGEMENT-BRIEF.md §3.F) — a dashboard link that
	// only worked if the reader could first find the right course page would not be a link.
	//
	// It is also the shareable form: a task lives on a node's board, and "the third one down in the
	// review column" is not something one person can send another.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import TaskCard from '$lib/components/task/TaskCard.svelte';
	import { RowDiscussions } from '$lib/components/discussion/rowDiscussions.svelte';
	import { discussionKeyFor } from '$lib/utils/discussionKeys';
	import { nodeHref } from '$lib/utils/nodeHref';
	import { getTask } from '$lib/services/tasks';
	import { pageTitle } from '$lib/utils/pageTitle';
	import type { Task } from '$lib/types/task';

	let task = $state<Task | null>(null);
	let loaded = $state(false);
	let missing = $state(false);
	let loadedFor = $state('');
	// The task's own thread, under the card — `tasks/<id>` to `community/discussions.py`.
	const rowDiscussions = new RowDiscussions();
	$effect(() =>
		rowDiscussions.load(
			task ? [discussionKeyFor('tasks', task.id)] : [],
			authStore.user?.id ?? 'anon'
		)
	);

	// A killed feature stops asking, and `isLoaded` comes first because `isEnabled` fails open until
	// the flags land — the sibling `/tasks` page records what the missing guard actually looked like.
	const enabled = $derived(
		featureFlagsStore.isLoaded && (featureFlagsStore.isEnabled('tasks') || authStore.isModerator)
	);

	// Keyed on the id AND the reader: `$effect(() => load(page.params.id))` re-fires with no
	// navigation at all, and every `can*` on the row changes the moment a session resolves
	// (frontend/CLAUDE.md traps 2 and 3).
	$effect(() => {
		const id = page.params.id;
		if (!id || !enabled) return;
		const key = `${id}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		loaded = false;
		missing = false;
		getTask(id).then(
			(row) => {
				if (loadedFor !== key) return;
				task = row;
				loaded = true;
			},
			() => {
				if (loadedFor !== key) return;
				// 404 is the honest answer for "not yours to see" as much as for "gone" — house rule 4.
				task = null;
				missing = true;
				loaded = true;
			}
		);
	});
</script>

<svelte:head><title>{pageTitle(task ? task.title : m.tasks_myTitle())}</title></svelte:head>
<!-- "My tasks" -->

<FeatureGate feature="tasks">
	<div class="page">
		<a class="back" href={resolve('/tasks')}>
			{m.tasks_backToMine()}
			<!-- "All my tasks" -->
		</a>
		{#if !loaded}
			<p class="status-line">{m.tasks_loading()}</p>
			<!-- "Loading…" -->
		{:else if missing || !task}
			<p class="status-line">{m.tasks_notFound()}</p>
			<!-- "This task does not exist, or it is not yours to see." -->
		{:else}
			<TaskCard
				{task}
				discussion={rowDiscussions.byKey[discussionKeyFor('tasks', task.id)]}
				attachments="open"
				onchanged={(updated) => (task = updated)}
			/>
			{#if task.node}
				<!-- The way back to the board this task was opened from. A board opens a task in a
				     modal whose URL is this page (`TasksPanel`, shallow routing), so a refresh lands
				     here — and the parent content has to be one click away (owner, 2026-10-08). -->
				<p class="on-node">
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- nodeHref() calls resolve() itself; the rule only sees this attribute -->
					<a href={nodeHref(task.node)}>{m.tasks_backToNode({ title: task.node.title })}</a>
				</p>
				<!-- "Back to {title}" -->
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 720px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
		display: grid;
		gap: 0.8rem;
	}
	.back {
		font-size: 0.85rem;
	}
	.status-line,
	.on-node {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
</style>
