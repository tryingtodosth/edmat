<script lang="ts">
	/** "Who is this for?" — the required audience picker every submit form carries (AUDIENCE-BRIEF.md
	 * §1). Required with NO default on purpose: a default is how everything ends up `university`. */
	import type { Audience } from '$lib/types';
	import { AUDIENCES, AUDIENCE_LABELS } from '$lib/utils/labels';
	import { m } from '$lib/paraglide/messages.js';

	let { value = $bindable(''), id = undefined }: { value: Audience | ''; id?: string } = $props();
</script>

<label class="field">
	<span>{m.audience_field_label()}</span>
	<select {id} bind:value required>
		<option value="" disabled>{m.audience_choose()}</option>
		{#each AUDIENCES as a (a)}
			<option value={a}>{AUDIENCE_LABELS[a]()}</option>
		{/each}
	</select>
</label>
