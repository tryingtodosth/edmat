<script lang="ts">
	// The certificate of volunteer service, Polish and English **on one sheet**.
	//
	// Bilingual simultaneously, not "in the reader's interface language": Article 44(2) of the
	// Polish Volunteer Act is what makes this document worth issuing at all, and the person
	// receiving it may well hand it to a Polish institution while reading the English interface —
	// or to an Erasmus office while reading the Polish one. So the certificate body is the
	// deliberate exception the i18n rule already names (`lib/content/privacy.ts`, `levels.ts`):
	// both locales live in this file, reviewable as a document. The page's own chrome — the Print
	// button, the errors — is ordinary `m.*()` copy.
	//
	// **Unsigned, and it says so.** EdMat has no signature to give and no authority to certify
	// anybody's hours; what it has is the rota the organiser kept. The sheet names the organiser
	// and says a signed copy is theirs to issue. Claiming otherwise would be the one thing a
	// document like this must never do.
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { formatDate, formatDateTime, formatTimeOfDay } from '$lib/utils/datetime';
	import { getMyShifts } from '$lib/services/shifts';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';
	import type { MyShifts } from '$lib/types/shift';

	let data = $state<MyShifts | null>(null);
	let error = $state('');
	// The id-changed guard every dynamic route needs: `$effect` re-fires with no navigation at all
	// (frontend/CLAUDE.md trap 2).
	let loadedFor = $state('');

	$effect(() => {
		const id = page.params.id;
		if (!id || id === loadedFor || !authStore.isAuthenticated) return;
		loadedFor = id;
		load(id);
	});

	async function load(id: string) {
		try {
			data = await getMyShifts(id);
		} catch {
			error = m.common_error();
		}
	}

	const done = $derived((data?.shifts ?? []).filter((row) => row.status === 'done'));
	// Built in the script, not in the markup: written inline, Prettier reflows the `{#if}` around
	// the dash onto its own line and the sheet prints "…2026– Thursday…" with the space on the
	// wrong side of it. Visible only on the screenshot, which is where it was caught.
	const dateRange = $derived(
		data?.event.startsAt
			? formatDate(data.event.startsAt) +
					(data.event.endsAt ? ` – ${formatDate(data.event.endsAt)}` : '')
			: ''
	);
	const today = new Date().toISOString();
</script>

<svelte:head><title>{pageTitle(m.shifts_certificate())}</title></svelte:head>
<!-- "Certificate of service" -->

<FeatureGate feature="shifts">
	<div class="page">
		<div class="controls">
			<a href={resolve('/events/[id]', { id: page.params.id ?? '' })}>{m.shifts_backToEvent()}</a>
			<!-- "Back to the event" -->
			<button type="button" onclick={() => window.print()}>{m.shifts_print()}</button>
			<!-- "Print" -->
		</div>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{:else if data}
			<article class="sheet">
				<h1>Zaświadczenie o wykonaniu świadczeń wolontariackich</h1>
				<h2>Certificate of volunteer service</h2>

				<dl>
					<dt>Wolontariusz / Volunteer</dt>
					<dd>{authStore.user?.displayName ?? ''}</dd>
					<dt>Wydarzenie / Event</dt>
					<dd>{data.event.title}</dd>
					{#if dateRange}
						<dt>Termin / Dates</dt>
						<dd>{dateRange}</dd>
					{/if}
					{#if data.event.locationText}
						<dt>Miejsce / Place</dt>
						<dd>{data.event.locationText}</dd>
					{/if}
					<dt>Organizator / Organiser</dt>
					<dd>{data.event.organiser}</dd>
					<dt>Liczba godzin / Hours</dt>
					<dd class="hours">{data.hours}</dd>
				</dl>

				<h3>Zakres świadczeń / Scope of service</h3>
				{#if done.length === 0}
					<p class="status">
						Brak potwierdzonych dyżurów. / No confirmed shifts yet — the organiser marks a shift
						done after it happens.
					</p>
				{:else}
					<table>
						<thead>
							<tr>
								<th>Stanowisko / Station</th>
								<th>Od / From</th>
								<th>Do / To</th>
								<th>Godziny / Hours</th>
							</tr>
						</thead>
						<tbody>
							{#each done as row (row.assignmentId)}
								<tr>
									<td>{row.stationName}</td>
									<td>{formatDateTime(row.startsAt)}</td>
									<td>{formatTimeOfDay(row.endsAt)}</td>
									<td>{row.creditedHours}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}

				<p class="issued">
					Wystawiono {formatDate(today)} przez EdMat na podstawie grafiku prowadzonego przez organizatora.
					<strong>Dokument niepodpisany</strong>
					— o podpisany egzemplarz należy zwrócić się do organizatora ({data.event.organiser}),
					zgodnie z art. 44 ust. 2 ustawy o działalności pożytku publicznego i o wolontariacie.
				</p>
				<p class="issued">
					Issued {formatDate(today)} by EdMat from the rota the organiser kept.
					<strong>This copy is unsigned</strong> — ask the organiser ({data.event.organiser}) for a
					signed one.
				</p>
			</article>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 780px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
	}
	.controls {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-bottom: 1rem;
	}
	.sheet {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1.6rem;
		background: var(--surface, transparent);
	}
	h1 {
		font-size: 1.25rem;
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		font-weight: 500;
		color: var(--text-secondary);
		margin: 0.2rem 0 1.2rem;
	}
	h3 {
		font-size: 1rem;
		margin: 1.3rem 0 0.4rem;
	}
	dl {
		display: grid;
		grid-template-columns: 14rem 1fr;
		gap: 0.3rem 1rem;
		margin: 0;
		font-size: 0.9rem;
	}
	dt {
		color: var(--text-secondary);
	}
	dd {
		margin: 0;
	}
	dd.hours {
		font-weight: 700;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.87rem;
	}
	th,
	td {
		text-align: left;
		border-bottom: 1px solid var(--border);
		padding: 0.3rem 0.4rem 0.3rem 0;
	}
	.issued {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-top: 1.1rem;
	}
	.status {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.error {
		color: var(--danger, #c62828);
	}

	// The print sheet: the browser makes the PDF, so no server-side renderer and no new binary
	// dependency (CONFERENCE-BRIEF.md §1 rejects WeasyPrint for exactly this reason).
	@media print {
		.controls {
			display: none;
		}
		.page {
			margin: 0;
			padding: 0;
			max-width: none;
		}
		.sheet {
			border: none;
			padding: 0;
		}
		:global(body) {
			background: #fff;
			color: #000;
		}
	}
</style>
