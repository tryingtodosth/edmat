<script lang="ts">
	/** One station's "add hours" form. A component rather than a `Record<stationId, draft>` in the
	 * parent on purpose: a lookup like `drafts[id] ??= {…}` evaluated inside the template is a
	 * state write during render, which Svelte 5 refuses outright (`state_unsafe_mutation`). One
	 * small component per form gives each one its own `$state` and the problem never arises.
	 *
	 * `type="text"` + `inputmode="numeric"` for the count, never `type="number"`: Svelte binds a
	 * real number (or `undefined`) to a number input and every `.trim()` around it then throws on
	 * the first live submit (frontend/CLAUDE.md trap 1).
	 */
	import { m } from '$lib/paraglide/messages.js';

	let {
		followsSession,
		onadd
	}: {
		followsSession: boolean;
		onadd: (startsAt: string | null, endsAt: string | null, needed: number) => void;
	} = $props();

	let start = $state('');
	let end = $state('');
	let needed = $state('1');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const count = Math.max(1, Number(needed) || 1);
		if (!start || !end) {
			// Allowed only on a session-bound station: the backend fills the hours in from the
			// session and marks the shift as following it.
			if (!followsSession) return;
			onadd(null, null, count);
		} else {
			onadd(new Date(start).toISOString(), new Date(end).toISOString(), count);
		}
		start = '';
		end = '';
		needed = '1';
	}
</script>

<form class="add-shift" onsubmit={submit}>
	<label>
		{m.shifts_shiftStart()}
		<!-- "From" -->
		<input type="datetime-local" bind:value={start} />
	</label>
	<label>
		{m.shifts_shiftEnd()}
		<!-- "To" -->
		<input type="datetime-local" bind:value={end} />
	</label>
	<label>
		{m.shifts_needed()}
		<!-- "People needed" -->
		<input type="text" inputmode="numeric" class="count" bind:value={needed} />
	</label>
	<button type="submit">{m.shifts_addShift()}</button>
	<!-- "Add shift" -->
	{#if followsSession}
		<span class="hint">{m.shifts_sessionShiftHint()}</span>
		<!-- "Leave the hours empty and the shift takes the session's — and moves when the session moves." -->
	{/if}
</form>

<style lang="scss">
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.4rem;
	}
	label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.82rem;
	}
	.count {
		width: 3.5rem;
	}
	.hint {
		font-size: 0.78rem;
		color: var(--text-secondary);
	}
</style>
