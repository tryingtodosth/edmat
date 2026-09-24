<script lang="ts">
	// The task board of one node, mounted at marker B in `ManagementPanels.svelte`
	// (MANAGEMENT-BRIEF.md §3.B).
	//
	// **It draws nothing at all** unless the kill switch is on AND the reader is on the node's own
	// roster. Both halves matter: the flag is house rule 3 (a killed feature takes its panel with
	// it, not just its page), and the roster check is house rule 4 drawn on the client — the API
	// would 404 a non-staff reader anyway, and a panel that renders an error box on every course
	// page for every participant is worse than no panel.
	//
	// Grouped by status rather than a flat list, because a board's whole job is to answer "what is
	// not started" and "what is waiting on a check" at a glance. `done` and `cancelled` are folded
	// away behind a toggle: they are the two columns that only grow.
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { createNodeTask, getNodeTasks, reasonOf } from '$lib/services/tasks';
	import { TASK_BLOCK_REASON_LABELS, TASK_STATUS_LABELS } from '$lib/utils/labels';
	import { TASK_STATUS_ORDER, type Task, type TaskDraft, type TaskStatus } from '$lib/types/task';
	import type { NodeRef } from '$lib/types/node';
	import TaskCard from './TaskCard.svelte';
	import TaskForm from './TaskForm.svelte';

	let { node }: { node: NodeRef } = $props();

	// The same reading `FeatureGate` and the header use, including the moderator bypass that mirrors
	// the backend's own `is_staff` exemption in `feature_gate`.
	const enabled = $derived(featureFlagsStore.isEnabled('tasks') || authStore.isModerator);
	const shown = $derived(enabled && node.isStaff);

	type Filter = 'all' | 'mine' | 'overdue';
	let filter = $state<Filter>('all');
	let tasks = $state<Task[]>([]);
	let loaded = $state(false);
	let adding = $state(false);
	let busy = $state(false);
	let problem = $state('');
	let showClosed = $state(false);
	let loadedFor = $state('');

	// Keyed on node + reader + filter, with the guard every dynamic load here needs: an unguarded
	// `$effect` re-fires with no navigation at all (frontend/CLAUDE.md trap 2).
	$effect(() => {
		if (!shown) return;
		const key = `${node.kind}:${node.id}:${authStore.user?.id ?? 'anon'}:${filter}`;
		if (key === loadedFor) return;
		loadedFor = key;
		load(key);
	});

	async function load(key: string) {
		try {
			const rows = await getNodeTasks(node.kind, node.id, {
				assignedToMe: filter === 'mine',
				overdue: filter === 'overdue'
			});
			if (loadedFor === key) tasks = rows;
		} catch {
			// A 404 here means "not for you", which the `shown` guard should already have caught;
			// either way an empty board is the honest drawing.
			if (loadedFor === key) tasks = [];
		} finally {
			if (loadedFor === key) loaded = true;
		}
	}

	function replace(updated: Task | null, previous: Task) {
		if (updated === null) {
			tasks = tasks.filter((row) => row.id !== previous.id);
			return;
		}
		tasks = tasks.map((row) => (row.id === updated.id ? updated : row));
	}

	async function add(draft: TaskDraft) {
		busy = true;
		problem = '';
		try {
			const created = await createNodeTask(node.kind, node.id, draft);
			tasks = [...tasks, created];
			adding = false;
		} catch (error) {
			const reason = reasonOf(error);
			problem = reason ? TASK_BLOCK_REASON_LABELS[reason]() : m.common_error();
		} finally {
			busy = false;
		}
	}

	const openStatuses: TaskStatus[] = ['todo', 'in_progress', 'review'];
	const closedStatuses: TaskStatus[] = ['done', 'cancelled'];
	const columns = $derived(showClosed ? TASK_STATUS_ORDER : openStatuses);
	const closedCount = $derived(tasks.filter((row) => closedStatuses.includes(row.status)).length);

	function inStatus(status: TaskStatus): Task[] {
		return tasks.filter((row) => row.status === status);
	}
</script>

{#if shown}
	<section class="tasks-panel" data-testid="tasks-panel">
		<header class="head">
			<h2>{m.tasks_panelTitle()}</h2>
			<!-- "Team tasks" -->
			<div class="filters" role="group" aria-label={m.tasks_panelTitle()}>
				<button type="button" class:on={filter === 'all'} onclick={() => (filter = 'all')}>
					{m.tasks_filterAll()}
					<!-- "All" -->
				</button>
				<button type="button" class:on={filter === 'mine'} onclick={() => (filter = 'mine')}>
					{m.tasks_filterMine()}
					<!-- "Mine" -->
				</button>
				<button type="button" class:on={filter === 'overdue'} onclick={() => (filter = 'overdue')}>
					{m.tasks_filterOverdue()}
					<!-- "Overdue" -->
				</button>
			</div>
			<button type="button" class="add" onclick={() => (adding = !adding)}>
				{m.tasks_addTitle()}
				<!-- "Add a task" -->
			</button>
		</header>

		{#if adding}
			<TaskForm
				{busy}
				submitLabel={m.tasks_add()}
				onsubmit={add}
				oncancel={() => (adding = false)}
			/>
			<!-- "Add task" -->
		{/if}

		{#if problem}
			<p class="problem" role="alert">{problem}</p>
		{/if}

		{#if !loaded}
			<p class="status-line">{m.tasks_loading()}</p>
			<!-- "Loading…" -->
		{:else if tasks.length === 0}
			<p class="status-line">{m.tasks_empty()}</p>
			<!-- "Nothing on the board yet." -->
		{:else}
			{#each columns as status (status)}
				{@const rows = inStatus(status)}
				{#if rows.length > 0}
					<section class="column">
						<h3>{TASK_STATUS_LABELS[status]()} <span class="count">{rows.length}</span></h3>
						<div class="rows">
							{#each rows as task (task.id)}
								<TaskCard {task} onchanged={(updated) => replace(updated, task)} />
							{/each}
						</div>
					</section>
				{/if}
			{/each}
			{#if closedCount > 0}
				<button type="button" class="toggle" onclick={() => (showClosed = !showClosed)}>
					{showClosed ? m.tasks_filterAll() : m.tasks_status_done()}
					<!-- "All" / "Done" -->
					<span class="count">{closedCount}</span>
				</button>
			{/if}
		{/if}
	</section>
{/if}

<style lang="scss">
	.tasks-panel {
		display: grid;
		gap: 0.7rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 8px);
		background: var(--surface-2, var(--surface));
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
		flex: 1 1 auto;
	}
	.filters {
		display: flex;
		gap: 0.25rem;
	}
	button {
		padding: 0.22rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm, 4px);
		background: var(--surface);
		color: var(--text-primary);
		cursor: pointer;
		font: inherit;
		font-size: 0.82rem;
	}
	.on {
		background: var(--accent, #2f6fdb);
		border-color: transparent;
		color: #fff;
	}
	.column {
		display: grid;
		gap: 0.4rem;
	}
	.column h3 {
		margin: 0;
		font-size: 0.82rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.rows {
		display: grid;
		gap: 0.45rem;
	}
	.count {
		font-weight: 400;
		color: var(--text-secondary);
	}
	.status-line {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.88rem;
	}
	.problem {
		margin: 0;
		color: var(--danger, #b3261e);
		font-size: 0.88rem;
	}
	.toggle {
		justify-self: start;
	}
</style>
