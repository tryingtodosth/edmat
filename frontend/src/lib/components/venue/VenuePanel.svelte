<script lang="ts">
	/** The organiser's half of the room booking (CONFERENCE-BRIEF.md §3.A): pick a building and a
	 * room, ask for it, and see the answer. The building's half is `/venues/[slug]/manage`.
	 *
	 * Every refusal is rendered as its own sentence, looked up from `VENUE_BLOCK_LABELS` — the API
	 * hands back a WORD (`room_busy`, `over_fire_capacity`), never a boolean, because "the room is
	 * taken" and "you are bringing more people than the fire instruction allows" are two completely
	 * different things to do about (house rule 6).
	 *
	 * The number inputs are `type="text" inputmode="numeric"` on purpose: `bind:value` on a real
	 * `<input type="number">` binds a number or `undefined`, which is the trap frontend/CLAUDE.md
	 * lists first and which has produced `.trim is not a function` on a live submit four times.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { formatDateTime } from '$lib/utils/datetime';
	import { ROOM_BOOKING_STATUS_LABELS, VENUE_BLOCK_LABELS } from '$lib/utils/labels';
	import {
		cancelBooking,
		getEventBookings,
		getVenue,
		getVenues,
		requestRoom,
		VenueRefusedError
	} from '$lib/services/venues';
	import type { Room, RoomBooking, VenueSummary } from '$lib/types/venue';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';

	let {
		eventId,
		canOrganise,
		startsAt = null,
		endsAt = null,
		onchanged
	}: {
		eventId: string;
		canOrganise: boolean;
		startsAt?: string | null;
		endsAt?: string | null;
		onchanged?: () => void;
	} = $props();

	// The kill switch is checked HERE rather than by wrapping this panel in `FeatureGate` on the
	// event page, and that is a bug fix rather than a preference: `FeatureGate` renders a
	// "this feature is unavailable" NOTICE in place of what it wraps, which is right for a whole
	// route and wrong for a panel — with the switch off the event page grew two grey paragraphs in
	// the middle of somebody else's page. House rule 3 says a killed feature takes its own surface
	// away; it does not leave a sign where it used to be. Found by looking at the screenshot.
	// `isModerator` mirrors the backend's own `is_staff` bypass, exactly as `FeatureGate` does.
	let venuesOn = $derived(featureFlagsStore.isEnabled('venues') || authStore.isModerator);

	let bookings = $state<RoomBooking[]>([]);
	let venues = $state<VenueSummary[]>([]);
	let rooms = $state<Room[]>([]);
	let loaded = $state(false);
	let busy = $state(false);
	let error = $state('');

	let venueId = $state('');
	let roomId = $state('');
	let from = $state('');
	let until = $state('');
	let headcount = $state('');
	let purpose = $state('');

	/** A `datetime-local` value wants `YYYY-MM-DDTHH:mm` in local time; an ISO instant from the API
	 *  is UTC with a `Z`. Converting through the Date gives the organiser the hours they see on the
	 *  event page rather than the ones the server stores. */
	function toLocalInput(iso: string | null): string {
		if (!iso) return '';
		const at = new Date(iso);
		if (Number.isNaN(at.getTime())) return '';
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
	}

	let loadedForEvent = $state('');
	// The id-changed guard frontend/CLAUDE.md trap 2 requires: an `$effect` reading a prop re-fires
	// with no navigation at all, and without this the panel refetches in a loop.
	$effect(() => {
		// Not merely a render guard: with the switch off every request below is a 403, and a panel
		// that is not going to be shown should not be asking.
		if (!venuesOn || eventId === loadedForEvent) return;
		loadedForEvent = eventId;
		void load();
	});

	async function load() {
		// Do not ASK for what the API will refuse: the bookings list is 401 to a signed-out visitor,
		// and the e2e zero-console-errors check on the merged event page found exactly that
		// (integration, 2026-09-23). A visitor sees no venue panel; a signed-in reader sees the
		// approved booking; an organiser sees the rest.
		if (authStore.user) {
			try {
				bookings = await getEventBookings(eventId);
			} catch {
				bookings = [];
			}
		}
		if (canOrganise) {
			try {
				venues = await getVenues();
			} catch {
				venues = [];
			}
			from = from || toLocalInput(startsAt);
			until = until || toLocalInput(endsAt);
		}
		loaded = true;
	}

	async function pickVenue(id: string) {
		venueId = id;
		roomId = '';
		rooms = [];
		if (!id) return;
		try {
			rooms = (await getVenue(id)).rooms.filter((room) => room.isActive);
		} catch {
			rooms = [];
		}
	}

	function say(e: unknown): string {
		if (e instanceof VenueRefusedError) {
			const line = VENUE_BLOCK_LABELS[e.reason];
			if (line) return line();
		}
		return m.venues_error(); // "That did not work. Try again."
	}

	async function ask(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!roomId || !from || !until) return;
		busy = true;
		try {
			await requestRoom({
				eventId,
				roomId,
				startsAt: new Date(from).toISOString(),
				endsAt: new Date(until).toISOString(),
				expectedHeadcount: Number(headcount.trim() || '0') || 0,
				purpose: purpose.trim()
			});
			bookings = await getEventBookings(eventId);
			purpose = '';
			onchanged?.();
		} catch (e) {
			error = say(e);
		} finally {
			busy = false;
		}
	}

	async function withdraw(bookingId: string) {
		error = '';
		busy = true;
		try {
			await cancelBooking(bookingId);
			bookings = await getEventBookings(eventId);
			onchanged?.();
		} catch (e) {
			error = say(e);
		} finally {
			busy = false;
		}
	}

	let chosenRoom = $derived(rooms.find((room) => room.id === roomId) ?? null);
