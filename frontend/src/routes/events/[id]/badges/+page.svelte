<script lang="ts">
	// The badge sheet (CONFERENCE-BRIEF.md §3.D, R1 §2.5 / decision 9): an A4 grid of everybody who
	// is going, printed by the browser rather than by a server-side PDF renderer — a print
	// stylesheet on a plain page was the explicit alternative to adding WeasyPrint as a dependency.
	//
	// **The minors' rule is applied on the server** (`ticket_views.badge_sheet`): a badge for
	// somebody under 16 carries a first name and an initial and a coloured band, an adult's carries
	// their name. This page renders `name` and `isMinor` as given. Doing the masking here would put
	// the full name in the HTTP response of a page whose whole point is that it must not be there.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getBadgeSheet } from '$lib/services/tickets';
	import type { BadgeSheet } from '$lib/types/ticket';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let sheet = $state<BadgeSheet | null>(null);
	let loading = $state(true);
	let refused = $state(false);

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		getBadgeSheet(id)
			.then((found) => (sheet = found))
			.catch(() => (refused = true))
			.finally(() => (loading = false));
	});
</script>

<svelte:head>
	<title>{pageTitle(m.tickets_badgesTitle())}</title>
</svelte:head>

<FeatureGate feature="tickets">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if refused || !sheet}
			<p class="status">{m.tickets_organiserOnly()}</p>
		{:else}
			<header class="head no-print">
				<div>
					<h1>{m.tickets_badgesTitle()}</h1>
					<p class="lead">
						{sheet.eventTitle} · {m.tickets_badgesCount({ count: sheet.badges.length })}
					</p>
				</div>
				<div class="actions">
					<button type="button" class="primary" onclick={() => window.print()}
						>{m.tickets_badgesPrint()}</button
					>
					<a href={resolve('/events/[id]', { id: page.params.id! })}>{m.tickets_backToEvent()}</a>
				</div>
			</header>
			<p class="hint no-print">{m.tickets_badgesHint()}</p>
			{#if sheet.badges.length === 0}
				<p class="status no-print">{m.tickets_badgesEmpty()}</p>
			{:else}
				<div class="grid">
					{#each sheet.badges as badge, i (badge.shortCode || i)}
						<article class="badge" class:badge--minor={badge.isMinor}>
							<p class="name">{badge.name}</p>
							<p class="event">{sheet.eventTitle}</p>
							{#if badge.isMinor}<p class="band">{m.tickets_minorBadge()}</p>{/if}
						</article>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 900px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.8rem;
		flex-wrap: wrap;
	}
	h1 {
		font-size: var(--font-size-lg);
		margin: 0;
	}
	.lead,
	.hint,
	.status {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin: 0.2rem 0 0;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
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
	.grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.4rem;
	}
	.badge {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.9rem;
		min-height: 90px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		text-align: center;
		background: var(--bg-surface);
	}
	.badge--minor {
		border-top: 8px solid var(--status-warning, #b26a00);
	}
	.name {
		margin: 0;
		font-size: 1.3rem;
		font-weight: 700;
	}
	.event {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.band {
		margin: 0.3rem 0 0;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--status-warning);
	}

	/* Eight badges to an A4 page, 2 × 4 — the size a standard lanyard pocket takes. */
	@media print {
		:global(body) {
			background: #fff;
		}
		.page {
			max-width: none;
			padding: 0;
			gap: 0;
		}
		.no-print {
			display: none !important;
		}
		.grid {
			grid-template-columns: repeat(2, 99mm);
			gap: 0;
		}
		.badge {
			width: 99mm;
			height: 69mm;
			box-sizing: border-box;
			border: 1px dashed #999;
			border-radius: 0;
			background: #fff;
			color: #000;
			break-inside: avoid;
		}
		.badge--minor {
			border-top: 8mm solid #b26a00;
		}
		.band {
			color: #b26a00;
		}
	}
</style>
