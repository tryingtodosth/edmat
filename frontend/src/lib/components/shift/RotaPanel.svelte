<script lang="ts">
	/** The rota, on the event page (CONFERENCE-BRIEF.md §3.E).
	 *
	 * Two audiences in one panel, because they are one thing seen from two sides: a volunteer sees
	 * their own shifts and the open ones, an organiser sees the same rota as coverage, stations and
	 * records. Splitting them into two routes would have meant an organiser who also takes a shift
	 * — the normal case at a small conference — bouncing between pages to see both.
	 *
	 * **A disabled Claim always says why** (house rule 6): the backend hands every shift its own
	 * `claimBlockReason` in the list response, so the button never has to guess and never has to
	 * ask a second endpoint. The two soft reasons do not disable it at all — they say what the
	 * claim will become.
	 *
	 * The panel renders nothing at all for somebody who is not staff of this event: the API answers
	 * 404 for them (a rota they do not help run does not exist), and a heading over an error is
	 * worse than silence.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { formatDateTime, formatTimeOfDay } from '$lib/utils/datetime';
	import {
		ASSIGNMENT_STATUS_LABELS,
		CLAIM_BLOCK_REASON_LABELS,
		DROP_BLOCK_REASON_LABELS
	} from '$lib/utils/labels';
	import CoverageGrid from './CoverageGrid.svelte';
	import StationEditor from './StationEditor.svelte';
	import VolunteerRecords from './VolunteerRecords.svelte';
	import { getSessions } from '$lib/services/events';
	import {
		assignShift,
		claimShift,
		confirmAssignment,
		createShift,
		createStation,
		deleteShift,
		deleteStation,
		dropShift,
		getCoverage,
		getMyShifts,
		getMyShiftsIcs,
		getStations,
		getVolunteerRecords,
		markDone,
		markNoShow,
		saveVolunteerRecord
	} from '$lib/services/shifts';
	import type {
		CoverageCell,
		MyShifts,
		Station,
		StationDraft,
		VolunteerRecord
	} from '$lib/types/shift';

	// `isStaff` is the event's `canCheckIn` — true for every staff member, volunteers included — so
	// that the panel never asks the rota API on behalf of an attendee or a visitor (a 404 by house
	// rule 4, and a console error the e2e run counts). Found on the merged event page, 2026-09-23.
	let {
		eventId,
		canOrganise,
		isStaff = false
	}: { eventId: string; canOrganise: boolean; isStaff?: boolean } = $props();

	// The programme, only for the station editor's "this station follows that session" picker. Read
	// here rather than handed down from the event page: the page does not hold the sessions either
	// (`Programme.svelte` loads its own), and threading a list through a route just to reach one
	// select would make the mount point wider than the one line CONFERENCE-BRIEF.md §4 rule 3 asks
	// every step to keep it to.
	let sessions = $state<{ id: string; title: string }[]>([]);

	let stations = $state<Station[]>([]);
	let mine = $state<MyShifts | null>(null);
	let coverage = $state<CoverageCell[]>([]);
	let records = $state<VolunteerRecord[]>([]);
	let hidden = $state(false);
	let loaded = $state(false);
	let error = $state('');

	const enabled = $derived(featureFlagsStore.isEnabled('shifts') || authStore.isModerator);

	// The open board: every shift the reader is not already on. A shift they cannot take is still
	// shown, with the reason — "why can I not have that one" is a question the board should answer
	// rather than raise by hiding it.
	const openShifts = $derived(
		stations
			.flatMap((station) => station.shifts)
			.filter((shift) => shift.myAssignment === null)
			.sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
	);

	async function load() {
		// Not merely "do not draw it" — do not ASK. With the flag off the API answers 403 and the
		// browser console logs it, which is a kill switch making noise about a feature it is
		// supposed to have removed. Found by the e2e run's zero-console-errors check, not by any
		// assertion about the panel itself.
		if (!enabled || !(canOrganise || isStaff)) {
			hidden = true;
			loaded = true;
			return;
		}
		try {
			stations = await getStations(eventId);
			mine = await getMyShifts(eventId);
			if (canOrganise) {
				coverage = await getCoverage(eventId);
				records = await getVolunteerRecords(eventId);
				sessions = (await getSessions(eventId)).map((s) => ({ id: s.id, title: s.title }));
			}
			hidden = false;
		} catch (e) {
			// 404 = not staff of this event; 403 = the kill switch. Either way there is nothing to
			// show and nothing to explain here.
			if (e instanceof ApiError && (e.status === 404 || e.status === 403)) hidden = true;
			else error = m.common_error();
		} finally {
			loaded = true;
		}
	}

	// Keyed on the flags having ACTUALLY loaded, not on mount: `isEnabled` fails open until the
	// first `/feature-flags/` response lands (featureFlags.svelte.ts says so), which is right for
	// drawing a link and wrong for firing a request the API will refuse. `isLoaded` exists for
	// exactly this. The `loadedOnce` guard is the standard one — an `$effect` re-fires with no
	// navigation at all (frontend/CLAUDE.md trap 2), and a service call at component top level
	// would run during SSR with no token (trap 5).
	let loadedOnce = $state(false);
	$effect(() => {
		if (!featureFlagsStore.isLoaded || loadedOnce) return;
		loadedOnce = true;
		load();
	});

	async function run(action: () => Promise<unknown>) {
		error = '';
		try {
			await action();
			await load();
		} catch (e) {
			error = reasonOf(e);
		}
	}

	/** The backend answers a refusal with `{reason}`; every one of them has a line here. */
	function reasonOf(e: unknown): string {
		if (e instanceof ApiError) {
			const reason = (e.body as { reason?: string } | undefined)?.reason;
			if (reason && reason in CLAIM_BLOCK_REASON_LABELS) {
				return CLAIM_BLOCK_REASON_LABELS[reason as keyof typeof CLAIM_BLOCK_REASON_LABELS]();
			}
			if (reason && reason in DROP_BLOCK_REASON_LABELS) {
				return DROP_BLOCK_REASON_LABELS[reason as keyof typeof DROP_BLOCK_REASON_LABELS]();
			}
			if (reason === 'note_required') return m.shifts_noteRequired(); // "Say why, when the hours differ from the shift by more than half an hour."
			if (reason === 'no_such_user') return m.shifts_noSuchUser(); // "No account with that number."
			if (reason === 'not_staff') return m.shifts_notStaffYet(); // "Put them on the event's staff first."
			if (reason === 'already_decided') return m.shifts_alreadyDecided(); // "Somebody already decided that one."
			return e.message;
		}
		return m.common_error();
	}

	async function downloadIcs() {
		error = '';
		try {
			const body = await getMyShiftsIcs(eventId);
			const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
			const link = document.createElement('a');
			link.href = url;
			link.download = `my-shifts-${eventId}.ics`;
			link.click();
			URL.revokeObjectURL(url);
		} catch {
			error = m.common_error();
		}
	}
