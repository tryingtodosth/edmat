<script lang="ts">
	// The one form that writes a task: the panel's "Add a task", a card's "Edit", and the subtask
	// box under a parent all mount this with different props rather than each growing their own
	// three inputs. One form is also one place the `datetime-local` → ISO conversion lives.
	//
	// **`type="text"` + `inputmode`, never `type="number"`** for anything the surrounding code
	// treats as a string (frontend/CLAUDE.md trap 1). Priority is a `<select>`, so it is exempt —
	// but it is still coerced with `Number()` at the boundary rather than trusted.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from '$lib/utils/labels';
	import type { TaskDraft, TaskPriority } from '$lib/types/task';

	let {
		initialTitle = '',
		initialDescription = '',
		initialPriority = 3 as TaskPriority,
		initialDueAt = null as string | null,
		compact = false,
		busy = false,
		submitLabel,
		onsubmit,
		oncancel
	}: {
		initialTitle?: string;
		initialDescription?: string;
		initialPriority?: TaskPriority;
		initialDueAt?: string | null;
		/** The subtask box: a title and nothing else, because a step is a line, not a document. */
		compact?: boolean;
		busy?: boolean;
		submitLabel: string;
		onsubmit: (draft: TaskDraft) => void;
		oncancel?: () => void;
	} = $props();

	// `untrack` on every seed: these are a STARTING value, not a binding. Reading a prop directly
	// into `$state` is `state_referenced_locally` (svelte-check warns, and the 0-warning bar is the
	// bar), and making them track would fight the person typing — a re-render of the parent would
	// throw away half a sentence.
	let title = $state(untrack(() => initialTitle));
	let description = $state(untrack(() => initialDescription));
	let priority = $state(String(untrack(() => initialPriority)));
	// `<input type="datetime-local">` speaks 'YYYY-MM-DDTHH:mm' in the READER's own zone; the API
	// speaks ISO UTC. The conversion is here, once, and `slice(0, 16)` back the other way.
	let dueLocal = $state(toLocalInput(untrack(() => initialDueAt)));
	let problem = $state('');

	function toLocalInput(iso: string | null): string {
		if (!iso) return '';
		const when = new Date(iso);
		if (Number.isNaN(when.getTime())) return '';
		const offset = when.getTimezoneOffset() * 60000;
		return new Date(when.getTime() - offset).toISOString().slice(0, 16);
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = title.trim();
		if (!trimmed) {
			problem = m.tasks_titleRequired(); // "A task needs a title."
			return;
		}
		problem = '';
		const parsed = dueLocal ? new Date(dueLocal) : null;
		onsubmit({
			title: trimmed,
			description: compact ? '' : description,
			priority: Number(priority) as TaskPriority,
			dueAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null
		});
	}
</script>

<form class="task-form" class:task-form--compact={compact} onsubmit={submit}>
	<label class="field">
		<span class="field__label">{compact ? m.tasks_subtaskPlaceholder() : m.tasks_fieldTitle()}</span
		>
		<!-- "One step of this task" / "What needs doing" -->
		<input type="text" bind:value={title} maxlength="200" required />
	</label>

	{#if !compact}
		<label class="field">
			<span class="field__label">{m.tasks_fieldDescription()}</span>
			<!-- "Details (optional)" -->
			<textarea bind:value={description} rows="3"></textarea>
		</label>

		<div class="row">
			<label class="field">
				<span class="field__label">{m.tasks_fieldPriority()}</span>
				<!-- "Priority" -->
				<select bind:value={priority}>
					{#each TASK_PRIORITIES as level (level)}
						<option value={String(level)}>{TASK_PRIORITY_LABELS[level]()}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="field__label">{m.tasks_fieldDueAt()}</span>
				<!-- "Due" -->
				<input type="datetime-local" bind:value={dueLocal} />
			</label>
		</div>
	{/if}

	{#if problem}
		<p class="problem" role="alert">{problem}</p>
	{/if}

	<div class="actions">
		<button type="submit" class="primary" disabled={busy}>
			{busy ? m.tasks_saving() : submitLabel}
			<!-- "Saving…" -->
		</button>
		{#if oncancel}
			<button type="button" class="ghost" onclick={oncancel}>
				{m.tasks_cancel()}
				<!-- "Cancel" -->
			</button>
		{/if}
	</div>
</form>

<style lang="scss">
	.task-form {
		display: grid;
		gap: 0.6rem;
		margin: 0.6rem 0;
	}
	.field {
		display: grid;
		gap: 0.25rem;
	}
	.field__label {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.6rem;
	}
	input,
	textarea,
	select {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm, 4px);
		background: var(--surface);
		color: var(--text-primary);
		font: inherit;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	button {
		padding: 0.35rem 0.8rem;
		border-radius: var(--radius-sm, 4px);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-primary);
		cursor: pointer;
		font: inherit;
	}
	.primary {
		background: var(--accent, #2f6fdb);
		border-color: transparent;
		color: #fff;
	}
	.problem {
		margin: 0;
		color: var(--danger, #b3261e);
		font-size: 0.85rem;
	}
</style>
