<script lang="ts">
	/**
	 * A *zaświadczenie* for a laureate, a finalist or a distinction (CONTESTS-BRIEF.md §3.A item 9).
	 *
	 * The posture is `/courses/[id]/certificate/[completionId]`'s, deliberately and in full:
	 *
	 * * **Bilingual on one sheet**, not "in the reader's interface language". A pupil may hand this
	 *   to a Polish school office while reading the English interface, and to a university
	 *   admissions desk while reading the Polish one. So the sheet's BODY is the exception the i18n
	 *   rule already names for long-form documents (`lib/content/privacy.ts`); the page's chrome is
	 *   ordinary `m.*()` copy.
	 * * **The browser makes the PDF.** `@media print` and `window.print()`, no server renderer.
	 * * **The ORGANISER is the issuer and EdMat is only the medium**, and the sheet says both out
	 *   loud. This is the document where that distinction matters most: a *zaświadczenie* from a
	 *   kurator's contest carries an exam exemption, and one from somebody's maths challenge
	 *   carries nothing — so the sheet names who issued it and says it is unsigned.
	 * * **`print-area` is load-bearing.** `_print.scss` hides `body *` and reveals only
	 *   `.print-area`; without the class this prints a blank page, which is the bug three other
	 *   printable pages shipped with and which no assertion caught (HISTORY.md §17BR.C).
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';
	import { getContestCertificate } from '$lib/services/contests';
	import { formatDate } from '$lib/utils/datetime';
	import type { CertificatePayload } from '$lib/types/contest';

	let data = $state<CertificatePayload | null>(null);
	let error = $state('');
	let loadedFor = $state('');

	$effect(() => {
		const id = page.params.id;
		const resultId = page.params.resultId;
		const key = `${id}:${resultId}:${authStore.user?.id ?? 'anon'}`;
		if (!id || !resultId || key === loadedFor || !authStore.isAuthenticated) return;
		loadedFor = key;
		void load(id, resultId);
	});

	async function load(id: string, resultId: string) {
		error = '';
		try {
			data = await getContestCertificate(id, resultId);
		} catch {
			// 404 is what a stranger gets, and what somebody whose result carries no title gets.
			// Both are "this certificate is not available", which is the honest sentence: a 403
			// would confirm that a particular person placed in a particular contest.
			error = m.contests_certificateNotFound(); // "This certificate is not available."
		}
	}

	/** The Polish word, which is what the document is actually called in both halves of the sheet.
	 *  Not `m.*()`: the sheet's body is bilingual at once (see the module comment). */
	const titlePl = $derived.by(() => {
		switch (data?.result.title) {
			case 'laureate':
				return 'Laureat';
			case 'finalist':
				return 'Finalista';
			case 'distinction':
				return 'Wyróżnienie';
			default:
				return 'Uczestnik';
		}
	});
	const titleEn = $derived.by(() => {
		switch (data?.result.title) {
			case 'laureate':
				return 'Laureate';
			case 'finalist':
				return 'Finalist';
			case 'distinction':
				return 'Distinction';
			default:
				return 'Participant';
		}
	});
	const today = new Date().toISOString();
</script>

<svelte:head><title>{pageTitle(m.contests_certificatePageTitle())}</title></svelte:head>
<!-- "Contest certificate" -->

<FeatureGate feature="contests">
	<div class="page">
		<div class="controls">
			<a href={resolve('/contests/[id]/results', { id: page.params.id ?? '' })}>
				{m.contests_backToResults()}
				<!-- "Back to the results" -->
			</a>
			<button type="button" onclick={() => window.print()}>{m.contests_print()}</button>
		</div>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{:else if data}
			<article class="sheet print-area">
				<h1>Zaświadczenie</h1>
				<h2>Certificate</h2>

				<dl>
					<dt>Uczestnik / Participant</dt>
					<dd>{data.participant.displayName}</dd>
					{#if data.participant.affiliation}
						<dt>Szkoła / instytucja — School or institution</dt>
						<dd>{data.participant.affiliation}</dd>
					{/if}
					<dt>Konkurs / Contest</dt>
					<dd>{data.contest.title}</dd>
					<dt>Organizator / Organiser</dt>
					<dd>{data.organiser.displayName}</dd>
					{#if data.contest.startsAt}
						<dt>Termin / Dates</dt>
						<dd>
							{formatDate(data.contest.startsAt)}{#if data.contest.endsAt}
								– {formatDate(data.contest.endsAt)}{/if}
						</dd>
					{/if}
					<dt>Wynik / Result</dt>
					<dd>
						<strong>{titlePl} / {titleEn}</strong> — miejsce {data.result.rank} / rank {data.result
							.rank}
					</dd>
					<dt>Punkty / Points</dt>
					<dd>{data.result.totalPoints} / {data.result.maxPoints}</dd>
					<dt>Wyniki ogłoszono / Results published</dt>
					<dd>{formatDate(data.result.publishedAt)}</dd>
				</dl>

				{#if data.contest.externalReferenceUrl}
					<p class="basis">
						Ogłoszenie organizatora / The organiser's own announcement:
						{data.contest.externalReferenceUrl}
					</p>
				{/if}

				<p class="issued">
					Zaświadczenie wystawia <strong>organizator konkursu</strong> wskazany powyżej. Serwis
					EdMat jest wyłącznie narzędziem, przy pomocy którego konkurs został przeprowadzony: nie
					jest organizatorem, nie ocenia prac i nie potwierdza niczyich kwalifikacji.
					<strong>Dokument niepodpisany</strong> — o podpisany egzemplarz należy zwrócić się do organizatora.
				</p>
				<p class="issued">
					This certificate is issued by the <strong>contest organiser</strong> named above. EdMat is
					only the tool the contest was run with: it does not organise it, does not mark any work
					and certifies nobody's qualifications. <strong>This copy is unsigned</strong> — ask the
					organiser for a signed one. Printed {formatDate(today)}.
				</p>
				<p class="issued issued--small">
					Uprawnienia wynikające z tytułu laureata lub finalisty zależą wyłącznie od przepisów
					dotyczących danego konkursu i od tego, czy konkurs znajduje się w wykazie ministra. Ten
					dokument niczego takiego nie przyznaje. / Whatever rights a laureate's or finalist's title
					carries depend entirely on the rules governing that particular contest and on whether it
					is on the minister's list. This document grants none of them.
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
		border: 1px solid var(--border-color);
		border-radius: 10px;
		padding: 1.6rem;
		background: var(--bg-surface);
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
	dl {
		display: grid;
		grid-template-columns: minmax(10rem, auto) 1fr;
		gap: 0.3rem 1rem;
		margin: 0;
		font-size: var(--font-size-sm);
	}
	dt {
		color: var(--text-secondary);
	}
	dd {
		margin: 0;
	}
	.basis,
	.issued {
		margin: 1rem 0 0;
		font-size: var(--font-size-sm);
		line-height: 1.55;
	}
	.issued--small {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	button {
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		color: var(--text-primary);
		cursor: pointer;
	}
	.error {
		color: var(--status-danger);
	}

	@media print {
		.sheet {
			border: 0;
			border-radius: 0;
			padding: 0;
		}
	}
</style>
