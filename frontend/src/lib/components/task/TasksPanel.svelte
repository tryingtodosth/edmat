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
	import FoldSection from '$lib/components/shared/FoldSection.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { createNodeTask, getNodeTasks, reasonOf } from '$lib/services/tasks';
	import { TASK_BLOCK_REASON_LABELS, TASK_STATUS_LABELS } from '$lib/utils/labels';
	import { TASK_STATUS_ORDER, type Task, type TaskDraft, type TaskStatus } from '$lib/types/task';
	import type { NodeRef } from '$lib/types/node';
	import { page } from '$app/state';
	import { pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import TaskCard from './TaskCard.svelte';
	import TaskRow from './TaskRow.svelte';
	import TaskForm from './TaskForm.svelte';
	import { RowDiscussions } from '$lib/components/discussion/rowDiscussions.svelte';
	import { discussionKeyFor } from '$lib/utils/discussionKeys';
	import { getNodeGoals } from '$lib/services/goals';
	import type { Goal } from '$lib/types/goal';

	let { node }: { node: NodeRef } = $props();

	// The same reading `FeatureGate` and the header use, including the moderator bypass that mirrors
	// the backend's own `is_staff` exemption in `feature_gate`.
	const enabled = $derived(featureFlagsStore.isEnabled('tasks') || authStore.isModerator);
	// …or the node is an organisation whose board is open (`node.openBoard`, 2026-10-08): then
	// anyone reads it, and only the roster's buttons are drawn (`isStaff` below, `canEdit` on a card).
	const shown = $derived(enabled && (node.isStaff || node.openBoard));

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

	// The node's goals, once per panel, so every card's "Serves: …" is a picker rather than a label
	// and no card asks for itself (`GoalServes` argues it). A failure leaves the list empty, which
	// degrades to the read-only line — a board must render whether or not the goals load.
	let goals = $state<Goal[]>([]);
	let goalsFor = $state('');
	$effect(() => {
		const key = `${node.kind}:${node.id}:${authStore.user?.id ?? 'anon'}`;
		if (key === goalsFor) return;
		goalsFor = key;
		getNodeGoals(node.kind, node.id).then(
			(rows) => {
				if (goalsFor === key) goals = rows;
			},
			() => {
				if (goalsFor === key) goals = [];
			}
		);
	});

	// Every row's thread policy in ONE request (`rowDiscussions.svelte.ts`), re-asked when the
	// rows or the reader change. Top-level rows only: a subtask's card is drawn by its parent.
	const rowDiscussions = new RowDiscussions();
	$effect(() =>
		rowDiscussions.load(
			tasks.map((row) => discussionKeyFor('tasks', row.id)),
			authStore.user?.id ?? 'anon'
		)
	);

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
	// The overdue filter shows its number before it is clicked.
	let overdueCount = $derived(
		tasks.filter((t) => t.isOverdue && t.status !== 'done' && t.status !== 'cancelled').length
	);

	function inStatus(status: TaskStatus): Task[] {
		return tasks.filter((row) => row.status === status);
	}

	// Folded by default (owner, 2026-10-08): the board is one line per task, and a task opens in a
	// modal over the board. The modal is a SHALLOW ROUTE (`pushState`): the URL becomes the task's
	// own page, `/tasks/<id>`, while this panel stays mounted and draws the dialog from
	// `page.state.taskModal`. A refresh therefore lands on the real `/tasks/[id]` page — the same
	// card, full size, with a link back to this node — and closing is `history.back()`, which is
	// also what the browser's own back button does. `page.state` is empty after a reload, which is
	// exactly when the real route should render instead of this dialog.
	const openTask = $derived(
		page.state.taskModal ? (tasks.find((row) => row.id === page.state.taskModal) ?? null) : null
	);
	function open(task: Task) {
		pushState(resolve('/tasks/[id]', { id: task.id }), { taskModal: task.id });
	}
	function close() {
		history.back();
	}
</script>

{#if shown}
	<FoldSection key="tasks" title={m.tasks_panelTitle()} count={tasks.length}>
		<!-- "Team tasks" -->
		<div class="tasks-panel" data-testid="tasks-panel">
			<!-- The filter row stays in the BODY rather than moving up to the fold's own action slot:
			     it is three buttons plus an overdue badge, and a shut section whose line carried a
			     filter group would be offering to filter something nobody can see. -->
			<header class="head">
				<div class="filters" role="group" aria-label={m.tasks_panelTitle()}>
					<button type="button" class:on={filter === 'all'} onclick={() => (filter = 'all')}>
						{m.tasks_filterAll()}
						<!-- "All" -->
					</button>
					{#if node.isStaff}
						<button type="button" class:on={filter === 'mine'} onclick={() => (filter = 'mine')}>
							{m.tasks_filterMine()}
							<!-- "Mine" -->
						</button>
					{/if}
					<button
						type="button"
						class:on={filter === 'overdue'}
						onclick={() => (filter = 'overdue')}
					>
						{m.tasks_filterOverdue()}
						{#if overdueCount > 0}<span class="count count--badge">{overdueCount}</span>{/if}
						<!-- "Overdue" -->
					</button>
				</div>
				{#if node.isStaff}
					<button type="button" class="add" onclick={() => (adding = !adding)}>
						{m.tasks_addTitle()}
						<!-- "Add a task" -->
					</button>
				{/if}
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
									<TaskRow {task} onopen={open} />
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
		</div>
	</FoldSection>

	{#if openTask}
		<ModalShell title={openTask.title} onClose={close} size="wide">
			<TaskCard
				task={openTask}
				discussion={rowDiscussions.byKey[discussionKeyFor('tasks', openTask.id)]}
				{goals}
				attachments="open"
				onchanged={(updated) => {
					replace(updated, openTask);
					// The row is gone (deleted): there is nothing left to show, so the dialog goes
					// too, the same way it goes on Escape.
					if (updated === null) close();
				}}
			/>
		</ModalShell>
	{/if}
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	// Card chrome and the heading are `FoldSection`'s since 2026-10-08; this is its body.
	.tasks-panel {
		display: grid;
		gap: 0.7rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}
	.filters {
		display: flex;
		gap: 0.25rem;
	}
	button {
		padding: 0.22rem 0.6rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
		font: inherit;
		font-size: 0.82rem;
	}
	.on {
		@include mix.selected-soft;
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
	// The overdue filter's number is the one count on the board that waits on the reader.
	.count--badge {
		@include mix.count-badge;
	}
	.status-line {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.88rem;
	}
	.problem {
		margin: 0;
		color: var(--status-danger);
		font-size: 0.88rem;
	}
	.toggle {
		justify-self: start;
	}
</style>
