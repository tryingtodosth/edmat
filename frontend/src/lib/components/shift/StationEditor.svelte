<script lang="ts">
	/** The organiser's half of the rota: the posts, their hours, and who is standing at each.
	 *
	 * Every form inside is its own small component (`ShiftAddForm`, `AssignForm`,
	 * `CreditControls`), which is not decoration — a per-row draft held in a record here would
	 * have to be created inside the template, and a state write during render is something
	 * Svelte 5 refuses outright.
	 *
	 * The minor rules are printed under the form rather than offered as fields, because they are
	 * not configurable: `shifts/rules.py` owns them and an organiser cannot loosen them. Saying so
	 * where the checkbox is, is the difference between a rule and a bug report.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { formatDateTime, formatTimeOfDay } from '$lib/utils/datetime';
	import { STATION_KIND_LABELS } from '$lib/utils/labels';
	import AssignForm from './AssignForm.svelte';
	import CreditControls from './CreditControls.svelte';
	import ShiftAddForm from './ShiftAddForm.svelte';
	import type { Station, StationDraft, StationKind } from '$lib/types/shift';

	let {
		stations,
		sessions = [],
		error = '',
		oncreatestation,
		ondeletestation,
		oncreateshift,
		ondeleteshift,
		onassign,
		onconfirm,
		onnoshow,
		ondone,
		ondrop
	}: {
		stations: Station[];
		sessions?: { id: string; title: string }[];
		error?: string;
		oncreatestation: (draft: StationDraft) => void;
		ondeletestation: (stationId: string) => void;
		oncreateshift: (
			stationId: string,
			startsAt: string | null,
			endsAt: string | null,
			needed: number
		) => void;
		ondeleteshift: (shiftId: string) => void;
		onassign: (shiftId: string, userId: string) => void;
		onconfirm: (shiftId: string, assignmentId: string) => void;
		onnoshow: (shiftId: string, assignmentId: string) => void;
		ondone: (shiftId: string, assignmentId: string, hours: string, note: string) => void;
		ondrop: (shiftId: string, assignmentId: string) => void;
	} = $props();

	const kinds: StationKind[] = ['door', 'room', 'info', 'cloakroom', 'runner', 'setup', 'other'];

	let newName = $state('');
	let newKind = $state<StationKind>('door');
	let newLocation = $state('');
	let newSession = $state('');
	let newMinors = $state(false);
	let newRequiresAdult = $state(false);
	let newNeedsConfirmation = $state(false);

	function addStation(e: SubmitEvent) {
		e.preventDefault();
		if (!newName.trim()) return;
		oncreatestation({
			kind: newKind,
			name: newName.trim(),
			locationText: newLocation.trim(),
			session: newSession || null,
			minorsPermitted: newMinors,
			// The backend refuses "needs an adult" on a station that admits no minors, because the
			// rule could never fire there. Kept in step here so the refusal is never reached.
			requiresAdult: newMinors && newRequiresAdult,
			needsConfirmation: newNeedsConfirmation
		});
		newName = '';
		newLocation = '';
		newSession = '';
		newMinors = false;
		newRequiresAdult = false;
		newNeedsConfirmation = false;
	}
</script>

<section class="stations">
	<h3>{m.shifts_stationsHeading()}</h3>
	<!-- "Stations and shifts" -->
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#each stations as station (station.id)}
		<article class="station">
			<header>
				<h4>{station.name}</h4>
				<span class="pill">{STATION_KIND_LABELS[station.kind]()}</span>
				{#if station.locationText}<span class="where">{station.locationText}</span>{/if}
				{#if station.sessionTitle}
					<span class="pill">{m.shifts_followsSession({ title: station.sessionTitle })}</span>
					<!-- "Follows: {title}" -->
				{/if}
				{#if station.minorsPermitted}
					<span class="pill">{m.shifts_minorsPermitted()}</span>
					<!-- "Under-16s welcome" -->
				{/if}
				{#if station.requiresAdult}
					<span class="pill">{m.shifts_requiresAdult()}</span>
					<!-- "An adult on every shift" -->
				{/if}
				{#if station.needsConfirmation}
					<span class="pill">{m.shifts_needsConfirmation()}</span>
					<!-- "Claims wait for you" -->
				{/if}
				<button type="button" class="link danger" onclick={() => ondeletestation(station.id)}>
					{m.common_remove()}
				</button>
			</header>

			{#if station.shifts.length === 0}
				<p class="status">{m.shifts_noShiftsYet()}</p>
				<!-- "No hours on this station yet." -->
			{/if}
			<ul class="shifts">
				{#each station.shifts as shift (shift.id)}
					<li class:short={shift.isShort}>
						<div class="when">
							<strong>{formatDateTime(shift.startsAt)}</strong>
							<span>–{formatTimeOfDay(shift.endsAt)}</span>
							<span class="count">{shift.confirmedCount}/{shift.needed}</span>
							{#if shift.claimedCount > 0}
								<span class="pill">{m.shifts_awaitingCount({ count: shift.claimedCount })}</span>
								<!-- "{count} waiting for you" -->
							{/if}
							{#if shift.needsAdult}
								<span class="pill warn">{m.shifts_needsAdultFlag()}</span>
								<!-- "Needs an adult on this shift" -->
							{/if}
							<button type="button" class="link danger" onclick={() => ondeleteshift(shift.id)}>
								{m.common_remove()}
							</button>
						</div>
						<ul class="people">
							{#each shift.assignments as assignment (assignment.id)}
								<li>
									<CreditControls
										{assignment}
										shiftHours={shift.hours}
										onconfirm={() => onconfirm(shift.id, assignment.id)}
										onnoshow={() => onnoshow(shift.id, assignment.id)}
										ondone={(hours, note) => ondone(shift.id, assignment.id, hours, note)}
										ondrop={() => ondrop(shift.id, assignment.id)}
									/>
								</li>
							{/each}
						</ul>
						<AssignForm onassign={(userId) => onassign(shift.id, userId)} />
					</li>
				{/each}
			</ul>

			<ShiftAddForm
				followsSession={station.sessionId !== null}
				onadd={(startsAt, endsAt, needed) => oncreateshift(station.id, startsAt, endsAt, needed)}
			/>
		</article>
	{/each}

	<form class="add-station" onsubmit={addStation}>
		<h4>{m.shifts_addStation()}</h4>
		<!-- "Add a station" -->
		<div class="row">
			<input
				type="text"
				placeholder={m.shifts_stationName()}
				aria-label={m.shifts_stationName()}
				bind:value={newName}
			/>
			<select bind:value={newKind} aria-label={m.shifts_stationKind()}>
				{#each kinds as kind (kind)}
					<option value={kind}>{STATION_KIND_LABELS[kind]()}</option>
				{/each}
			</select>
			<input
				type="text"
				placeholder={m.shifts_stationLocation()}
				aria-label={m.shifts_stationLocation()}
				bind:value={newLocation}
			/>
		</div>
		<div class="row">
			{#if sessions.length > 0}
				<select bind:value={newSession} aria-label={m.shifts_stationSession()}>
					<option value="">{m.shifts_noSession()}</option>
					<!-- "Its own hours" -->
					{#each sessions as session (session.id)}
						<option value={session.id}>{session.title}</option>
					{/each}
				</select>
			{/if}
			<label class="check">
				<input type="checkbox" bind:checked={newMinors} />
				{m.shifts_minorsPermitted()}
				<!-- "Under-16s welcome" -->
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={newRequiresAdult} disabled={!newMinors} />
				{m.shifts_requiresAdult()}
				<!-- "An adult on every shift" -->
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={newNeedsConfirmation} />
				{m.shifts_needsConfirmation()}
				<!-- "Claims wait for you" -->
			</label>
			<button type="submit">{m.shifts_addStation()}</button>
			<!-- "Add a station" -->
		</div>
		<p class="hint">{m.shifts_minorRulesHint()}</p>
		<!-- "Under-16s never get a shift touching 22:00–06:00, more than 7 hours in a day, or any shift before consent is recorded. Those limits are fixed." -->
	</form>
</section>

<style lang="scss">
	.stations {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	h3 {
		margin: 0 0 0.6rem;
	}
	.station {
		border-top: 1px solid var(--border);
		padding: 0.7rem 0;
	}
	.station header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	h4 {
		margin: 0;
		font-size: 1rem;
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
	.where {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0 0;
	}
	.shifts > li {
		border-left: 3px solid var(--border);
		padding: 0.35rem 0 0.35rem 0.55rem;
		margin-bottom: 0.5rem;
	}
	.shifts > li.short {
		border-left-color: #ef6c00;
	}
	.when {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.86rem;
	}
	.count {
		font-variant-numeric: tabular-nums;
	}
	.add-station {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		border-top: 1px solid var(--border);
		padding-top: 0.7rem;
	}
	.row {
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
	.hint,
	.status {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin: 0.35rem 0 0;
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
		font-size: 0.8rem;
		color: var(--accent, #1565c0);
		cursor: pointer;
		text-decoration: underline;
	}
	.link.danger {
		color: var(--danger, #c62828);
	}
</style>
