<script lang="ts">
	// The certificate of course completion, Polish and English **on one sheet**.
	//
	// The posture is `routes/events/[id]/certificate/+page.svelte`'s, deliberately and in full
	// (CONFERENCE-BRIEF.md §1 rejected WeasyPrint, and this reuses that decision rather than
	// re-opening it):
	//
	// * **Bilingual simultaneously**, not "in the reader's interface language". The person holding
	//   this may hand it to a Polish school office while reading the English interface, or to an
	//   Erasmus coordinator while reading the Polish one. So the certificate BODY is the exception
	//   the i18n rule already names for long-form documents (`lib/content/privacy.ts`, `levels.ts`):
	//   both locales live in this file, reviewable as a document. The page's own chrome — Print,
	//   Back, the errors — is ordinary `m.*()` copy.
	// * **The browser makes the PDF.** `@media print` and `window.print()`, no server-side renderer
	//   and no new binary dependency.
	// * **Unsigned, and it says so.** EdMat has no signature to give and no standing to certify
	//   anybody's education. What it has is the record the course kept, and the sheet names the
	//   person who issued it and says a signed copy is theirs to give.
	// * **No grade, no mark, no rank** (`prompts/00-DESIGN.md` §4.5). There is no field for one on
	//   the model, so there is nothing here to draw — and the sheet says so out loud, because a
	//   document that merely omits a mark will be read by somebody as one that lost it.
	//
	// What this sheet carries that the volunteer one does not is its own **basis**: `note` is the
	// count of lessons as it stood when a member of staff issued it, in words, written server-side
	// ("12 of 12 lessons, by the participant's own statements"). That phrase is the whole honesty of
	// the document — the course did not measure anybody, the participant said so.
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { formatDate } from '$lib/utils/datetime';
	import { getCompletion } from '$lib/services/course';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';
	import type { CourseCompletion } from '$lib/types/course';

	let data = $state<CourseCompletion | null>(null);
	let error = $state('');
	// The id-changed guard every dynamic route needs: `$effect` re-fires with no navigation at all
	// (frontend/CLAUDE.md trap 2). Keyed on the completion id, which is what the load depends on.
	let loadedFor = $state('');

	$effect(() => {
		const id = page.params.completionId;
		if (!id || id === loadedFor || !authStore.isAuthenticated) return;
		loadedFor = id;
		load(id);
	});

	async function load(id: string) {
		error = '';
		try {
			const found = await getCompletion(id);
			// Undefined is a 404, which is what a stranger gets — a 403 would confirm that somebody
			// finished a course, which is the fact this page exists to carry.
			if (!found) error = m.school_certificateNotFound(); // "This certificate is not available."
			data = found ?? null;
		} catch {
			error = m.common_error();
		}
	}

	const dates = $derived(
		data?.courseStartsOn
			? formatDate(data.courseStartsOn) +
					(data.courseEndsOn ? ` – ${formatDate(data.courseEndsOn)}` : '')
			: ''
	);
	// Who stood behind it. The issuer, or — once they have deleted their account, which nulls
	// `issued_by` rather than taking the certificate away — the person the course names as running
	// it. Built in the script rather than inline, for the reason the volunteer sheet records:
	// Prettier reflows an inline `{#if}` and the printed line gets its spacing wrong, which is
	// visible only on the screenshot.
	const issuer = $derived(data?.issuedBy?.displayName ?? data?.instructor.displayName ?? '');
	const today = new Date().toISOString();
</script>

<svelte:head><title>{pageTitle(m.school_certificatePageTitle())}</title></svelte:head>
<!-- "Certificate of completion" -->