</script>

{#if venuesOn && loaded && (canOrganise || bookings.length > 0)}
	<section class="venue-panel">
		<h3>{m.venues_panelTitle()}</h3>
		<!-- "Venue and room" -->
		{#if canOrganise}
			<p class="hint">{m.venues_panelIntro()}</p>
			<!-- "Ask a building for a room. The building answers; an approved booking is what links this event to a venue." -->
		{/if}

		{#if bookings.length === 0}
			<p class="hint">{m.venues_noBookings()}</p>
			<!-- "No room has been asked for yet." -->
		{:else}
			<ul class="bookings">
				{#each bookings as booking (booking.id)}
					<li class="booking booking--{booking.status}">
						<div class="booking__where">
							<a href={resolve('/venues/[slug]', { slug: booking.venue.slug })}>
								{booking.venue.name}
							</a>
							<strong>{booking.room.name}</strong>
							<span class="pill">{ROOM_BOOKING_STATUS_LABELS[booking.status]()}</span>
						</div>
						<div class="booking__when">
							{m.venues_bookingFor()}
							<!-- "Booked for" -->
							{formatDateTime(booking.startsAt)} — {formatDateTime(booking.endsAt)}
						</div>
						{#if booking.note}
							<p class="booking__note">
								{#if booking.decidedBy}
									<span class="who">{m.venues_decidedBy()} {booking.decidedBy.displayName}:</span>
									<!-- "Answered by" -->
								{/if}
								{booking.note}
							</p>
						{/if}
						{#if canOrganise && (booking.status === 'requested' || booking.status === 'approved')}
							<button
								type="button"
								class="link danger"
								disabled={busy}
								onclick={() => withdraw(booking.id)}
							>
								{m.venues_cancelRequest()}
								<!-- "Withdraw this request" -->
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if canOrganise}
			<form class="ask" onsubmit={ask}>
				<label>
					<span>{m.venues_pickVenue()}</span>
					<!-- "Building" -->
					<select value={venueId} onchange={(e) => pickVenue(e.currentTarget.value)}>
						<option value="">{m.venues_pickPrompt()}</option>
						<!-- "Choose…" -->
						{#each venues as venue (venue.id)}
							<option value={venue.id}>{venue.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>{m.venues_pickRoom()}</span>
					<!-- "Room" -->
					<select bind:value={roomId} disabled={rooms.length === 0}>
						<option value="">{m.venues_pickPrompt()}</option>
						<!-- "Choose…" -->
						{#each rooms as room (room.id)}
							<option value={room.id}>
								{room.name} — {m.venues_fire()}
								<!-- "Fire capacity" -->
								{room.fireCapacity}
							</option>
						{/each}
					</select>
				</label>
				<label>
					<span>{m.venues_from()}</span>
					<!-- "From" -->
					<input type="datetime-local" bind:value={from} required />
				</label>
				<label>
					<span>{m.venues_until()}</span>
					<!-- "Until" -->
					<input type="datetime-local" bind:value={until} required />
				</label>
				<label>
					<span>{m.venues_headcount()}</span>
					<!-- "People expected" -->
					<input type="text" inputmode="numeric" pattern="[0-9]*" bind:value={headcount} />
				</label>
				<label class="wide">
					<span>{m.venues_purpose()}</span>
					<!-- "What it is for" -->
					<input type="text" bind:value={purpose} maxlength="300" />
				</label>
				{#if chosenRoom}
					<p class="hint wide">
						{m.venues_seated()}
						<!-- "Seats" -->
						{chosenRoom.seatedCapacity} · {m.venues_fire()}
						<!-- "Fire capacity" -->
						{chosenRoom.fireCapacity}
						{#if chosenRoom.accessible}· {m.venues_accessible()}{/if}
						<!-- "Step-free access" -->
						{#if chosenRoom.hasAv}· {m.venues_hasAv()}{/if}
						<!-- "AV equipment" -->
					</p>
				{/if}
				<button type="submit" class="wide" disabled={busy || !roomId}>
					{busy ? m.venues_requesting() : m.venues_request()}
					<!-- "Asking…" / "Ask for this room" -->
				</button>
			</form>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</section>
{/if}

<style lang="scss">
	.venue-panel {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	h3 {
		margin: 0 0 0.25rem;
	}
	.hint {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin: 0.25rem 0;
	}
	.error {
		font-size: 0.9rem;
		color: var(--status-danger);
	}
	.bookings {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0;
		display: grid;
		gap: 0.6rem;
	}
	.booking {
		border-left: 3px solid var(--border);
		padding-left: 0.6rem;
	}
	.booking--approved {
		border-left-color: var(--status-success, var(--accent));
	}
	.booking--rejected {
		border-left-color: var(--status-danger);
	}
	.booking__where {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.booking__when {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.booking__note {
		margin: 0.25rem 0;
		font-size: 0.9rem;
	}
	.who {
		color: var(--text-secondary);
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.ask {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.6rem;
		margin-top: 0.6rem;
	}
	.ask label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	.wide {
		grid-column: 1 / -1;
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
