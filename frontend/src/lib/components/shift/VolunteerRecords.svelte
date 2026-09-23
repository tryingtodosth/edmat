<script lang="ts">
	/** What an organiser has seen, recorded as fields — never as files.
	 *
	 * The research report wants scans of a guardian's signed consent form and of a criminal-record
	 * certificate on file. This stores neither (CONFERENCE-BRIEF.md §6 rule 5): "consent recorded,
	 * on this date, by this organiser" carries the fact an inspector asks about without turning a
	 * community exercise database into a place worth attacking for other people's documents.
	 *
	 * A volunteer with no record row yet is listed anyway, with the consent box unticked — that
	 * blank is exactly why they cannot claim anything, and an absent row would have said nothing.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import VolunteerRecordRow from './VolunteerRecordRow.svelte';
	import type { VolunteerRecord } from '$lib/types/shift';

	let {
		records,
		error = '',
		onsave
	}: {
		records: VolunteerRecord[];
		error?: string;
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
</script>

<section class="records">
	<h3>{m.shifts_recordsHeading()}</h3>
	<!-- "Volunteers and what is on file" -->
	<p class="hint">{m.shifts_recordsHint()}</p>
	<!-- "Fields only: EdMat never stores a scan of a consent form or of a criminal-record certificate." -->
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if records.length === 0}
		<p class="status">{m.shifts_recordsEmpty()}</p>
		<!-- "Nobody is on this event as a volunteer yet." -->
	{/if}
	<ul>
		{#each records as record (record.user.id)}
			<li>
				<VolunteerRecordRow {record} {onsave} />
				{#if record.consentRecordedAt}
					<span class="stamp"
						>{m.shifts_consentOn({ date: formatDate(record.consentRecordedAt) })}</span
					>
					<!-- "Consent recorded {date}" -->
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style lang="scss">
	.records {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	h3 {
		margin: 0 0 0.3rem;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
	}
	li {
		border-top: 1px solid var(--border);
		padding: 0.5rem 0;
	}
	.hint,
	.status,
	.stamp {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.error {
		color: var(--danger, #c62828);
		font-size: 0.85rem;
	}
</style>
