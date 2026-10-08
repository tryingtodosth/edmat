<script lang="ts">
	/**
	 * A task folded to one line — what a board shows by default (owner, 2026-10-08: "tasks should
	 * be folded by default … hiding behind a modal"). Priority, title, status, the due date and the
	 * step count; nothing a reader has to scroll past to find the next task. The whole line is one
	 * button, and what it opens is the board's business (`TasksPanel`): the full `TaskCard` in a
	 * modal whose URL is the task's own page, so a refresh lands there.
	 *
	 * Its own component rather than a `folded` prop on `TaskCard`, because the two share no markup
	 * worth sharing — a card is a grid of sections, a row is one flex line — and a card that can
	 * also be a row is two components in one file. The pills repeat four lines of the card's CSS;
	 * a third copy is the strike that extracts them (house rule 13).
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { formatDateTime } from '$lib/utils/datetime';
	import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '$lib/utils/labels';
	import type { Task } from '$lib/types/task';

	let { task, onopen }: { task: Task; onopen: (task: Task) => void } = $props();
</script>

<button
	type="button"
	class="task-row"
	class:task-row--closed={task.status === 'done' || task.status === 'cancelled'}
	data-task-row={task.id}
	aria-label={m.tasks_rowOpen({ title: task.title })}
	onclick={() => onopen(task)}
>
	<!-- "Open “{title}”" -->
	{#if task.priority <= 2}
		<span class="pri pri--{task.priority}">{TASK_PRIORITY_LABELS[task.priority]()}</span>
	{/if}
	<span class="task-row__title">{task.title}</span>
	{#if task.dueAt}
		<span class="task-row__due" class:task-row__due--late={task.isOverdue}>
			{formatDateTime(task.dueAt)}
		</span>
	{/if}
	{#if task.progress.total > 0}
		<span class="task-row__progress">{task.progress.done}/{task.progress.total}</span>
	{/if}
	<span class="status status--{task.status}">{TASK_STATUS_LABELS[task.status]()}</span>
</button>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.task-row {
		@include mix.focus-ring;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.45rem;
		width: 100%;
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.task-row--closed .task-row__title {
		color: var(--text-secondary);
		font-weight: 500;
	}
	.task-row__title {
		flex: 1 1 12rem;
		font-weight: 600;
		min-width: 0;
	}
	.task-row__due,
	.task-row__progress {
		font-size: 0.8rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.task-row__due--late {
		color: var(--status-danger);
		font-weight: 600;
	}
	.pri,
	.status {
		font-size: 0.72rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.pri--1 {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		border-color: transparent;
	}
	.pri--2 {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
		border-color: transparent;
	}
	.status--review {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
		border-color: transparent;
	}
	.status--done {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		border-color: transparent;
	}
</style>
