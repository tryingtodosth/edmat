<script lang="ts">
	/** Put somebody on this shift, by account id — the honest stopgap `EventStaffPanel` already
	 * documents, because this project still has no people search. Its own component for the same
	 * reason `ShiftAddForm` is: one `$state` per form, no record keyed by id. */
	import { m } from '$lib/paraglide/messages.js';

	let { onassign }: { onassign: (userId: string) => void } = $props();
	let userId = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const id = userId.trim();
		if (!id) return;
		onassign(id);
		userId = '';
	}
</script>

<form onsubmit={submit}>
	<input
		type="text"
		inputmode="numeric"
		pattern="[0-9]*"
		placeholder={m.shifts_assignPlaceholder()}
		aria-label={m.shifts_assignPlaceholder()}
		bind:value={userId}
	/>
	<button type="submit">{m.shifts_assign()}</button>
	<!-- "Assign" -->
</form>

<style lang="scss">
	form {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.3rem;
	}
	input {
		width: 7rem;
	}
</style>
