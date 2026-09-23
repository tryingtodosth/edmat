<script lang="ts">
	/**
	 * The building's own desk: who runs it, its rooms, the requests waiting for an answer, and the
	 * checklists it hands organisers.
	 *
	 * Authority is the API's answer (`venue.canAdminister`), never derived here — this page hides
	 * controls, the backend refuses them. A porter who opens this URL sees the queue and the staff
	 * list read-only, which is exactly what `is_venue_staff` grants them.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import { formatDateTime } from '$lib/utils/datetime';
	import {
		ROOM_BOOKING_STATUS_LABELS,
		VENUE_BLOCK_LABELS,
		VENUE_ROLES,
		VENUE_ROLE_LABELS
	} from '$lib/utils/labels';
	import {
		addVenueStaff,
		createRoom,
		decideBooking,
		getVenueBookings,
		getVenueBySlug,
		getVenueStaff,
		getVenueTemplates,
		removeVenueStaff,
		retireRoom,
		VenueRefusedError
	} from '$lib/services/venues';
	import type {
		ChecklistTemplate,
		RoomBooking,
		Venue,
		VenueRole,
		VenueStaffMember
	} from '$lib/types/venue';

	let venue = $state<Venue | null>(null);
	let staff = $state<VenueStaffMember[]>([]);
	let bookings = $state<RoomBooking[]>([]);
	let templates = $state<ChecklistTemplate[]>([]);
	let loading = $state(true);
	let denied = $state(false);
	let error = $state('');
	let busy = $state('');

	let newUserId = $state('');
	let newRole = $state<VenueRole>('administrator');
	let roomName = $state('');
	let roomNumber = $state('');
	let roomFloor = $state('');
	let roomSeated = $state('');
	let roomFire = $state('');
	let decisionNotes = $state<Record<string, string>>({});

	let loadedFor = $state('');
	$effect(() => {
		const slug = page.params.slug ?? '';
		if (!slug || slug === loadedFor) return;
		loadedFor = slug;
		void load(slug);
	});

	async function load(slug: string) {
		loading = true;
		denied = false;
		try {
			venue = await getVenueBySlug(slug);
			if (!venue) {
				denied = true;
				return;
			}
			[staff, bookings, templates] = await Promise.all([
				getVenueStaff(venue.id).catch(() => []),
				getVenueBookings(venue.id).catch(() => []),
				getVenueTemplates(venue.id).catch(() => [])
			]);
		} catch {
			denied = true;
		} finally {
			loading = false;
		}
	}

	function say(e: unknown): string {
		if (e instanceof VenueRefusedError) {
			const line = VENUE_BLOCK_LABELS[e.reason];
			if (line) return line();
		}
		return m.venues_error(); // "That did not work. Try again."
	}

	async function run(key: string, work: () => Promise<unknown>) {
		error = '';
		busy = key;
		try {
			await work();
			if (venue) {
				[staff, bookings] = await Promise.all([
					getVenueStaff(venue.id).catch(() => []),
					getVenueBookings(venue.id).catch(() => [])
				]);
				venue = await getVenueBySlug(venue.slug);
			}
		} catch (e) {
			error = say(e);
		} finally {
			busy = '';
		}
	}

	function addStaff(event: SubmitEvent) {
		event.preventDefault();
		const id = newUserId.trim();
		if (!id || !venue) return;
		void run('staff', async () => {
			await addVenueStaff(venue!.id, id, newRole);
			newUserId = '';
		});
	}

	function addRoom(event: SubmitEvent) {
		event.preventDefault();
		const name = roomName.trim();
		if (!name || !venue) return;
		void run('room', async () => {
			await createRoom(venue!.id, {
				name,
				number: roomNumber.trim(),
				floor: roomFloor.trim(),
				seatedCapacity: Number(roomSeated.trim() || '0') || 0,
				fireCapacity: Number(roomFire.trim() || '0') || 0
			});
			roomName = '';
			roomNumber = '';
			roomFloor = '';
			roomSeated = '';
			roomFire = '';
		});
	}

	let waiting = $derived(bookings.filter((b) => b.status === 'requested'));
	let decided = $derived(bookings.filter((b) => b.status !== 'requested'));
</script>

<PageHead
	title={venue ? `${venue.name} — ${m.venues_manageTitle()}` : m.venues_manageTitle()}
	description={m.venues_manageIntro()}
	noindex
/>
<!-- `noindex`: a building's own desk is not something for a search engine to carry. -->

<FeatureGate feature="venues">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if denied || !venue}
			<p class="status">{m.venues_notFound()}</p>
			<!-- "No such venue." -->
		{:else}
			<p class="back">
				<a href={resolve('/venues/[slug]', { slug: venue.slug })}>{venue.name}</a>
			</p>
			<h1>{m.venues_manageTitle()}</h1>
			<!-- "Running this building" -->
			<p class="intro">{m.venues_manageIntro()}</p>
			<!-- "Staff, rooms, the requests waiting for an answer, and the checklists you hand organisers." -->

			{#if !venue.canAdminister}
				<p class="status warn">{m.venues_notYours()}</p>
				<!-- "You do not run this building." -->
			{/if}

			<section>
				<h2>{m.venues_manageQueue()}</h2>
				<!-- "Room requests" -->
				{#if waiting.length === 0}
					<p class="status">{m.venues_queueEmpty()}</p>
					<!-- "Nothing is waiting for an answer." -->
				{:else}
					<ul class="rows">
						{#each waiting as booking (booking.id)}
							<li class="row">
								<div>
									<strong>{booking.room.name}</strong> — {booking.eventTitle}
								</div>
								<div class="meta">
									{formatDateTime(booking.startsAt)} — {formatDateTime(booking.endsAt)} ·
									{booking.expectedHeadcount}/{booking.room.fireCapacity}
									{m.venues_headcountVsFire()}
									<!-- "of the room's fire capacity" -->
								</div>
								{#if booking.purpose}<p class="notes">{booking.purpose}</p>{/if}
								{#if venue.canAdminister}
									<div class="decide">
										<input
											type="text"
											placeholder={m.venues_decisionNotePlaceholder()}
											aria-label={m.venues_decisionNote()}
											value={decisionNotes[booking.id] ?? ''}
											oninput={(e) =>
												(decisionNotes = {
													...decisionNotes,
													[booking.id]: e.currentTarget.value
												})}
										/>
										<button
											type="button"
											disabled={busy === booking.id}
											onclick={() =>
												run(booking.id, () =>
													decideBooking(booking.id, 'approve', decisionNotes[booking.id] ?? '')
												)}
										>
											{m.venues_approve()}
											<!-- "Approve" -->
										</button>
										<button
											type="button"
											class="danger"
											disabled={busy === booking.id}
											onclick={() =>
												run(booking.id, () =>
													decideBooking(booking.id, 'reject', decisionNotes[booking.id] ?? '')
												)}
										>
											{m.venues_reject()}
											<!-- "Refuse" -->
										</button>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if decided.length > 0}
					<ul class="rows rows--quiet">
						{#each decided as booking (booking.id)}
							<li class="row">
								<div>
									<strong>{booking.room.name}</strong> — {booking.eventTitle}
									<span class="pill">{ROOM_BOOKING_STATUS_LABELS[booking.status]()}</span>
								</div>
								<div class="meta">
									{formatDateTime(booking.startsAt)} — {formatDateTime(booking.endsAt)}
								</div>
								{#if booking.note}<p class="notes">{booking.note}</p>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section>
				<h2>{m.venues_manageStaff()}</h2>
				<!-- "Who runs it" -->
				<p class="hint">{m.venues_roleHint()}</p>
				<!-- "An administrator decides bookings, edits rooms and signs checklist items off. A porter sees the same lists and ticks nothing." -->
				<ul class="rows">
					{#each staff as row (row.id)}
						<li class="row row--inline">
							<a href={resolve('/users/[id]', { id: row.user.id })}>{row.user.displayName}</a>
							<span class="pill">{VENUE_ROLE_LABELS[row.role]()}</span>
							{#if row.addedBy}
								<span class="meta">{m.venues_staffAddedBy()} {row.addedBy.displayName}</span>
								<!-- "Added by" -->
							{/if}
							{#if venue.canAdminister}
								<button
									type="button"
									class="link danger"
									disabled={busy === row.id}
									onclick={() => run(row.id, () => removeVenueStaff(venue!.id, row.id))}
								>
									{m.venues_staffRemove()}
									<!-- "Remove" -->
								</button>
							{/if}
						</li>
					{/each}
				</ul>
				{#if venue.canAdminister}
					<form class="inline-form" onsubmit={addStaff}>
						<label>
							<span>{m.venues_staffAccountId()}</span>
							<!-- "Account id" -->
							<input type="text" inputmode="numeric" pattern="[0-9]*" bind:value={newUserId} />
						</label>
						<label>
							<span>{m.venues_staffRole()}</span>
							<!-- "Role" -->
							<select bind:value={newRole}>
								{#each VENUE_ROLES as role (role)}
									<option value={role}>{VENUE_ROLE_LABELS[role]()}</option>
								{/each}
							</select>
						</label>
						<button type="submit" disabled={busy === 'staff'}>{m.venues_staffAdd()}</button>
						<!-- "Add" -->
					</form>
					<p class="hint">{m.venues_staffAccountIdHint()}</p>
					<!-- "There is no people search yet, so a person is added by the number on their profile." -->
				{/if}
			</section>

			<section>
				<h2>{m.venues_manageRooms()}</h2>
				<!-- "Rooms" -->
				<p class="hint">{m.venues_capacityNote()}</p>
				<!-- "Seats are chairs; the fire capacity is how many people the building’s fire safety instruction allows in the room at once." -->
				<ul class="rows">
					{#each venue.rooms as room (room.id)}
						<li class="row row--inline">
							<strong>{room.name}</strong>
							<span class="meta">{m.venues_seated()}: {room.seatedCapacity}</span>
							<!-- "Seats" -->
							<span class="meta">{m.venues_fire()}: {room.fireCapacity}</span>
							<!-- "Fire capacity" -->
							{#if !room.isActive}<span class="pill pill--off">{m.venues_roomRetired()}</span>{/if}
							<!-- "Retired" -->
							{#if venue.canAdminister && room.isActive}
								<button
									type="button"
									class="link danger"
									disabled={busy === room.id}
									onclick={() => run(room.id, () => retireRoom(room.id))}
								>
									{m.venues_roomRetire()}
									<!-- "Retire this room" -->
								</button>
							{/if}
						</li>
					{/each}
				</ul>
				{#if venue.canAdminister}
					<form class="inline-form" onsubmit={addRoom}>
						<label>
							<span>{m.venues_roomName()}</span>
							<!-- "Name" -->
							<input type="text" bind:value={roomName} />
						</label>
						<label>
							<span>{m.venues_roomNumber()}</span>
							<!-- "Room number" -->
							<input type="text" bind:value={roomNumber} />
						</label>
						<label>
							<span>{m.venues_roomFloor()}</span>
							<!-- "Floor" -->
							<input type="text" bind:value={roomFloor} />
						</label>
						<label>
							<span>{m.venues_seated()}</span>
							<!-- "Seats" -->
							<input type="text" inputmode="numeric" pattern="[0-9]*" bind:value={roomSeated} />
						</label>
						<label>
							<span>{m.venues_fire()}</span>
							<!-- "Fire capacity" -->
							<input type="text" inputmode="numeric" pattern="[0-9]*" bind:value={roomFire} />
						</label>
						<button type="submit" disabled={busy === 'room'}>{m.venues_roomAdd()}</button>
						<!-- "Add a room" -->
					</form>
				{/if}
			</section>

			<section>
				<h2>{m.venues_manageTemplates()}</h2>
				<!-- "Checklists" -->
				{#if templates.length === 0}
					<p class="status">{m.venues_noTemplates()}</p>
					<!-- "This building has not written a checklist of its own; the platform’s starter checklists are offered instead." -->
				{:else}
					<ul class="rows">
						{#each templates as template (template.id)}
							<li class="row row--inline">
								<strong>{template.name}</strong>
								<span class="meta">
									{template.items.length}
									{m.venues_templateItems()} · {m.venues_templateVersion()}
									<!-- "items / Edition" -->
									{template.version}
								</span>
								{#if !template.venueId}
									<span class="pill pill--off">EdMat</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if error}<p class="error" role="alert">{error}</p>{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 820px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-4) var(--space-8);
	}
	.status,
	.hint,
	.meta,
	.notes,
	.intro {
		color: var(--text-secondary);
	}
	.hint,
	.meta,
	.notes {
		font-size: 0.85rem;
	}
	.warn,
	.error {
		color: var(--status-danger);
	}
	.back {
		margin: 0 0 0.4rem;
	}
	section {
		margin-top: var(--space-6);
	}
	.rows {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0;
		display: grid;
		gap: 0.6rem;
	}
	.rows--quiet {
		opacity: 0.75;
	}
	.row {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
	}
	.row--inline {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
	}
	.notes {
		margin: 0.2rem 0 0;
	}
	.decide {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.4rem;
	}
	.decide input {
		flex: 1 1 220px;
	}
	.inline-form {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: flex-end;
	}
	.inline-form label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.8rem;
	}
	.pill {
		font-size: 0.72rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.pill--off {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-secondary);
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		color: var(--accent);
		font: inherit;
	}
	.danger {
		color: var(--status-danger);
	}
</style>
