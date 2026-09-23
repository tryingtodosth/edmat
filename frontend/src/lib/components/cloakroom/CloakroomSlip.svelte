<script lang="ts">
	// The paper ticket. A QR code of the token, the same token printed large enough to read across
	// a counter, and the hook number — and deliberately nothing else: no name, no account, no event
	// id. Whoever holds this gets the coat, which is the whole design (backend/cloakroom/models.py).
	//
	// `qrcode` is imported **dynamically, at the moment a slip is drawn** (house rule 11). It is a
	// ~50 KB dependency that only ever matters to a person standing behind a cloakroom counter, and
	// `e2e/event-cloakroom.mjs` asserts it is absent from the entry bundle.
	import { m } from '$lib/paraglide/messages.js';

	let {
		token,
		rackLabel,
		description = ''
	}: {
		token: string;
		rackLabel: string;
		description?: string;
	} = $props();

	let qrDataUrl = $state('');
	let qrFailed = $state(false);

	$effect(() => {
		const value = token;
		if (!value) {
			qrDataUrl = '';
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const { default: QRCode } = await import('qrcode');
				const url = await QRCode.toDataURL(value, { margin: 0, width: 240 });
				if (!cancelled) qrDataUrl = url;
			} catch {
				// A slip with no picture is still a slip — the number under it is what the desk
				// actually types. Never let a missing canvas stop a coat being taken in.
				if (!cancelled) qrFailed = true;
			}
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="slip print-area">
	<p class="heading">{m.cloakroom_slipHeading()}</p>
	{#if qrDataUrl}
		<img class="qr" src={qrDataUrl} alt={token} />
	{:else if qrFailed}
		<p class="qr-missing">&nbsp;</p>
	{/if}
	<p class="token" data-cloakroom-token={token}>{token}</p>
	<p class="rack">{m.cloakroom_slipRack()} {rackLabel}</p>
	{#if description}
		<p class="description">{description}</p>
	{/if}
	<p class="keep">{m.cloakroom_slipKeep()}</p>
	<p class="keep">{m.cloakroom_slipNoName()}</p>
</div>

<style lang="scss">
	.slip {
		width: 60mm;
		max-width: 100%;
		margin: 0 auto;
		padding: var(--space-3);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		text-align: center;
	}
	.heading {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}
	.qr {
		width: 34mm;
		height: 34mm;
		image-rendering: pixelated;
		background: #fff;
		padding: 2mm;
	}
	.qr-missing {
		height: 34mm;
		margin: 0;
	}
	.token {
		margin: var(--space-2) 0 0;
		font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: 0.12em;
	}
	.rack {
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-lg);
		font-weight: 600;
	}
	.description {
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.keep {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}

	// A till-roll slip, not a sheet of A4 with a stamp in the corner. `.print-area` (styles/
	// _print.scss) already hides everything else on the page and resets this one to black on white.
	@media print {
		@page {
			size: 60mm auto;
			margin: 4mm;
		}
		.slip {
			width: auto;
			border: 0;
			padding: 0;
		}
		.token {
			font-size: 24pt;
		}
	}
</style>
