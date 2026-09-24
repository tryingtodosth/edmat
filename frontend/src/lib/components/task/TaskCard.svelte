<script lang="ts">
	// One task, everywhere a task is drawn: on a node's board, folded under a parent, and on
	// `/tasks`. One component rather than three, because the row carries its own refusals
	// (`canEdit`, `canAssign`, `nextStatuses`) and a second copy of that reading is how a button
	// that works in one place stops working in the other.
	//
	// Subtasks are drawn by this same component with `allowSubtasks={false}` — the backend refuses a
	// second level with `409 nested`, and hiding the control is house rule 3's shape applied to a
	// rule rather than to a flag: do not offer what will be refused.
	import { resolve } from '$app/paths';
	// A component referencing itself needs a real import in Svelte 5 (`<svelte:self>` is gone).
	// The recursion is bounded by the data, not by a guard: one level of subtasks is a backend
	// invariant (`409 nested`), and `allowSubtasks={false}` below is what stops it here.
	import TaskCard from './TaskCard.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import AssigneePicker from './AssigneePicker.svelte';
	import TaskForm from './TaskForm.svelte';
	import {
		createSubtask,
		deleteTask,
		reasonOf,
		transitionTask,
		updateTask
	} from '$lib/services/tasks';
	import { formatDateTime } from '$lib/utils/datetime';
	import {
		TASK_BLOCK_REASON_LABELS,
		TASK_MOVE_LABELS,
		TASK_PRIORITY_LABELS,
		TASK_STATUS_LABELS
	} from '$lib/utils/labels';
	import { nextStatuses, type Task, type TaskDraft, type TaskStatus } from '$lib/types/task';

	let {
		task,
		allowSubtasks = true,
		showNode = false,
		onchanged
	}: {
		task: Task;
		allowSubtasks?: boolean;
		/** `/tasks` says what each task hangs on; a node's own board does not need telling. */
		showNode?: boolean;
		/** `null` means the row is gone — the parent drops it from its list. */
		onchanged: (updated: Task | null) => void;
	} = $props();

	let editing = $state(false);
	let addingStep = $state(false);
	let confirmingDelete = $state(false);
	let busy = $state(false);
	let problem = $state('');

	const moves = $derived(nextStatuses(task));

	async function run(action: () => Promise<Task | null>) {
		busy = true;
		problem = '';
		try {
			onchanged(await action());
			editing = false;
			addingStep = false;
			confirmingDelete = false;
		} catch (error) {
			const reason = reasonOf(error);
			problem = reason ? TASK_BLOCK_REASON_LABELS[reason]() : m.common_error();
		} finally {
			busy = false;
		}
	}

	function saveEdit(draft: TaskDraft) {
		run(() => updateTask(task.id, draft));
	}

	function addStep(draft: TaskDraft) {
		// The parent is reloaded by the caller's `onchanged`; a subtask create answers with the
		// CHILD, so the card asks for its own row again rather than guessing the new shape.
		run(async () => {
			await createSubtask(task.id, draft);
			return await refetch();
		});
	}

	async function refetch(): Promise<Task> {
		const { getTask } = await import('$lib/services/tasks');
		return await getTask(task.id);
	}

	function move(to: TaskStatus) {
		run(() => transitionTask(task.id, to));
	}

	function remove() {
		run(async () => {
			await deleteTask(task.id);
			return null;
		});
	}
</script>

