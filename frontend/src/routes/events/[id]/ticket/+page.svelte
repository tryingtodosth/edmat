<script lang="ts">
	// My ticket (CONFERENCE-BRIEF.md §3.D): the QR, the short code under it, when and where, and a
	// print stylesheet that turns the page into an A6 badge.
	//
	// Three decisions worth keeping:
	//
	// 1. **The QR encodes the token and nothing else.** Not a URL, not a name, not the event. The
	//    backend's own docstring says why (a QR is photographed by whoever is behind you); the page
	//    must not helpfully "improve" it into a link that leaks which event somebody is at.
	// 2. **`qrcode` is imported dynamically**, at the moment there is something to draw, like KaTeX
	//    and Leaflet before it (house rule 11). It is not large, but the rule is the rule and this
	//    page is the only place it is ever needed; `e2e/event-tickets.mjs` asserts it is absent from
	//    the entry chunk.
	// 3. **The minors' rule is applied on the server** (`ticket_views._badge_name`), and this page
	//    prints `badgeName` as given plus a coloured band when `isMinor`. Re-deriving it here from a
	//    profile would be a second implementation of a rule that exists to be obeyed everywhere.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { getMyTicket, rotateMyTicket } from '$lib/services/tickets';
	import type { MyTicket } from '$lib/types/ticket';
	import { formatDateTime } from '$lib/utils/datetime';
	import { TICKET_BLOCK_REASONS } from '$lib/utils/labels';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let ticket = $state<MyTicket | null>(null);
	let loading = $state(true);
	let blocked = $state('');
	let error = $state('');
	let canvas = $state<HTMLCanvasElement | null>(null);
	let drawFailed = $state(false);
	let rotating = $state(false);
	let rotated = $state(false);

	// `?attendee=` lets a guardian open their child's ticket — the child may have no phone at all.
	// The server decides whether the requester really is the guardian; this only carries the ask.
	const attendeeId = $derived(page.url.searchParams.get('attendee') ?? undefined);

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const key = `${page.params.id!}:${attendeeId ?? ''}`;
		if (key === loadedForId) return;
		loadedForId = key;
		load();
	});

	async function load() {
		loading = true;
		blocked = '';
		error = '';
		try {
			ticket = await getMyTicket(page.params.id!, attendeeId);
		} catch (e) {
			ticket = null;
			if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
				blocked = String((e.body as { detail?: string } | undefined)?.detail ?? '');
			} else {
				error = m.common_error(); // "Something went wrong"
			}
		} finally {
			loading = false;
		}
	}

	// Drawing waits for BOTH the token and the canvas element, and re-runs when either arrives.
	// `onMount` alone would run before the fetch resolves, and an `$effect` reading only the token
	// would run before the `{#if}` that owns the canvas has rendered it.
	$effect(() => {
		const token = ticket?.token;
		const target = canvas;
		if (!token || !target) return;
		draw(target, token);
	});

	async function draw(target: HTMLCanvasElement, token: string) {
		try {
			const QRCode = (await import('qrcode')).default;
			await QRCode.toCanvas(target, token, { width: 260, margin: 1 });
			drawFailed = false;
		} catch {
			// A drawn code is a convenience; the short code below it is the fallback that always works.
			drawFailed = true;
		}
	}

	async function rotate() {
		if (!confirm(m.tickets_rotateConfirm())) return; // "Replace this ticket with a new code? The old one stops working immediately."
		rotating = true;
		rotated = false;
		try {
			ticket = await rotateMyTicket(page.params.id!, attendeeId);
			rotated = true;
		} catch {
			error = m.common_error(); // "Something went wrong"
		} finally {
			rotating = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(m.tickets_title())}</title>
</svelte:head>

<FeatureGate feature="tickets">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if error}
			<p class="status" role="alert">{error}</p>
		{:else if blocked}
			<h1>{m.tickets_title()}</h1>
			<p class="status">
				{(TICKET_BLOCK_REASONS[blocked] ?? m.tickets_noTicketYet)()}
			</p>
			<a class="back" href={resolve('/events/[id]', { id: page.params.id! })}
				>{m.tickets_backToEvent()}</a
			>
		{:else if ticket}
			<article class="ticket" class:ticket--minor={ticket.isMinor}>
				<h1>{ticket.event.title}</h1>
				<p class="who">
					{ticket.badgeName}
					{#if ticket.isMinor}<span class="band">{m.tickets_minorBadge()}</span>{/if}
				</p>
				<div class="code">
					<!-- The ROLE is on the wrapper, not the canvas: Svelte's a11y pass treats `<canvas>` as an
					     interactive element and refuses `role="img"` on it, and a screen reader has nothing to
					     read off a bitmap anyway — the label describes the picture, and the short code below is
					     the part that is actually usable without eyes. -->
					<div class="qr" role="img" aria-label={m.tickets_qrLabel()}>
						<canvas bind:this={canvas} aria-hidden="true"></canvas>
					</div>
					{#if drawFailed}<p class="status">{m.tickets_qrFailed()}</p>{/if}
					<p class="short">
						<span class="short-label">{m.tickets_shortCode()}</span>
						<strong data-testid="short-code">{ticket.shortCode}</strong>
					</p>
					<p class="hint">{m.tickets_shortCodeHint()}</p>
				</div>
				<dl class="facts">
					{#if ticket.event.startsAt}
						<dt>{m.tickets_when()}</dt>
						<dd>{formatDateTime(ticket.event.startsAt)}</dd>
					{/if}
					{#if ticket.event.locationText}
						<dt>{m.tickets_where()}</dt>
						<dd>{ticket.event.locationText}</dd>
					{/if}
					{#if ticket.event.onlineUrl}
						<dt>{m.tickets_onlineLink()}</dt>
						<dd class="url">{ticket.event.onlineUrl}</dd>
					{/if}
				</dl>
				{#if ticket.checkedInAt}
					<p class="checked">
						{ticket.inside
							? m.tickets_checkedIn({ when: formatDateTime(ticket.checkedInAt) })
							: m.tickets_checkedOut({
									when: formatDateTime(ticket.checkedOutAt ?? ticket.checkedInAt)
								})}
					</p>
				{/if}
			</article>
			<div class="actions">
				<button type="button" class="primary" onclick={() => window.print()}
					>{m.tickets_print()}</button
				>
				<button type="button" onclick={rotate} disabled={rotating}>{m.tickets_rotate()}</button>
				<a class="back" href={resolve('/events/[id]', { id: page.params.id! })}
					>{m.tickets_backToEvent()}</a
				>
			</div>
			<p class="hint">{m.tickets_rotateHint()}</p>
			{#if rotated}<p class="ok" role="status">{m.tickets_rotated()}</p>{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 420px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.ticket {
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1rem;
		background: var(--bg-surface);
		text-align: center;
	}
	.ticket--minor {
		border-top: 10px solid var(--status-warning, #b26a00);
	}
	h1 {
		font-size: var(--font-size-lg);
		margin: 0 0 0.3rem;
	}
	.who {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0 0 0.6rem;
	}
	.band {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--status-warning-bg);
		color: var(--status-warning);
	}
	canvas {
		max-width: 100%;
		height: auto;
		background: #fff;
		border-radius: 6px;
	}
	.short {
		margin: 0.4rem 0 0;
		font-size: 1.1rem;
		letter-spacing: 0.12em;
	}
	.short-label {
		display: block;
		font-size: 0.75rem;
		letter-spacing: normal;
		color: var(--text-secondary);
	}
	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.2rem 0.8rem;
		margin: 0.8rem 0 0;
		text-align: left;
		font-size: 0.9rem;
	}
	.facts dt {
		color: var(--text-secondary);
	}
	.facts dd {
		margin: 0;
	}
	.url {
		word-break: break-all;
	}
	.checked {
		margin: 0.6rem 0 0;
		font-size: 0.9rem;
		color: var(--status-success);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
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
	.hint,
	.status {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.ok {
		font-size: 0.85rem;
		color: var(--status-success);
	}

	/* An A6 badge, which is what a lanyard pocket takes. Everything that is not the ticket itself
	   leaves the page — a printed sheet with a "Get a new code" button on it is a sheet somebody
	   tries to press. */
	@media print {
		:global(body) {
			background: #fff;
		}
		.page {
			max-width: none;
			padding: 0;
		}
		.actions,
		.hint,
		.ok,
		.back {
			display: none !important;
		}
		.ticket {
			width: 105mm;
			height: 148mm;
			box-sizing: border-box;
			border: 1px solid #000;
			border-radius: 0;
			display: flex;
			flex-direction: column;
			justify-content: center;
			page-break-after: always;
		}
		.ticket--minor {
			border-top: 12mm solid #b26a00;
		}
	}
</style>