</script>

{#if enabled && !hidden && loaded}
	<section class="rota">
		<header class="head">
			<h2>{m.shifts_heading()}</h2>
			<!-- "Volunteer rota" -->
			<a class="wall" href={resolve('/events/[id]/rota', { id: eventId })}>{m.shifts_wallRota()}</a>
			<!-- "Print the wall rota" -->
		</header>
		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<div class="mine">
			<h3>{m.shifts_myShifts()}</h3>
			<!-- "My shifts" -->
			{#if mine && mine.shifts.length > 0}
				<ul class="my-list">
					{#each mine.shifts as row (row.assignmentId)}
						<li>
							<strong>{row.stationName}</strong>
							<span>{formatDateTime(row.startsAt)}–{formatTimeOfDay(row.endsAt)}</span>
							{#if row.locationText}<span class="where">{row.locationText}</span>{/if}
							<span class="pill">{ASSIGNMENT_STATUS_LABELS[row.status]()}</span>
							{#if row.coVolunteers.length > 0}
								<span class="with"
									>{m.shifts_withPeople({ names: row.coVolunteers.join(', ') })}</span
								>
								<!-- "with {names}" -->
							{/if}
							{#if row.dropBlockReason}
								<button
									type="button"
									class="link"
									disabled
									title={DROP_BLOCK_REASON_LABELS[row.dropBlockReason]()}
								>
									{m.shifts_drop()}
									<!-- "Give it back" -->
								</button>
								<span class="why">{DROP_BLOCK_REASON_LABELS[row.dropBlockReason]()}</span>
							{:else}
								<button
									type="button"
									class="link"
									onclick={() => run(() => dropShift(row.shiftId))}
								>
									{m.shifts_drop()}
									<!-- "Give it back" -->
								</button>
							{/if}
						</li>
					{/each}
				</ul>
				<p class="totals">
					{m.shifts_hoursTotal({ hours: mine.hours })}
					<!-- "{hours} h credited so far" -->
					<button type="button" class="link" onclick={downloadIcs}>{m.shifts_downloadIcs()}</button>
					<!-- "Add to my calendar (.ics)" -->
					<a href={resolve('/events/[id]/certificate', { id: eventId })}>{m.shifts_certificate()}</a
					>
					<!-- "Certificate of service" -->
				</p>
				{#if mine.deskLocation}
					<p class="desk">{m.shifts_deskAt({ where: mine.deskLocation })}</p>
					<!-- "Organiser desk: {where}" -->
				{/if}
			{:else}
				<p class="status">{m.shifts_noShiftsOfMine()}</p>
				<!-- "You have no shifts on this event yet." -->
			{/if}
		</div>

		<div class="open">
			<h3>{m.shifts_openShifts()}</h3>
			<!-- "Open shifts" -->
			{#if openShifts.length === 0}
				<p class="status">{m.shifts_noOpenShifts()}</p>
				<!-- "Nothing open right now." -->
			{/if}
			<ul class="open-list">
				{#each openShifts as shift (shift.id)}
					<li>
						<strong>{shift.stationName}</strong>
						<span>{formatDateTime(shift.startsAt)}–{formatTimeOfDay(shift.endsAt)}</span>
						{#if shift.locationText}<span class="where">{shift.locationText}</span>{/if}
						<span class="count"
							>{m.shifts_placesLeft({
								taken: shift.confirmedCount + shift.claimedCount,
								needed: shift.needed
							})}</span
						>
						<!-- "{taken} of {needed} taken" -->
						<button
							type="button"
							disabled={!shift.canClaim}
							onclick={() => run(() => claimShift(shift.id))}
						>
							{m.shifts_claim()}
							<!-- "Take this shift" -->
						</button>
						{#if shift.claimBlockReason}
							<span class="why">{CLAIM_BLOCK_REASON_LABELS[shift.claimBlockReason]()}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>

		{#if canOrganise}
			<div class="organiser">
				<h3>{m.shifts_coverageHeading()}</h3>
				<!-- "Coverage" -->
				<CoverageGrid cells={coverage} />
				<StationEditor
					{stations}
					{sessions}
					oncreatestation={(draft: StationDraft) => run(() => createStation(eventId, draft))}
					ondeletestation={(id) => run(() => deleteStation(id))}
					oncreateshift={(stationId, startsAt, endsAt, needed) =>
						run(() =>
							createShift(stationId, {
								startsAt: startsAt ?? undefined,
								endsAt: endsAt ?? undefined,
								needed
							})
						)}
					ondeleteshift={(id) => run(() => deleteShift(id))}
					onassign={(shiftId, userId) => run(() => assignShift(shiftId, userId))}
					onconfirm={(shiftId, assignmentId) => run(() => confirmAssignment(shiftId, assignmentId))}
					onnoshow={(shiftId, assignmentId) => run(() => markNoShow(shiftId, assignmentId))}
					ondone={(shiftId, assignmentId, hours, note) =>
						run(() => markDone(shiftId, assignmentId, { hours, note }))}
					ondrop={(shiftId, assignmentId) => run(() => dropShift(shiftId, { assignmentId }))}
				/>
				<VolunteerRecords
					{records}
					onsave={(userId, fields) => run(() => saveVolunteerRecord(eventId, userId, fields))}
				/>
			</div>
		{/if}
	</section>
{/if}

<style lang="scss">
	.rota {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	h2 {
		margin: 0;
		font-size: 1.15rem;
	}
	h3 {
		margin: 0.9rem 0 0.35rem;
		font-size: 1rem;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.87rem;
	}
	.where,
	.with,
	.why,
	.count,
	.status,
	.desk,
	.totals {
		color: var(--text-secondary);
		font-size: 0.82rem;
	}
	.totals {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		margin-top: 0.5rem;
	}
	.pill {
		font-size: 0.72rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
		color: var(--text-secondary);
	}
	.error {
		color: var(--danger, #c62828);
		font-size: 0.85rem;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 0.82rem;
		color: var(--accent, #1565c0);
		cursor: pointer;
		text-decoration: underline;
	}
	.link:disabled {
		color: var(--text-secondary);
		cursor: not-allowed;
	}
</style>
