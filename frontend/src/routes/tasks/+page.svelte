<script lang="ts">
	// "My tasks" — everything waiting on me, and everything I am waiting on somebody else for
	// (MANAGEMENT-BRIEF.md §3.B). Reached from the account menu; the board itself lives on each
	// course, event or material.
	//
	// Two sections rather than one list, because they are two different questions and a person
	// reading this page is answering one of them at a time. `assigned` is sorted overdue-first by
	// the backend (`tasks/views.py: _mine_order`) and is NOT re-sorted here — one ordering, in one
	// place, is the whole reason it is computed there.
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import TaskCard from '$lib/components/task/TaskCard.svelte';
	import { getMyTasks } from '$lib/services/tasks';
	import { pageTitle } from '$lib/utils/pageTitle';
	import type { MyTasks, Task } from '$lib/types/task';

	let mine = $state<MyTasks>({ assigned: [], created: [] });
	let loaded = $state(false);
	let error = $state('');

	// `$effect` keyed on the auth flag plus a `loadedOnce` guard, not a bare `onMount` read:
	// `authStore.init()` resolves asynchronously and a hard reload once showed an empty page to
	// somebody with a perfectly good session (frontend/CLAUDE.md trap 3).
	// The same reading the panel and the header use, INCLUDING in the load guard: house rule 3 says
	// a killed feature removes its links and stops asking. Without this the page still fired
	// `GET /api/tasks/mine/` behind the FeatureGate notice, the gate answered 403, and the browser
	// logged a failed request on a page that was working exactly as designed — found by the e2e
	// run's zero-console-errors condition, which is the whole reason it is a pass condition.
	// **`isLoaded` first.** `isEnabled` fails OPEN before the first `/api/feature-flags/` response
	// lands (the store says so, and that is right for drawing links — nothing should flash as
	// disabled for a visitor it is enabled for). It is wrong for FIRING a request the API will
	// refuse: with the switch off, this page still asked once on every fresh load and the browser
	// logged a 403 behind a notice that was doing its job. Waiting costs one already-in-flight
	// request and is what house rule 3's "stops asking" actually means.
	const enabled = $derived(
		featureFlagsStore.isLoaded && (featureFlagsStore.isEnabled('tasks') || authStore.isModerator)
	);

	let loadedOnce = $state(false);
	$effect(() => {
		if (!enabled || !authStore.isAuthenticated || loadedOnce) return;
		loadedOnce = true;
		load();
	});
	onMount(() => {
		if (!authStore.isAuthenticated) loaded = true;
	});

	async function load() {
		try {
			mine = await getMyTasks();
		} catch {
			error = m.common_error();
		} finally {
			loaded = true;
		}
	}

	function replace(list: 'assigned' | 'created', updated: Task | null, previous: Task) {
		const rows = mine[list];
		mine = {
			...mine,
			[list]:
				updated === null
					? rows.filter((row) => row.id !== previous.id)
					: rows.map((row) => (row.id === updated.id ? updated : row))
		};
	}
</script>

<svelte:head><title>{pageTitle(m.tasks_myTitle())}</title></svelte:head>
<!-- "My tasks" -->

<FeatureGate feature="tasks">
	<div class="page">
		<h1>{m.tasks_myTitle()}</h1>
		<!-- "My tasks" -->
		{#if !authStore.isAuthenticated}
			<p class="status-line">{m.tasks_mySignIn()}</p>
			<!-- "Sign in to see the tasks waiting on you." -->
		{:else if error}
			<p class="problem" role="alert">{error}</p>
		{:else if !loaded}
			<p class="status-line">{m.tasks_loading()}</p>
			<!-- "Loading…" -->
		{:else}
			<section>
				<h2>{m.tasks_myAssigned()}</h2>
				<!-- "Waiting on you" -->
				{#if mine.assigned.length === 0}
					<p class="status-line">{m.tasks_myAssignedEmpty()}</p>
					<!-- "Nothing is waiting on you." -->
				{:else}
					<div class="rows">
						{#each mine.assigned as task (task.id)}
							<TaskCard
								{task}
								showNode
								onchanged={(updated) => replace('assigned', updated, task)}
							/>
						{/each}
					</div>
				{/if}
			</section>

			<section>
				<h2>{m.tasks_myCreated()}</h2>
				<!-- "You are waiting on somebody" -->
				{#if mine.created.length === 0}
					<p class="status-line">{m.tasks_myCreatedEmpty()}</p>
					<!-- "Nothing you added is waiting to be checked." -->
				{:else}
					<div class="rows">
						{#each mine.created as task (task.id)}
							<TaskCard
								{task}
								showNode
								onchanged={(updated) => replace('created', updated, task)}
							/>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 820px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
		display: grid;
		gap: 1.2rem;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	h2 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.rows {
		display: grid;
		gap: 0.5rem;
	}
	.status-line {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
	.problem {
		margin: 0;
		color: var(--danger, #b3261e);
	}
</style>
