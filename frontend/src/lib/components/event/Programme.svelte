<script lang="ts">
	/** The programme (AUDIENCE-BRIEF.md §3.2): sessions grouped by day, or laid on the week grid
	 * `CalendarWeek` already draws for bookings; per session its speakers, its links grouped by
	 * role, a bookmark, "add these exercises to My Set", and a Q&A thread. Organisers get tracks
	 * and the session editor inline — the same page, not an admin route, because a programme is
	 * built while looking at it. */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { EdmatEvent, Session, SessionDraft, Track } from '$lib/types/event';
	import {
		createSession,
		createTrack,
		deleteSession,
		deleteTrack,
		getEventIcs,
		getSessions,
		getTracks,
		setSessionBookmark,
		setSessionSeat,
		updateSession
	} from '$lib/services/events';
	import { authStore } from '$lib/state/auth.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import { formatDate, formatTimeOfDay } from '$lib/utils/datetime';
	import { downloadText } from '$lib/utils/download';
	import {
		SESSION_KIND_LABELS,
		SESSION_LINK_ROLES,
		SESSION_LINK_ROLE_LABELS
	} from '$lib/utils/labels';
	import { ApiError } from '$lib/api/client';
	import CalendarWeek from '$lib/components/booking/CalendarWeek.svelte';
	import { isoDate, startOfWeek, dayRange } from '$lib/components/booking/calendar';
	import type { CalendarEntry } from '$lib/components/booking/calendar';
	import { displayPrefs } from '$lib/state/displayPrefs.svelte';
	import SessionEditor from './SessionEditor.svelte';
	import SessionQA from './SessionQA.svelte';

	let { event }: { event: EdmatEvent } = $props();

	let sessions = $state<Session[]>([]);
	let tracks = $state<Track[]>([]);
	let loading = $state(true);
	let view = $state<'list' | 'week'>('list');
	let editing = $state<Session | null | 'new'>(null);
	let busy = $state(false);
	let error = $state('');
	let openQA = $state<Record<string, boolean>>({});
	let added = $state<Record<string, number>>({});
	let newTrack = $state('');

	onMount(async () => {
		try {
			[sessions, tracks] = await Promise.all([getSessions(event.id), getTracks(event.id)]);
		} finally {
			loading = false;
		}
	});

	const trackById = $derived(Object.fromEntries(tracks.map((t) => [t.id, t])));
	const days = $derived.by(() => {
		const groups: Record<string, Session[]> = {};
		for (const s of sessions) {
			const day = isoDate(new Date(s.startsAt));
			groups[day] = [...(groups[day] ?? []), s];
		}
		return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
	});
	const weekDays = $derived.by(() => {
		if (sessions.length === 0) return [] as string[];
		const first = startOfWeek(new Date(sessions[0].startsAt), displayPrefs.weekStartsOn);
		return dayRange(first, 7);
	});
	const entries = $derived<CalendarEntry[]>(
		sessions.map((s) => ({
			id: s.id,
			date: isoDate(new Date(s.startsAt)),
			start: s.startsAt,
			end: s.endsAt,
			label: s.title,
			sublabel: s.trackId ? trackById[s.trackId]?.name : undefined,
			tone: 'event',
			interactive: true
		}))
	);

	function linksByRole(s: Session) {
		return SESSION_LINK_ROLES.map((role) => ({
			role,
			links: s.links.filter((l) => l.role === role)
		})).filter((g) => g.links.length > 0);
	}
	function linkHref(l: Session['links'][number]): string {
		if (l.kind === 'material' && l.materialId)
			return resolve('/materials/[id]', { id: l.materialId });
		if (l.kind === 'exercise' && l.exerciseId)
			return resolve('/exercises/[id]', { id: l.exerciseId });
		if (l.kind === 'set' && l.setSlug) return resolve('/sets/[id]', { id: l.setSlug });
		return l.url;
	}
	function exerciseIds(s: Session): string[] {
		return s.links.filter((l) => l.exerciseId).map((l) => l.exerciseId as string);
	}
	function addToSet(s: Session) {
		added = { ...added, [s.id]: guestSetStore.addMany(exerciseIds(s)) };
	}
	let seatError = $state<Record<string, string>>({});
	async function toggleSeat(s: Session) {
		seatError = { ...seatError, [s.id]: '' };
		try {
			const r = await setSessionSeat(event.id, s.id, !s.isRegistered);
			sessions = sessions.map((x) =>
				x.id === s.id ? { ...x, isRegistered: r.registered, registeredCount: r.registeredCount } : x
			);
		} catch (e) {
			const detail =
				e instanceof ApiError
					? String((e.body as { detail?: string } | undefined)?.detail ?? '')
					: '';
			seatError = {
				...seatError,
				[s.id]:
					detail === 'not_going'
						? m.events_seatNeedsGoing()
						: detail === 'session_full'
							? m.events_sessionFull()
							: m.common_error()
			};
		}
	}
	async function toggleBookmark(s: Session) {
		if (!authStore.isAuthenticated) return;
		const updated = await setSessionBookmark(event.id, s.id, !s.isBookmarked);
		sessions = sessions.map((x) => (x.id === s.id ? updated : x));
	}
	async function save(draft: SessionDraft) {
		busy = true;
		error = '';
		try {
			if (editing === 'new') {
				const created = await createSession(event.id, draft);
				sessions = [...sessions, created].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
			} else if (editing) {
				const updated = await updateSession(event.id, editing.id, draft);
				sessions = sessions
					.map((x) => (x.id === updated.id ? updated : x))
					.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
			}
			editing = null;
		} catch (e) {
			error =
				e instanceof ApiError
					? Object.values(e.body ?? {})
							.flat()
							.join(' ') || m.common_error()
					: m.common_error();
		} finally {
			busy = false;
		}
	}
	async function remove(s: Session) {
		if (!confirm(m.events_sessionRemoveConfirm({ title: s.title }))) return;
		await deleteSession(event.id, s.id);
		sessions = sessions.filter((x) => x.id !== s.id);
	}
	async function addTrack() {
		const name = newTrack.trim();
		if (!name) return;
		try {
			tracks = [...tracks, await createTrack(event.id, name)];
			newTrack = '';
		} catch {
			error = m.common_error();
		}
	}
	async function removeTrack(t: Track) {
		await deleteTrack(event.id, t.id);
		tracks = tracks.filter((x) => x.id !== t.id);
		sessions = sessions.map((s) => (s.trackId === t.id ? { ...s, trackId: null } : s));
	}
	async function exportIcs() {
		downloadText(`edmat-event-${event.id}.ics`, await getEventIcs(event.id), 'text/calendar');
	}
