<script lang="ts">
	/**
	 * "Serves: <goal>" — which goal a task or a plan is work towards (`goals/`, 2026-10-08).
	 *
	 * **One component for both** rather than a copy in `TaskCard` and another on `/plans/[id]`: it
	 * is the same sentence, the same select and the same refusal word (`other_node`, when the goal
	 * named hangs off a different node), and two copies is how one of the two stops offering the
	 * "no goal" option.
	 *
	 * It takes the node's goals rather than fetching them: whoever draws a board already has them
	 * (`GoalsPanel` asked once), and a picker per row asking for itself is the N+1 this project
	 * keeps refusing. With no goals to choose from it draws the read-only line or nothing at all —
	 * a select with one empty option is an affordance that does nothing.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { Goal } from '$lib/types/goal';

	let {
		/** The goals of the node this row hangs on. Empty where the caller has none to offer. */
		goals = [],
		/** The goal's id, or `null`. */
		value,
		/** Its title, sent down with the row so this needs no lookup when `goals` is empty. */
		title,
		canEdit = false,
		busy = false,
		onselect
	}: {
		goals?: Goal[];
		value: string | null;
		title: string;
		canEdit?: boolean;
		busy?: boolean;
		onselect: (goalId: string | null) => void;
	} = $props();

	const offersPicker = $derived(canEdit && goals.length > 0);
</script>

{#if offersPicker}
	<p class="serves">
		<label>
			<span>{m.goals_servesLabel()}</span>
			<!-- "Serves" -->
			<select
				value={value ?? ''}
				disabled={busy}
				onchange={(e) => onselect(e.currentTarget.value || null)}
			>
				<option value="">{m.goals_servesNone()}</option>
				<!-- "No goal" -->
				{#each goals as goal (goal.id)}
					<option value={goal.id}>{goal.title}</option>
				{/each}
			</select>
		</label>
	</p>
{:else if value && title}
	<p class="serves">
		{m.goals_servesLabel()}:
		<!-- "Serves" -->
		<a href={resolve('/goals/[id]', { id: value })}>{title}</a>
	</p>
{/if}

<style lang="scss">
	.serves {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
		label {
			display: inline-flex;
			align-items: baseline;
			gap: 0.4rem;
		}
		select {
			padding: 2px 4px;
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			font-size: var(--font-size-sm);
		}
	}
</style>
