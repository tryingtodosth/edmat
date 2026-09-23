<script lang="ts">
	/** Confirm / no-show / done for one person on one shift, with the hours override beside them.
	 *
	 * The note box is shown from the start rather than after a refusal: the backend refuses an
	 * override more than half an hour from the shift's own length without one, and a field that
	 * only appears once you have been told off reads as a punishment rather than as part of the
	 * form. The placeholder says what the shift is worth, so "3" against a two-hour shift is a
	 * visible decision rather than a typo. */
	import { m } from '$lib/paraglide/messages.js';
	import { ASSIGNMENT_STATUS_LABELS } from '$lib/utils/labels';
	import type { Assignment } from '$lib/types/shift';

	let {
		assignment,
		shiftHours,
		onconfirm,
		onnoshow,
		ondone,
		ondrop
	}: {
		assignment: Assignment;
		shiftHours: string;
		onconfirm: () => void;
		onnoshow: () => void;
		ondone: (hours: string, note: string) => void;
		ondrop: () => void;
	} = $props();

	let hours = $state('');
	let note = $state('');
	const decided = $derived(assignment.status === 'done' || assignment.status === 'no_show');
</script>

<div class="row">
	<span class="who">{assignment.user.displayName}</span>
	{#if assignment.isMinor}
		<span class="pill warn">{m.shifts_minorBadge()}</span>
		<!-- "Under 16" -->
	{/if}
	<span class="pill">{ASSIGNMENT_STATUS_LABELS[assignment.status]()}</span>
	{#if decided}
		<span class="credited">{m.shifts_creditedHours({ hours: assignment.creditedHours })}</span>
		<!-- "{hours} h credited" -->
		{#if assignment.creditNote}<span class="note-text">{assignment.creditNote}</span>{/if}
	{:else}
		{#if assignment.status === 'claimed'}
			<button type="button" class="link" onclick={onconfirm}>{m.shifts_confirm()}</button>
			<!-- "Confirm" -->
		{/if}
		<input
			type="text"
			inputmode="decimal"
			class="hours"
			placeholder={shiftHours}
			aria-label={m.shifts_hoursOverrideFor({ name: assignment.user.displayName })}
			bind:value={hours}
		/>
		<input
			type="text"
			class="note"
			placeholder={m.shifts_creditNotePlaceholder()}
			aria-label={m.shifts_creditNoteFor({ name: assignment.user.displayName })}
			bind:value={note}
		/>
		<button type="button" class="link" onclick={() => ondone(hours.trim(), note.trim())}>
			{m.shifts_markDone()}
			<!-- "Done" -->
		</button>
		<button type="button" class="link" onclick={onnoshow}>{m.shifts_noShow()}</button>
		<!-- "No show" -->
		<button type="button" class="link danger" onclick={ondrop}>{m.shifts_removeFromShift()}</button>
		<!-- "Take off" -->
	{/if}
</div>

<style lang="scss">
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.82rem;
		padding: 0.15rem 0;
	}
	.who {
		font-weight: 600;
	}
	.pill {
		font-size: 0.72rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
		color: var(--text-secondary);
	}
	.pill.warn {
		border-color: #ef6c00;
		color: #ef6c00;
	}
	.credited,
	.note-text {
		color: var(--text-secondary);
	}
	.hours {
		width: 4rem;
	}
	.note {
		width: 10rem;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 0.8rem;
		color: var(--accent, #1565c0);
		cursor: pointer;
		text-decoration: underline;
	}
	.link.danger {
		color: var(--danger, #c62828);
	}
</style>
