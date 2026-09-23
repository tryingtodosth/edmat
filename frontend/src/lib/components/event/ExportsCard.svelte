<script lang="ts">
	/** Exports, minimised (CONFERENCE-BRIEF.md §3.G; backend `events/exports.py`).
	 *
	 * Three things, and which of them an organiser sees is the point of the card: the **needs
	 * summary** is counts with nobody in them, the thing you hand to catering and to the
	 * accessibility desk; the **door list** is a name, a status and a tick, and any staff member
	 * may take it; the **export log** says who took a file that named people. The full CSV stays
	 * where it was, on the panel's own header, and is organisers-only now.
	 *
	 * Both downloads go through the service layer and `utils/download.ts`, so no token ever rides
	 * in a URL.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { EdmatEvent, EventExportLogEntry, EventNeedsSummary } from '$lib/types/event';
	import { getDoorListCsv, getEventNeeds, getExportLog } from '$lib/services/events';
	import { EVENT_EXPORT_KIND_LABELS } from '$lib/utils/labels';
	import { downloadText } from '$lib/utils/download';
	import { formatDateTime } from '$lib/utils/datetime';
	import { onMount } from 'svelte';

	let { event }: { event: EdmatEvent } = $props();
	let needs = $state<EventNeedsSummary | null>(null);
	let log = $state<EventExportLogEntry[]>([]);
	let loading = $state(true);
	let error = $state('');
	let busy = $state(false);

	onMount(load);
	async function load() {
		// Only an organiser may read either of these — a volunteer gets the door-list button and
		// nothing else, which is the whole minimisation in one `if`.
		if (!event.canOrganise) {
			loading = false;
			return;
		}
		try {
			[needs, log] = await Promise.all([getEventNeeds(event.id), getExportLog(event.id)]);
		} catch {
			error = m.common_error(); // "Something went wrong."
		} finally {
			loading = false;
		}
	}
	async function downloadDoorList() {
		error = '';
		busy = true;
		try {
			downloadText(
				`edmat-event-${event.id}-door-list.csv`,
				await getDoorListCsv(event.id),
				'text/csv'
			);
			if (event.canOrganise) log = await getExportLog(event.id);
		} catch {
			error = m.common_error(); // "Something went wrong."
		} finally {
			busy = false;
		}
	}
</script>

<section class="exports">
	<h4>{m.exports_heading()}<!-- "Exports" --></h4>
	<p class="intro">
		{#if event.canOrganise}
			{m.exports_intro()}<!-- "Counts for catering and the door. The file that names people is yours alone, and every download of it is recorded." -->
		{:else}
			{m.exports_introStaff()}<!-- "The list you take to the door. Nothing here says what anybody wrote on their registration." -->
		{/if}
	</p>

	<div class="downloads">
		<button type="button" onclick={downloadDoorList} disabled={busy}
			>{m.exports_doorList()}<!-- "Door list (CSV)" --></button
		>
		<span class="hint"
			>{m.exports_doorListHint()}<!-- "Name, status and checked-in — safe to hand to whoever is on the door." --></span
		>
	</div>

	{#if event.canOrganise}
		{#if loading}
			<p class="status">{m.common_loading()}<!-- "Loading…" --></p>
		{:else if needs}
			<h5>
				{m.exports_needsHeading({ count: needs.total })}<!-- "What they need — going: {count}" -->
			</h5>
			<table class="needs">
				<tbody>
					<tr>
						<th scope="row">{m.exports_modeInPerson()}<!-- "Coming in person" --></th>
						<td>{needs.attendanceMode.inPerson}</td>
					</tr>
					<tr>
						<th scope="row">{m.exports_modeOnline()}<!-- "Joining online" --></th>
						<td>{needs.attendanceMode.online}</td>
					</tr>
					{#if needs.attendanceMode.unstated > 0}
						<tr>
							<th scope="row">{m.exports_modeUnstated()}<!-- "Did not say" --></th>
							<td>{needs.attendanceMode.unstated}</td>
						</tr>
					{/if}
					<tr>
						<th scope="row">{m.exports_accessStated()}<!-- "Stated an accessibility need" --></th>
						<td>{needs.accessibility.stated}</td>
					</tr>
					<tr>
						<th scope="row">{m.exports_accessNone()}<!-- "Stated none" --></th>
						<td>{needs.accessibility.none}</td>
					</tr>
					{#each needs.fields as field (field.fieldId)}
						{#if field.options.length > 0}
							{#each field.options as option (option.option)}
								<tr>
									<th scope="row">{field.label}: {option.option}</th>
									<td>{option.count}</td>
								</tr>
							{/each}
						{:else}
							<tr>
								<th scope="row">{field.label}</th>
								<td
									>{m.exports_answeredOf({
										answered: field.answered,
										total: field.answered + field.unanswered
									})}<!-- "{answered} of {total} answered" --></td
								>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
			<p class="hint">
				{m.exports_accessNote()}<!-- "A count, never the wording: what somebody wrote about their own access needs stays on their registration, where only you can read it." -->
			</p>

			<h5>{m.exports_logHeading()}<!-- "Who took a copy" --></h5>
			{#if log.length === 0}
				<p class="status">
					{m.exports_logEmpty()}<!-- "Nobody has downloaded a file naming people." -->
				</p>
			{:else}
				<ul class="log">
					{#each log as entry (entry.id)}
						<li>
							<span class="kind">{EVENT_EXPORT_KIND_LABELS[entry.kind]()}</span>
							<span class="who"
								>{m.exports_logEntry({
									name: entry.user?.displayName ?? m.exports_logDeletedAccount(), // "a closed account"
									rows: entry.rows,
									when: formatDateTime(entry.createdAt)
								})}<!-- "{name}, {when} · people: {rows}" --></span
							>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="hint">
				{m.exports_retentionNote()}<!-- "Accessibility notes and free-text answers are blanked once the event is 30 days past." -->
			</p>
		{/if}
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style lang="scss">
	.exports {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.6rem 0.8rem;
		margin-top: 0.8rem;
		background: var(--bg-surface-alt);
	}
	h4 {
		margin: 0 0 0.2rem;
		font-size: 0.95rem;
	}
	h5 {
		margin: 0.8rem 0 0.3rem;
		font-size: 0.88rem;
	}
	.intro,
	.hint,
	.status {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin: 0.2rem 0;
	}
	.downloads {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	button {
		min-height: 44px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.needs {
		border-collapse: collapse;
		font-size: 0.85rem;
		width: 100%;
		max-width: 28rem;
	}
	.needs th {
		text-align: left;
		font-weight: 400;
		color: var(--text-secondary);
		padding: 0.15rem 0.6rem 0.15rem 0;
	}
	.needs td {
		text-align: right;
		font-variant-numeric: tabular-nums;
		padding: 0.15rem 0;
	}
	.log {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.25rem;
		font-size: 0.85rem;
	}
	.log li {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.kind {
		font-weight: 600;
	}
	.who {
		color: var(--text-secondary);
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
</style>
