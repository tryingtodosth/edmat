<script lang="ts">
	/** The guardian's consent, as a block on the register form rather than a checkbox in a row of
	 * them.
	 *
	 * Under 16 is the line (`accounts/minors.py`; GDPR art. 8, which Poland did not lower), and the
	 * consent is the guardian's, not the child's — which is why this asks for a NAME as well as a
	 * tick. A bare boolean cannot be shown to anybody afterwards, and "somebody ticked a box" is
	 * not a record of a consent.
	 *
	 * It also carries the sentence about what the guardian is consenting to, because a consent
	 * whose subject is not stated is not one. Both halves are bound out to the parent form, which
	 * owns the submit.
	 */
	import { m } from '$lib/paraglide/messages.js';

	let {
		guardianName = $bindable(''),
		consented = $bindable(false),
		required = true
	}: { guardianName?: string; consented?: boolean; required?: boolean } = $props();
</script>

<fieldset class="consent">
	<legend>{m.contests_guardianLegend()}</legend>
	<!-- "A guardian's consent" -->
	<p class="why">{m.contests_guardianWhy()}</p>
	<!-- "Accounts under 16 enter with the consent of a parent or guardian. Entering means granting a licence to the entry, agreeing to the rules and possibly receiving a prize — none of which an under-16 may agree to alone." -->
	<label class="field">
		<span>{m.contests_guardianNameLabel()}</span>
		<!-- "Parent's or guardian's full name" -->
		<!-- `type="text"` on purpose, always: `bind:value` on a number input binds a real number and
		     every `.trim()` downstream then throws (frontend/CLAUDE.md trap 1). -->
		<input type="text" bind:value={guardianName} autocomplete="off" {required} />
	</label>
	<label class="tick">
		<input type="checkbox" bind:checked={consented} />
		<span>{m.contests_guardianTick()}</span>
		<!-- "I am this entrant's parent or guardian and I consent to their taking part." -->
	</label>
	<p class="note">{m.contests_guardianNote()}</p>
	<!-- "Publishing the entrant's full name is a separate consent, asked below, and can be withdrawn at any time." -->
</fieldset>

<style lang="scss">
	.consent {
		border: 1px solid var(--status-info);
		border-radius: var(--radius-sm);
		background: var(--status-info-bg);
		padding: 0.7rem 0.9rem;
		margin: 0.6rem 0;
	}
	legend {
		font-weight: 600;
		padding: 0 0.3rem;
	}
	.why,
	.note {
		margin: 0 0 0.5rem;
		font-size: var(--font-size-sm);
		color: var(--text-primary);
	}
	.note {
		margin: 0.5rem 0 0;
		color: var(--text-secondary);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: var(--font-size-sm);
	}
	.field input {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.tick {
		display: flex;
		align-items: flex-start;
		gap: 0.45rem;
		margin-top: 0.5rem;
		font-size: var(--font-size-sm);
	}
</style>
