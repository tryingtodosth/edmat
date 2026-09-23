<script lang="ts">
	/** One volunteer's record, with its own `$state` — the same reason the two shift forms are
	 * their own components: a draft per row held in the parent would have to be created while the
	 * template runs, which Svelte 5 refuses.
	 *
	 * The boxes are drafts until Save: ticking "consent recorded" is a legal assertion about a
	 * piece of paper somebody is holding, and a checkbox that saves on change would make a
	 * mis-click into one. */
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { VolunteerRecord } from '$lib/types/shift';

	let {
		record,
		onsave
	}: {
		record: VolunteerRecord;
		onsave: (
			userId: string,
			fields: {
				consentRecorded?: boolean;
				consentNote?: string;
				vettingChecked?: boolean;
				vettingReference?: string;
				emergencyContactNote?: string;
			}
		) => void;
	} = $props();

	// `untrack` because capturing the initial value is exactly the intent: these five are a DRAFT
	// of the record, and re-syncing them from the prop on every reload would wipe out whatever the
	// organiser had half-typed. The row is keyed by account id in the parent, so a genuinely
	// different volunteer gets a new component with fresh drafts.
	let consent = $state(untrack(() => record.hasConsent));
	let consentNote = $state(untrack(() => record.consentNote));
	let vetting = $state(untrack(() => record.vettingCheckedAt !== null));
	let vettingReference = $state(untrack(() => record.vettingReference));
	let emergency = $state(untrack(() => record.emergencyContactNote));

	function save(e: SubmitEvent) {
		e.preventDefault();
		if (!record.user.id) return;
		onsave(record.user.id, {
			consentRecorded: consent,
			consentNote,
			vettingChecked: vetting,
			vettingReference,
			emergencyContactNote: emergency
		});
	}
</script>

<form onsubmit={save}>
	<div class="who">
		<strong>{record.user.displayName}</strong>
		{#if record.isMinor}
			<span class="pill warn">{m.shifts_minorBadge()}</span>
			<!-- "Under 16" -->
		{/if}
		<span class="hours">{m.shifts_creditedHours({ hours: record.hours })}</span>
		<!-- "{hours} h credited" -->
		{#if record.isMinor && !record.hasConsent}
			<span class="pill warn">{m.shifts_blockedNoConsent()}</span>
			<!-- "Cannot claim until consent is recorded" -->
		{/if}
	</div>
	<div class="fields">
		<label class="check">
			<input type="checkbox" bind:checked={consent} />
			{m.shifts_consentRecorded()}
			<!-- "Guardian consent seen" -->
		</label>
		<input
			type="text"
			placeholder={m.shifts_consentNote()}
			aria-label={m.shifts_consentNoteFor({ name: record.user.displayName })}
			bind:value={consentNote}
		/>
		<label class="check">
			<input type="checkbox" bind:checked={vetting} />
			{m.shifts_vettingChecked()}
			<!-- "Vetting checked" -->
		</label>
		<input
			type="text"
			placeholder={m.shifts_vettingReference()}
			aria-label={m.shifts_vettingReferenceFor({ name: record.user.displayName })}
			bind:value={vettingReference}
		/>
		<input
			type="text"
			class="wide"
			placeholder={m.shifts_emergencyContact()}
			aria-label={m.shifts_emergencyContactFor({ name: record.user.displayName })}
			bind:value={emergency}
		/>
		<button type="submit">{m.common_save()}</button>
	</div>
</form>

<style lang="scss">
	form {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.who {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.82rem;
	}
	.wide {
		min-width: 14rem;
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
	.hours {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
</style>
