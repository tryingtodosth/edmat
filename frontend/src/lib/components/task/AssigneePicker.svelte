<script lang="ts">
	// Who is on a task. The list of candidates comes from `GET /api/nodes/{kind}/{id}/staff/`
	// (MANAGEMENT-BRIEF.md §2) — the shared roster endpoint, so this app never lists people itself
	// and an assignee can never be somebody the node's own rule module does not recognise.
	//
	// The roster is fetched **only when a manager opens the picker**: everybody else sees the names
	// already on the task and no control, so a reader who cannot assign never costs a request. The
	// endpoint 404s below staff anyway, which is why the failure path here is a quiet empty list
	// rather than an error — "you may not see the roster" is not something to shout at a volunteer.
	import { m } from '$lib/paraglide/messages.js';
	import { getNodeStaff } from '$lib/services/nodes';
	import { assignTask, reasonOf, unassignTask } from '$lib/services/tasks';
	import { TASK_BLOCK_REASON_LABELS } from '$lib/utils/labels';
	import type { NodeRef } from '$lib/types/node';
	import type { NodeStaffMember } from '$lib/types/node';
	import type { Task } from '$lib/types/task';

	let { task, node, onchanged }: { task: Task; node: NodeRef; onchanged: (updated: Task) => void } =
		$props();

	let open = $state(false);
	let staff = $state<NodeStaffMember[]>([]);
	let chosen = $state('');
	let busy = $state(false);
	let problem = $state('');
	let loadedFor = $state('');

	// Keyed on the node, with the usual idempotency guard: an effect that re-fires on every render
	// would refetch the roster on each keystroke elsewhere in the panel (frontend/CLAUDE.md trap 2).
	$effect(() => {
		if (!open) return;
		const key = `${node.kind}:${node.id}`;
		if (key === loadedFor) return;
		loadedFor = key;
		getNodeStaff(node.kind, node.id).then(
			(rows) => (staff = dedupe(rows)),
			() => (staff = [])
		);
	});

	/** **The roster can arrive with one person on it twice, and that is not paranoia.**
	 *  `config/nodes.py: _event_staff_users` is `User.objects.filter(pk=event.host_id) |
	 *  User.objects.filter(event_staff_roles__event=event)` with no `.distinct()`, and an event's
	 *  host IS a row in `EventStaff` (`Event.save` creates the organiser row) — so a host comes back
	 *  twice. That crashed the `{#each … (person.id)}` below with `each_key_duplicate`, which in
	 *  Svelte 5 does not degrade: the whole block failed to render and the picker showed nothing but
	 *  its placeholder. Found by a browser run, invisible to `svelte-check` and to every backend
	 *  test. The real fix is one `.distinct()` in the seam, which is read-only for this branch
	 *  (MANAGEMENT-BRIEF.md §4 rule 3) and is on the board for the integrator; this is the honest
	 *  client-side defence, and every step's picker wants it anyway.
	 */
	function dedupe(rows: NodeStaffMember[]): NodeStaffMember[] {
		// `findIndex` rather than a `Set`: `svelte/prefer-svelte-reactivity` refuses a mutable
		// built-in `Set` anywhere in a component (frontend/CLAUDE.md trap 7), and a roster is a
		// dozen rows, so the quadratic pass is free.
		return rows.filter((row, i) => rows.findIndex((other) => other.id === row.id) === i);
	}

	const available = $derived(
		staff.filter((person) => !task.assignees.some((row) => row.user.id === person.id))
	);

	async function run(action: () => Promise<Task>) {
		busy = true;
		problem = '';
		try {
			onchanged(await action());
			chosen = '';
		} catch (error) {
			const reason = reasonOf(error);
			problem = reason ? TASK_BLOCK_REASON_LABELS[reason]() : m.common_error();
		} finally {
			busy = false;
		}
	}
</script>

<div class="assignees">
	<span class="assignees__label">{m.tasks_assignees()}</span>
	<!-- "On it" -->
	{#if task.assignees.length === 0}
		<span class="assignees__none">{m.tasks_nobodyAssigned()}</span>
		<!-- "Nobody yet" -->
	{:else}
		<ul class="chips">
			{#each task.assignees as row (row.id)}
				<li class="chip">
					<span>{row.user.displayName}</span>
					{#if task.canAssign}
						<button
							type="button"
							class="chip__remove"
							disabled={busy}
							aria-label={m.tasks_unassign()}
							title={m.tasks_unassign()}
							onclick={() => run(() => unassignTask(task.id, row.user.id))}>×</button
						>
						<!-- "Take off" -->
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if task.canAssign}
		{#if !open}
			<button type="button" class="link" onclick={() => (open = true)}>
				{m.tasks_assign()}
				<!-- "Put somebody on it" -->
			</button>
		{:else}
			<div class="picker">
				<label class="sr-only" for={`assignee-${task.id}`}>{m.tasks_assignPick()}</label>
				<!-- "Choose from the team" -->
				<select id={`assignee-${task.id}`} bind:value={chosen} disabled={busy}>
					<option value="">{m.tasks_assignPick()}</option>
					<!-- "Choose from the team" -->
					{#each available as person (person.id)}
						<option value={person.id}>{person.displayName}</option>
					{/each}
				</select>
				<button
					type="button"
					disabled={busy || !chosen}
					onclick={() => run(() => assignTask(task.id, chosen))}
				>
					{m.tasks_add()}
					<!-- "Add task" -->
				</button>
				<button type="button" class="link" onclick={() => (open = false)}>
					{m.tasks_cancel()}
					<!-- "Cancel" -->
				</button>
			</div>
			<p class="note">{m.tasks_staffOnlyNote()}</p>
			<!-- "Only people on this team can be given a task." -->
		{/if}
	{/if}

	{#if problem}
		<p class="problem" role="alert">{problem}</p>
	{/if}
</div>

<style lang="scss">
	.assignees {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
	.assignees__label,
	.assignees__none,
	.note {
		color: var(--text-secondary);
	}
	.note {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.78rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-2, var(--surface));
	}
	.chip__remove {
		border: 0;
		background: none;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		padding: 0;
	}
	.picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}
	select {
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm, 4px);
		background: var(--surface);
		color: var(--text-primary);
		font: inherit;
	}
	button {
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm, 4px);
		background: var(--surface);
		color: var(--text-primary);
		cursor: pointer;
		font: inherit;
		font-size: 0.85rem;
	}
	.link {
		border: 0;
		background: none;
		color: var(--accent, #2f6fdb);
		text-decoration: underline;
		padding: 0;
	}
	.problem {
		flex-basis: 100%;
		margin: 0;
		color: var(--danger, #b3261e);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