<FeatureGate feature="courses">
	<div class="page">
		<div class="controls">
			<a href={resolve('/courses/[id]', { id: page.params.id ?? '' })}>
				{m.school_backToCourse()}
			</a>
			<!-- "Back to the course" -->
			<button type="button" onclick={() => window.print()}>{m.school_print()}</button>
			<!-- "Print" -->
		</div>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{:else if data}
			{#if data.isRevoked}
				<!-- A withdrawn certificate still RESOLVES (house rule 12 — the row is a tombstone, not
				     a delete), precisely so that somebody who printed it finds this sentence rather
				     than a 404. Outside the sheet AND inside it: the banner does not print. -->
				<p class="revoked" role="alert">{m.school_certificateRevokedWarning()}</p>
				<!-- "This certificate was withdrawn and is no longer valid." -->
			{/if}
			<!-- `print-area` is NOT decoration: `lib/styles/_print.scss` is global and hides
			     `body *` when printing, revealing only `.print-area` and its children. Without it this
			     sheet prints a **blank page** — which every assertion in the e2e passed through,
			     because the controls were correctly hidden and the text was correctly in the DOM. It
			     was found by looking at the print screenshot (house rule 2), and the same bug is
			     live on three other printable pages — see `HISTORY.md` §17BR.C, "Found outside this
			     step's scope". -->
			<article class="sheet print-area" class:sheet--revoked={data.isRevoked}>
				<h1>Zaświadczenie o ukończeniu kursu</h1>
				<h2>Certificate of course completion</h2>

				<dl>
					<dt>Uczestnik / Participant</dt>
					<dd>{data.participant.displayName}</dd>
					<dt>Kurs / Course</dt>
					<dd>{data.courseTitle}</dd>
					{#if dates}
						<dt>Termin / Dates</dt>
						<dd>{dates}</dd>
					{/if}
					{#if data.organization}
						<dt>Organizator / Run by</dt>
						<dd>{data.organization.name}</dd>
					{/if}
					<dt>Prowadzący / Course staff</dt>
					<dd>{issuer}</dd>
					<dt>Wystawiono / Issued</dt>
					<dd>{formatDate(data.issuedAt)}</dd>
				</dl>

				<h3>Podstawa / On what basis</h3>
				<!-- The server's own sentence, frozen when the certificate was issued. Printed as it
				     was written rather than recomposed here, so the document carries its own grounds
				     even after the course has grown a thirteenth week. -->
				<p class="basis">{data.note}</p>
				{#if data.lessonsTotal}
					<p class="status">{m.school_lessonsNow({ count: data.lessonsTotal })}</p>
					<!-- "The course now has {count} lessons." -->
				{/if}

				{#if data.isRevoked}
					<p class="basis basis--revoked">
						Zaświadczenie unieważnione {formatDate(data.revokedAt ?? '')}. / Withdrawn {formatDate(
							data.revokedAt ?? ''
						)}.
					</p>
				{/if}

				<p class="issued">
					Dokument nie zawiera oceny, stopnia ani miejsca w rankingu — EdMat nie wystawia ocen.
					Potwierdza wyłącznie, że uczestnik zadeklarował ukończenie wszystkich lekcji, a osoba
					prowadząca kurs to potwierdziła. <strong>Dokument niepodpisany</strong> — o podpisany
					egzemplarz należy zwrócić się do prowadzącego ({issuer}).
				</p>
				<p class="issued">
					This document carries no grade, mark or rank — EdMat does not grade anybody. It records
					only that the participant stated they had finished every lesson and that a member of the
					course's staff confirmed it. <strong>This copy is unsigned</strong> — ask the course staff
					({issuer}) for a signed one. Printed {formatDate(today)}.
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
	.sheet--revoked {
		opacity: 0.75;
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
	.basis {
		font-size: 0.92rem;
		margin: 0;
	}
	.basis--revoked {
		margin-top: 0.8rem;
		font-weight: 600;
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
	.error,
	.revoked {
		color: var(--status-danger, #c62828);
	}

	// The print sheet: the browser makes the PDF, so no server-side renderer and no new binary
	// dependency (CONFERENCE-BRIEF.md §1 rejects WeasyPrint for exactly this reason).
	@media print {
		.controls,
		.revoked {
			display: none;
		}
		.page {
			margin: 0;
			padding: 0;
			max-width: none;
		}
		.sheet {
			border: none;
			// The shared `.print-area` rule pins it with `position: absolute; inset: 0`, so give the
			// text a margin of its own or it sits flush against the paper's edge.
			padding: 1.5rem;
			opacity: 1;
		}
		:global(body) {
			background: #fff;
			color: #000;
		}
	}
</style>