<article class="task" class:task--closed={task.status === 'done' || task.status === 'cancelled'}>
	<header class="task__head">
		<span class="pri pri--{task.priority}">{TASK_PRIORITY_LABELS[task.priority]()}</span>
		<h3 class="task__title">{task.title}</h3>
		<span class="status">{TASK_STATUS_LABELS[task.status]()}</span>
	</header>

	<p class="meta">
		{#if task.dueAt}
			<!-- Overdue says WHEN as well as THAT. Found by looking at the screenshot: the first
			     version replaced the date with the word, and "Overdue" with no date cannot tell a
			     person whether they are an hour late or a fortnight late — which is the only thing
			     they need in order to decide what to do about it. -->
			<span class="due" class:due--late={task.isOverdue}>
				{#if task.isOverdue}
					{m.tasks_overdue()}
					<!-- "Overdue" -->
					·
				{/if}
				{m.tasks_dueOn({ date: formatDateTime(task.dueAt) })}
				<!-- "Due {date}" -->
			</span>
		{/if}
		{#if task.progress.total > 0}
			<span class="progress"
				>{m.tasks_progress({ done: task.progress.done, total: task.progress.total })}</span
			>
			<!-- "{done} of {total} steps done" -->
		{/if}
		<span class="author">{m.tasks_createdBy({ name: task.createdBy.displayName })}</span>
		<!-- "Added by {name}" -->
		{#if showNode && task.node}
			<span class="on-node">{m.tasks_onNode({ title: task.node.title })}</span>
			<!-- "on {title}" -->
		{/if}
	</p>

	{#if task.description && !editing}
		<div class="description"><MathContent source={task.description} /></div>
	{/if}

	{#if task.node}
		<AssigneePicker {task} node={task.node} onchanged={(updated) => onchanged(updated)} />
	{/if}

	<div class="actions">
		{#each moves as to (to)}
			<button type="button" disabled={busy} onclick={() => move(to)}
				>{TASK_MOVE_LABELS[to]()}</button
			>
		{/each}
		{#if task.canEdit}
			<button type="button" class="link" onclick={() => (editing = !editing)}>
				{m.tasks_edit()}
				<!-- "Edit" -->
			</button>
		{/if}
		{#if allowSubtasks && task.canEdit}
			<button type="button" class="link" onclick={() => (addingStep = !addingStep)}>
				{m.tasks_addSubtask()}
				<!-- "Add a step" -->
			</button>
		{/if}
		{#if task.canEdit}
			<button type="button" class="link link--danger" onclick={() => (confirmingDelete = true)}>
				{m.tasks_delete()}
				<!-- "Delete" -->
			</button>
		{/if}
		{#if showNode}
			<a class="link" href={resolve('/tasks/[id]', { id: task.id })}>
				{m.tasks_openTask()}
				<!-- "Open the task" -->
			</a>
		{/if}
	</div>

	{#if confirmingDelete}
		<p class="confirm">
			{m.tasks_confirmDelete()}
			<!-- "Delete this task? This cannot be undone." -->
			<button type="button" class="link link--danger" disabled={busy} onclick={remove}>
				{m.tasks_delete()}
				<!-- "Delete" -->
			</button>
			<button type="button" class="link" onclick={() => (confirmingDelete = false)}>
				{m.tasks_cancel()}
				<!-- "Cancel" -->
			</button>
		</p>
	{/if}

	{#if problem}
		<p class="problem" role="alert">{problem}</p>
	{/if}

	{#if editing}
		<TaskForm
			initialTitle={task.title}
			initialDescription={task.description}
			initialPriority={task.priority}
			initialDueAt={task.dueAt}
			{busy}
			submitLabel={m.tasks_save()}
			onsubmit={saveEdit}
			oncancel={() => (editing = false)}
		/>
		<!-- "Save" -->
	{/if}

	{#if allowSubtasks && (task.subtasks.length > 0 || addingStep)}
		<section class="steps">
			<h4>{m.tasks_subtasksTitle()}</h4>
			<!-- "Steps" -->
			{#each task.subtasks as child (child.id)}
				<TaskCard
					task={child}
					allowSubtasks={false}
					onchanged={() => run(async () => await refetch())}
				/>
			{/each}
			{#if addingStep}
				<TaskForm
					compact
					{busy}
					submitLabel={m.tasks_add()}
					onsubmit={addStep}
					oncancel={() => (addingStep = false)}
				/>
				<!-- "Add task" -->
			{/if}
		</section>
	{/if}
</article>

<style lang="scss">
	.task {
		display: grid;
		gap: 0.4rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 8px);
		background: var(--surface);
	}
	.task--closed {
		opacity: 0.72;
	}
	.task__head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.45rem;
	}
	.task__title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		flex: 1 1 12rem;
	}
	.pri,
	.status {
		font-size: 0.72rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.pri--1 {
		border-color: var(--danger, #b3261e);
		color: var(--danger, #b3261e);
	}
	.pri--2 {
		border-color: var(--warning, #a5670d);
		color: var(--warning, #a5670d);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.due--late {
		color: var(--danger, #b3261e);
		font-weight: 600;
	}
	.description {
		font-size: 0.9rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	button,
	.actions a {
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm, 4px);
		background: var(--surface);
		color: var(--text-primary);
		cursor: pointer;
		font: inherit;
		font-size: 0.82rem;
		text-decoration: none;
	}
	.link {
		border: 0;
		background: none;
		color: var(--accent, #2f6fdb);
		text-decoration: underline;
		padding: 0;
	}
	.link--danger {
		color: var(--danger, #b3261e);
	}
	.confirm,
	.problem {
		margin: 0;
		font-size: 0.85rem;
	}
	.problem {
		color: var(--danger, #b3261e);
	}
	.steps {
		display: grid;
		gap: 0.4rem;
		margin-left: 0.8rem;
		padding-left: 0.6rem;
		border-left: 2px solid var(--border);
	}
	.steps h4 {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--text-secondary);
		font-weight: 600;
	}
</style>
