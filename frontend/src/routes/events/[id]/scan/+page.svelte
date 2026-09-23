<script lang="ts">
	// The door (CONFERENCE-BRIEF.md §3.D). A volunteer's phone, in a corridor, on a network that may
	// not be there.
	//
	// **The scanner never decides.** It caches the check-in list on open so it can show a name and a
	// likely answer immediately, but every admission is decided by `events/scanning.py` when the
	// batch reaches the server. That is why a scan goes into IndexedDB first and onto the wire
	// second, and why the result a volunteer sees can change from "queued" to a real answer a few
	// seconds later. A scanner that decided for itself would disagree with the phone next to it.
	//
	// **Three ways in, in order of how often they work:** the camera, the typed short code, and a
	// search over the cached list for somebody who left their ticket at home. All three funnel into
	// one `queueScan()`, so the offline queue, the nonce and the result banner have exactly one path.
	//
	// `jsqr` is imported dynamically at the moment the camera starts (house rule 11), and
	// `e2e/event-tickets.mjs` asserts it is absent from the entry chunk. A volunteer who only types
	// codes never downloads a QR decoder.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getEvent } from '$lib/services/events';
	import { getCheckinList, postScans } from '$lib/services/tickets';
	import type { EdmatEvent } from '$lib/types/event';
	import type { CheckinListRow, QueuedScan, ScanCounts, ScanDirection } from '$lib/types/ticket';
	import {
		cacheCheckinList,
		dropScans,
		enqueueScan,
		newNonce,
		readCachedList,
		readQueue
	} from '$lib/utils/scanQueue';
	import { scanResultLabel, scanResultTone } from '$lib/utils/labels';
	import { formatDateTime } from '$lib/utils/datetime';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	/** How often the queue is drained (CONFERENCE-BRIEF.md §6.2). Five seconds is short enough that
	 *  an organiser watching the "inside" count sees the door move, and long enough that forty
	 *  scans in a rush go up as two or three batches rather than forty requests. */
	const FLUSH_MS = 5000;

	type Banner = {
		result: string;
		direction: ScanDirection;
		name: string;
		token: string;
		pending: boolean;
	};

	let event = $state<EdmatEvent | null>(null);
	let loading = $state(true);
	let direction = $state<ScanDirection>('entry');
	let rows = $state<CheckinListRow[]>([]);
	let cachedAt = $state<number>(0);
	let listLive = $state(false);
	let queueLength = $state(0);
	let lastSynced = $state<string | null>(null);
	let banner = $state<Banner | null>(null);
	let counts = $state<ScanCounts | null>(null);
	let typed = $state('');
	let search = $state('');
	let cameraOn = $state(false);
	let cameraError = $state('');
	let syncError = $state('');
	let video = $state<HTMLVideoElement | null>(null);
	let frame = $state<HTMLCanvasElement | null>(null);

	let stream: MediaStream | null = null;
	let rafId = 0;
	let lastDecoded = '';
	let lastDecodedAt = 0;

	const eventId = $derived(page.params.id!);
	const matches = $derived(
		search.trim().length < 2
			? []
			: rows.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 12)
	);

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = eventId;
		if (id === loadedForId) return;
		loadedForId = id;
		boot(id);
	});

	onMount(() => {
		const timer = setInterval(() => flush(), FLUSH_MS);
		const onOnline = () => flush();
		window.addEventListener('online', onOnline);
		return () => {
			clearInterval(timer);
			window.removeEventListener('online', onOnline);
			stopCamera();
		};
	});

	async function boot(id: string) {
		loading = true;
		try {
			event = await getEvent(id);
		} catch {
			event = null;
		}
		// The cached list first, so the page is usable before (or instead of) the network answers,
		// then the live one over the top. The other order shows an empty door for as long as the
		// request takes, which on a venue's guest Wi-Fi is exactly when it matters.
		const cached = await readCachedList(id);
		if (cached) {
			rows = cached.rows;
			cachedAt = cached.cachedAt;
		}
		try {
			rows = await getCheckinList(id);
			cachedAt = Date.now();
			listLive = true;
			await cacheCheckinList(id, rows);
		} catch {
			listLive = false;
		}
		queueLength = (await readQueue(id)).length;
		loading = false;
		flush();
	}

	async function queueScan(token: string) {
		const clean = token.trim();
		if (!clean) return;
		const scan: QueuedScan = {
			token: clean,
			direction,
			clientNonce: newNonce(),
			clientAt: new Date().toISOString(),
			deviceLabel: deviceLabel(),
			isOfflineSync: !navigator.onLine
		};
		await enqueueScan(eventId, scan);
		queueLength = (await readQueue(eventId)).length;
		// Shown straight away as "queued" with whatever the cached list knows, because a person is
		// standing in front of the volunteer now. The real answer replaces it on the next flush.
		const known = rows.find((r) => r.token === clean || r.shortCode === clean);
		banner = { result: 'pending', direction, name: known?.name ?? '', token: clean, pending: true };
		flush();
	}

	function deviceLabel(): string {
		// Not a fingerprint: a short, human label so an organiser reading the log can tell the front
		// door from the side door. The width is the only thing on a phone that says anything useful.
		return typeof window === 'undefined' ? '' : `${window.screen?.width ?? 0}px`;
	}

	let flushing = false;
	async function flush() {
		if (flushing) return;
		flushing = true;
		try {
			const queued = await readQueue(eventId);
			queueLength = queued.length;
			if (queued.length === 0) return;
			const reply = await postScans(eventId, queued);
			await dropScans(reply.results.map((r) => r.clientNonce));
			queueLength = (await readQueue(eventId)).length;
			lastSynced = new Date().toISOString();
			counts = reply.counts;
			syncError = '';
			const last = reply.results[reply.results.length - 1];
			if (last) {
				banner = {
					result: last.result,
					direction: last.direction,
					name: last.name,
					token: last.token,
					pending: false
				};
			}
			// The cached list is what the next scan reads to show a name and an in/out state, so it
			// is kept in step locally rather than re-fetched — the network may be gone again already.
			for (const r of reply.results) {
				const row = rows.find((x) => x.token === r.token || x.shortCode === r.token);
				if (!row) continue;
				if (r.result === 'admitted') row.inside = true;
				if (r.result === 'exited') row.inside = false;
			}
			rows = [...rows];
		} catch {
			// Not an error the volunteer must act on: the scans are still in IndexedDB and the next
			// tick will try again. Said quietly, with the queue length doing the real talking.
			syncError = m.tickets_syncFailed(); // "Could not sync — the scans are kept and will be sent again."
		} finally {
			flushing = false;
		}
	}

	async function startCamera() {
		cameraError = '';
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
				audio: false
			});
		} catch {
			cameraError = m.tickets_cameraFailed(); // "The camera could not be opened. Type the code instead."
			return;
		}
		cameraOn = true;
		const jsQR = (await import('jsqr')).default;
		await tick();
		if (video && stream) {
			video.srcObject = stream;
			await video.play().catch(() => undefined);
		}
		const loop = () => {
			rafId = requestAnimationFrame(loop);
			const v = video;
			const c = frame;
			if (!v || !c || v.readyState < 2) return;
			const ctx = c.getContext('2d', { willReadFrequently: true });
			if (!ctx) return;
			c.width = v.videoWidth;
			c.height = v.videoHeight;
			if (!c.width || !c.height) return;
			ctx.drawImage(v, 0, 0, c.width, c.height);
			const image = ctx.getImageData(0, 0, c.width, c.height);
			const found = jsQR(image.data, image.width, image.height);
			if (!found?.data) return;
			// One code stays in front of the camera for many frames. Decoding it once per two
			// seconds is the difference between one scan and sixty identical ones in the queue —
			// the server would answer `already_in` to all but the first, which is a correct answer
			// to a question nobody asked.
			const now = Date.now();
			if (found.data === lastDecoded && now - lastDecodedAt < 2000) return;
			lastDecoded = found.data;
			lastDecodedAt = now;
			queueScan(found.data);
		};
		loop();
	}

	function tick(): Promise<void> {
		return new Promise((r) => requestAnimationFrame(() => r()));
	}

	function stopCamera() {
		cameraOn = false;
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	function submitTyped(e: SubmitEvent) {
		e.preventDefault();
		queueScan(typed);
		typed = '';
	}
</script>

<svelte:head>
	<title>{pageTitle(m.tickets_scanTitle())}</title>
</svelte:head>

<FeatureGate feature="tickets">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if !event}
			<p class="status">{m.events_notFound()}</p>
		{:else if !event.canCheckIn}
			<p class="status">{m.tickets_staffOnly()}</p>
		{:else}
			<header class="head">
				<h1>{m.tickets_scanTitle()}</h1>
				<p class="lead">{event.title}</p>
			</header>

			<fieldset class="direction">
				<legend>{m.tickets_direction()}</legend>
				<label>
					<input type="radio" bind:group={direction} value="entry" />
					{m.tickets_directionEntry()}
				</label>
				<label>
					<input type="radio" bind:group={direction} value="exit" />
					{m.tickets_directionExit()}
				</label>
			</fieldset>

			{#if banner}
				<p
					class="banner banner--{banner.pending ? 'pending' : scanResultTone(banner.result)}"
					role="status"
					data-testid="scan-banner"
				>
					<strong
						>{banner.pending
							? m.tickets_queued()
							: scanResultLabel(banner.result, banner.direction)()}</strong
					>
					{#if banner.name}<span class="banner-name">{banner.name}</span>{/if}
				</p>
			{/if}

			<section class="camera">
				{#if cameraOn}
					<!-- A live camera preview, not media with speech: there is nothing to caption, which is
					     why the a11y rule does not fire for a `muted` element with no audio track. -->
					<video bind:this={video} playsinline muted></video>
					<canvas bind:this={frame} class="hidden-frame"></canvas>
					<button type="button" onclick={stopCamera}>{m.tickets_cameraStop()}</button>
				{:else}
					<button type="button" class="primary" onclick={startCamera}
						>{m.tickets_cameraStart()}</button
					>
				{/if}
				{#if cameraError}<p class="status" role="alert">{cameraError}</p>{/if}
			</section>

			<form class="typed" onsubmit={submitTyped}>
				<label for="typed-code">{m.tickets_typedCode()}</label>
				<div class="row">
					<input
						id="typed-code"
						type="text"
						bind:value={typed}
						placeholder={m.tickets_typedCodePlaceholder()}
						autocomplete="off"
					/>
					<button type="submit" class="primary">{m.tickets_submitCode()}</button>
				</div>
			</form>

			<section class="lookup">
				<label for="name-search">{m.tickets_search()}</label>
				<input
					id="name-search"
					type="text"
					bind:value={search}
					placeholder={m.tickets_searchPlaceholder()}
					autocomplete="off"
				/>
				{#if search.trim().length >= 2}
					{#if matches.length === 0}
						<p class="status">{m.tickets_searchEmpty()}</p>
					{:else}
						<ul class="matches">
							{#each matches as row (row.token)}
								<li>
									<button type="button" onclick={() => queueScan(row.token)}>
										{row.name}
										<span class="pill">{row.inside ? m.tickets_inside() : m.tickets_outside()}</span
										>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</section>

			<section class="state">
				<p>{m.tickets_queue({ count: queueLength })}</p>
				<p>
					{lastSynced
						? m.tickets_lastSynced({ when: formatDateTime(lastSynced) })
						: m.tickets_neverSynced()}
				</p>
				<p>
					{listLive
						? m.tickets_listLive({ count: rows.length })
						: cachedAt
							? m.tickets_listCached({
									count: rows.length,
									when: formatDateTime(new Date(cachedAt).toISOString())
								})
							: m.tickets_listNotCached()}
				</p>
				{#if counts}
					<p>
						{m.tickets_counts({
							entries: counts.entries,
							exits: counts.exits,
							inside: counts.inside
						})}
					</p>
				{/if}
				{#if syncError}<p class="status">{syncError}</p>{/if}
				<button type="button" onclick={() => flush()}>{m.tickets_syncNow()}</button>
			</section>

			<a class="back" href={resolve('/events/[id]', { id: eventId })}>{m.tickets_backToEvent()}</a>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-lg);
		margin: 0;
	}
	.lead,
	.status {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin: 0.2rem 0 0;
	}
	fieldset.direction {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.5rem 0.8rem 0.7rem;
		display: flex;
		gap: 1.2rem;
		flex-wrap: wrap;
	}
	fieldset.direction label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
	}
	.banner {
		margin: 0;
		padding: 1rem;
		border-radius: 12px;
		font-size: 1.2rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.banner--ok {
		background: var(--status-success-bg);
		color: var(--status-success);
	}
	.banner--warn,
	.banner--pending {
		background: var(--status-warning-bg);
		color: var(--status-warning);
	}
	.banner--bad {
		background: var(--status-danger-bg, #fde8e8);
		color: var(--status-danger);
	}
	.banner-name {
		font-size: 0.95rem;
	}
	video {
		width: 100%;
		border-radius: 10px;
		background: #000;
	}
	.hidden-frame {
		display: none;
	}
	.row {
		display: flex;
		gap: 0.4rem;
	}
	input[type='text'] {
		flex: 1;
		min-height: 44px;
		padding: 0 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
	}
	label {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.typed,
	.lookup,
	.state,
	.camera {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	button {
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.matches {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.3rem;
	}
	.matches button {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border);
	}
	.state p {
		margin: 0;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}
</style>