</script>

<section class="programme">
	<div class="programme__head">
		<h2>{m.events_programme()}</h2>
		<div class="programme__actions">
			{#if sessions.length > 0}
				<div class="view-switch" role="group" aria-label={m.events_programmeView()}>
					<button
						type="button"
						class:on={view === 'list'}
						aria-pressed={view === 'list'}
						onclick={() => (view = 'list')}>{m.events_viewList()}</button
					>
					<button
						type="button"
						class:on={view === 'week'}
						aria-pressed={view === 'week'}
						onclick={() => (view = 'week')}>{m.events_viewWeek()}</button
					>
				</div>
				<button type="button" class="ics" onclick={exportIcs}>{m.events_exportIcs()}</button>
			{/if}
			{#if event.canOrganise && editing === null}
				<button type="button" class="primary" onclick={() => (editing = 'new')}
					>{m.events_sessionAdd()}</button
				>
			{/if}
		</div>
	</div>

	{#if event.canOrganise}
		<div class="tracks">
			<span class="tracks__label">{m.events_tracks()}</span>
			{#each tracks as t (t.id)}
				<span class="track-chip"
					>{t.name}<button
						type="button"
						class="x"
						aria-label={m.common_remove()}
						onclick={() => removeTrack(t)}>×</button
					></span
				>
			{/each}
			<input
				type="text"
				bind:value={newTrack}
				placeholder={m.events_trackNamePlaceholder()}
				aria-label={m.events_trackNamePlaceholder()}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						addTrack();
					}
				}}
			/>
			<button type="button" onclick={addTrack}>{m.common_add()}</button>
		</div>
	{/if}

	{#if editing === 'new'}
		<SessionEditor {tracks} {busy} {error} onsubmit={save} oncancel={() => (editing = null)} />
	{/if}

	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if sessions.length === 0}
		<p class="status">{m.events_programmeEmpty()}</p>
	{:else if view === 'week'}
		<div class="week">
			<CalendarWeek days={weekDays} {entries} emptyLabel={m.events_programmeEmpty()} />
		</div>
	{:else}
		{#each days as [day, rows] (day)}
			<h3 class="day">{formatDate(rows[0].startsAt)}</h3>
			<ol class="sessions">
				{#each rows as s (s.id)}
					<li class="session" class:session--break={s.kind === 'break' || s.kind === 'social'}>
						{#if editing !== 'new' && editing?.id === s.id}
							<SessionEditor
								initial={s}
								{tracks}
								{busy}
								{error}
								onsubmit={save}
								oncancel={() => (editing = null)}
							/>
						{:else}
							<div class="session__time">
								<span>{formatTimeOfDay(s.startsAt)}–{formatTimeOfDay(s.endsAt)}</span>
								{#if s.trackId && trackById[s.trackId]}<span class="session-track"
										>{trackById[s.trackId].name}</span
									>{/if}
							</div>
							<div class="session__body">
								<h4>{s.title} <span class="kind">{SESSION_KIND_LABELS[s.kind]()}</span></h4>
								{#if s.speakers.length > 0}
									<p class="speakers">
										{#each s.speakers as sp, i (sp.id)}{#if i > 0},
											{/if}{#if sp.user}<a href={resolve('/users/[id]', { id: sp.user.id })}
													>{sp.name}</a
												>{:else}{sp.name}{/if}{#if sp.affiliation}
												<span class="aff">({sp.affiliation})</span>{/if}{/each}
									</p>
								{/if}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- external addresses, not app routes -->
								{#if s.locationText || s.onlineUrl}
									<p class="place">
										{s.locationText}{#if s.locationText && s.onlineUrl}
											·
										{/if}{#if s.onlineUrl}<a href={s.onlineUrl} rel="nofollow"
												>{m.events_joinOnline()}</a
											>{/if}
									</p>
								{/if}
								{#if s.abstract}<p class="abstract">{s.abstract}</p>{/if}
								{#each linksByRole(s) as group (group.role)}
									<p class="links">
										<span class="role">{SESSION_LINK_ROLE_LABELS[group.role]()}:</span>
										{#each group.links as l, i (l.id)}{#if i > 0},
											{/if}<a href={linkHref(l)} rel={l.kind === 'url' ? 'nofollow' : undefined}
												>{l.title}</a
											>{#if l.note}
												<span class="note">— {l.note}</span>{/if}{/each}
									</p>
								{/each}
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
								<div class="session__actions">
									{#if authStore.isAuthenticated}
										<button
											type="button"
											class:on={s.isBookmarked}
											aria-pressed={s.isBookmarked}
											onclick={() => toggleBookmark(s)}
										>
											{s.isBookmarked
												? m.events_bookmarked()
												: m.events_bookmark()}{#if s.bookmarkCount > 0}
												· {s.bookmarkCount}{/if}
										</button>
									{/if}
									{#if s.capacity > 0 && authStore.isAuthenticated}
										<button
											type="button"
											class:on={s.isRegistered}
											aria-pressed={s.isRegistered}
											onclick={() => toggleSeat(s)}
										>
											{s.isRegistered ? m.events_seatTaken() : m.events_takeSeat()} · {s.registeredCount}/{s.capacity}
										</button>
									{:else if s.capacity > 0}
										<span class="seats"
											>{m.events_seats({ taken: s.registeredCount, capacity: s.capacity })}</span
										>
									{/if}
									{#if seatError[s.id]}<span class="seat-error">{seatError[s.id]}</span>{/if}
									{#if exerciseIds(s).length > 0}
										<button type="button" onclick={() => addToSet(s)}>
											{added[s.id] !== undefined
												? m.events_addedToSet({ count: added[s.id] })
												: m.events_addToSet({ count: exerciseIds(s).length })}
										</button>
									{/if}
									<button
										type="button"
										onclick={() => (openQA = { ...openQA, [s.id]: !openQA[s.id] })}
										aria-expanded={!!openQA[s.id]}>{m.events_sessionQA()}</button
									>
									{#if event.canOrganise}
										<button type="button" onclick={() => (editing = s)}>{m.common_edit()}</button>
										<button type="button" class="danger" onclick={() => remove(s)}
											>{m.common_remove()}</button
										>
									{/if}
								</div>
								{#if openQA[s.id]}<SessionQA sessionId={s.id} />{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ol>
		{/each}
	{/if}
</section>

<style lang="scss">
	.programme {
		margin-top: 1.5rem;
	}
	.programme__head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.programme__head h2 {
		margin: 0;
	}
	.programme__actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}
	button {
		min-height: 40px;
		padding: 0 0.8rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
		font: inherit;
		font-size: 0.9rem;
	}
	button.on,
	.view-switch .on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.danger {
		color: var(--status-danger);
	}
	.view-switch {
		display: inline-flex;
	}
	.tracks {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
		margin: 0.6rem 0;
		font-size: 0.9rem;
	}
	.tracks input {
		font: inherit;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.track-chip {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--bg-surface-alt);
	}
	.x {
		border: 0;
		background: none;
		min-height: 0;
		padding: 0;
		color: var(--text-secondary);
	}
	.day {
		margin: 1rem 0 0.4rem;
		font-size: 1rem;
		color: var(--text-secondary);
	}
	.sessions {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.6rem;
	}
	.session {
		display: grid;
		grid-template-columns: 8.5rem 1fr;
		gap: 0.8rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg-surface);
	}
	.session--break {
		opacity: 0.8;
	}
	.session__time {
		display: grid;
		align-content: start; // the chip must not stretch to the row's height in a tall card
		gap: 0.2rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
	.session-track {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		width: max-content;
	}
	h4 {
		margin: 0 0 0.2rem;
		font-size: 1.05rem;
	}
	.kind,
	.aff,
	.note,
	.role {
		font-size: 0.8rem;
		color: var(--text-secondary);
		font-weight: normal;
	}
	.speakers,
	.place,
	.abstract,
	.links {
		margin: 0.15rem 0;
		font-size: 0.92rem;
	}
	.session__actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.session__actions button {
		min-height: 36px;
		font-size: 0.85rem;
	}
	.status,
	.seats {
		color: var(--text-secondary);
	}
	.seats {
		font-size: 0.85rem;
		align-self: center;
	}
	.seat-error {
		color: var(--status-danger);
		font-size: 0.85rem;
		align-self: center;
	}
	.week {
		overflow-x: auto;
		margin-top: 0.6rem;
	}
	@media (max-width: 600px) {
		.session {
			grid-template-columns: 1fr;
		}
	}
</style>
