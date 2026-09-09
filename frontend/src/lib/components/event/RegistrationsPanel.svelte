<script lang="ts">
	/** Staff view of every registration (AUDIENCE-BRIEF.md §3.3): status, answers, accept /
	 * decline for pending rows (organisers), check-in and undo (any staff member — that is what a
	 * volunteer is for), and the CSV. */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { EdmatEvent, EventAttendee, EventAttendanceStatus } from '$lib/types/event';
	import {
		decideRegistration,
		getRegistrations,
		getRegistrationsCsv,
		setCheckedIn
	} from '$lib/services/events';
	import { downloadText } from '$lib/utils/download';
	import { formatDateTime } from '$lib/utils/datetime';
	import { onMount } from 'svelte';

	let { event, onchanged }: { event: EdmatEvent; onchanged?: () => void } = $props();
	let rows = $state<EventAttendee[]>([]);
	let loading = $state(true);
	let error = $state('');

	const STATUS: Record<EventAttendanceStatus, () => string> = {
		going: m.events_status_going,
		not_going: m.events_status_notGoing,
		pending: m.events_status_pending,
		waitlisted: m.events_status_waitlisted,
		promoted: m.events_status_promoted,
		expired: m.events_status_expired
	};
	onMount(load);
	async function load() {
		try {
			rows = await getRegistrations(event.id);
		} finally {
			loading = false;
		}
	}
	async function act(run: () => Promise<EventAttendee>) {
		error = '';
		try {
			const updated = await run();
			rows = rows.map((r) => (r.id === updated.id ? updated : r));
			onchanged?.();
		} catch {
			error = m.common_error();
		}
	}
	async function exportCsv() {
		downloadText(
			`edmat-event-${event.id}-registrations.csv`,
			await getRegistrationsCsv(event.id),
			'text/csv'
		);
	}
	function answerText(v: unknown): string {
		if (Array.isArray(v)) return v.join(', ');
		if (v === true) return m.common_yes();
		if (v === false || v === undefined || v === null) return '';
		return String(v);
	}
</script>

<section class="registrations">
	<div class="head">
		<h3>{m.events_registrationsHeading({ count: rows.length })}</h3>
		<button type="button" onclick={exportCsv} disabled={rows.length === 0}
			>{m.events_exportCsv()}</button
		>
	</div>
	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if rows.length === 0}
		<p class="status">{m.events_registrationsEmpty()}</p>
	{:else}
		<ul class="rows">
			{#each rows as row (row.id)}
				<li class="row row--{row.status}">
					<div class="who">
						<a href={resolve('/users/[id]', { id: row.attendee.id })}>{row.attendee.displayName}</a>
						<span class="pill pill--{row.status}">{STATUS[row.status]()}</span>
						{#if row.checkedIn}<span class="pill pill--checked">{m.events_checkedIn()}</span>{/if}
						{#if row.registeredBy}<span class="by"
								>{m.events_registeredBy({ name: row.registeredBy.displayName })}</span
							>{/if}
					</div>
					{#if row.note}<p class="note">{row.note}</p>{/if}
					{#if Object.keys(row.answers).length > 0}
						<dl class="answers">
							{#each event.registrationFields as f (f.id)}
								{#if row.answers[f.id] !== undefined && answerText(row.answers[f.id])}
									<dt>{f.label}</dt>
									<dd>{answerText(row.answers[f.id])}</dd>
								{/if}
							{/each}
							{#if row.answers._attendance_mode}<dt>{m.events_reg_attendanceMode()}</dt>
								<dd>
									{row.answers._attendance_mode === 'online'
										? m.events_locationKind_online()
										: m.events_locationKind_onsite()}
								</dd>{/if}
							{#if row.answers._needs}<dt>{m.events_reg_needs()}</dt>
								<dd>{answerText(row.answers._needs)}</dd>{/if}
						</dl>
					{/if}
					<div class="actions">
						{#if row.status === 'pending' && event.canOrganise}
							<button
								type="button"
								class="primary"
								onclick={() => act(() => decideRegistration(event.id, row.id, 'accept'))}
								>{m.events_accept()}</button
							>
							<button
								type="button"
								class="danger"
								onclick={() => act(() => decideRegistration(event.id, row.id, 'decline'))}
								>{m.events_decline()}</button
							>
						{/if}
						{#if row.status === 'going' && event.canCheckIn}
							{#if row.checkedIn}
								<button
									type="button"
									onclick={() => act(() => setCheckedIn(event.id, row.id, false))}
									>{m.events_undoCheckIn()}</button
								>
							{:else}
								<button
									type="button"
									onclick={() => act(() => setCheckedIn(event.id, row.id, true))}
									>{m.events_checkIn()}</button
								>
							{/if}
						{/if}
						{#if row.promotionExpiresAt && row.status === 'promoted'}
							<span class="until"
								>{m.events_seatHeldUntil({ when: formatDateTime(row.promotionExpiresAt) })}</span
							>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style lang="scss">
	.registrations {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	h3 {
		margin: 0;
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
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.danger {
		color: var(--status-danger);
	}
	.rows {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0 0;
		display: grid;
		gap: 0.5rem;
	}
	.row {
		padding: 0.5rem 0.7rem;
		border-radius: 8px;
		background: var(--bg-surface-alt);
	}
	.who {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--bg-surface);
		border: 1px solid var(--border);
	}
	.pill--going,
	.pill--checked {
		background: var(--status-success-bg);
		color: var(--status-success);
		border-color: transparent;
	}
	.pill--pending,
	.pill--waitlisted,
	.pill--promoted {
		background: var(--status-warning-bg);
		color: var(--status-warning);
		border-color: transparent;
	}
	.by,
	.note,
	.until,
	.status {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.note {
		margin: 0.2rem 0;
	}
	.answers {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.15rem 0.8rem;
		margin: 0.3rem 0;
		font-size: 0.85rem;
	}
	.answers dt {
		color: var(--text-secondary);
	}
	.answers dd {
		margin: 0;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.3rem;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
</style>
