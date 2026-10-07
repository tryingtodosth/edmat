<script lang="ts">
	// Completion certificates on one course: the holder's own, the staff list, and the one form that
	// issues a new one.
	//
	// **One component for two audiences**, because the server already scoped the list for both:
	// `GET /courses/{id}/completions/` answers staff with every row and anybody else with their own
	// and nothing else. A client that fetched twice, or that filtered a wider list for itself, would
	// be a client that could filter it wrongly. So this draws what came back and lets `canCurate`
	// decide only which CONTROLS appear — never which rows.
	//
	// **It renders nothing when there is nothing to say.** A participant with no certificate on a
	// course that has issued none sees no heading, no empty state and no rule: a course that does not
	// use certificates should not grow a section announcing that it does not. Staff always see it,
	// because the form is theirs and an empty list is the thing they act on.
	//
	// Loaded here rather than carried on the course payload, unlike `lesson.progress`: a certificate
	// is read by the handful of people who have one and acted on once a term, and putting it in the
	// course response would cost a join on every course list for a row almost no course has.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getCompletions, issueCompletion, revokeCompletion } from '$lib/services/course';
	import { completionRefusalMessage } from '$lib/utils/labels';
	import { authStore } from '$lib/state/auth.svelte';
	import { formatDate } from '$lib/utils/datetime';
	import type { CourseCompletion, Enrollment } from '$lib/types/course';

	let {
		courseId,
		canCurate,
		participants = []
	}: {
		courseId: string;
		canCurate: boolean;
		/** The roster the page already has, so the picker needs no request of its own. Empty for
		 * anybody who may not read it, which is also everybody who may not issue a certificate. */
		participants?: Enrollment[];
	} = $props();

	let rows = $state<CourseCompletion[]>([]);
	let loaded = $state(false);
	let busy = $state(false);
	let error = $state('');
	let pickedParticipant = $state('');
	let note = $state('');
	// The id-changed guard every id-keyed load needs (frontend/CLAUDE.md trap 2 and 3): an `$effect`
	// re-fires with no navigation, and gating the first load in `onMount` instead would read
	// `isAuthenticated` once — possibly before `init()` resolves, which shows an empty list on a
	// hard reload despite a valid session.
	let loadedFor = $state('');

	$effect(() => {
		const id = courseId;
		if (!id || !authStore.isAuthenticated || id === loadedFor) return;
		loadedFor = id;
		load(id);
	});

	async function load(id: string) {
		try {
			rows = await getCompletions(id);
		} catch {
			// Silent on a read: a course whose certificate surface is unreachable (the `courses` flag
			// off for a non-staff reader) should lose the section, not grow an error banner in the
			// middle of somebody else's course page — the `VenuePanel` precedent.
			rows = [];
		} finally {
			loaded = true;
		}
	}

	const mine = $derived(rows.filter((row) => row.participant.id === authStore.user?.id));
	/** Everybody still on the roster who does not already hold one. The server refuses the rest with
	 * `already_issued`, and house rule 6 read from the other side says: do not offer a refusal. It
	 * cannot narrow further than that — whether somebody has ticked every lesson is the server's
	 * answer (`completion_block_reason`), and a client guessing at it would eventually guess wrong. */
	const issuable = $derived(
		participants.filter(
			(row) => row.status === 'active' && !rows.some((c) => c.participant.id === row.participant.id)
		)
	);
	const showsSomething = $derived(canCurate || mine.length > 0 || rows.length > 0);

	async function issue() {
		const participant = pickedParticipant;
		if (!participant || busy) return;
		busy = true;
		error = '';
		try {
			const made = await issueCompletion(courseId, participant, note.trim());
			rows = [made, ...rows];
			pickedParticipant = '';
			note = '';
		} catch (e) {
			// The server's own refusal word, turned into its own sentence — "they are not finished
			// yet" and "somebody already issued one" are the same 4xx to a boolean.
			error = completionRefusalMessage(e, m.common_error());
		} finally {
			busy = false;
		}
	}

	async function withdraw(id: string) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const updated = await revokeCompletion(id);
			rows = rows.map((row) => (row.id === id ? updated : row));
		} catch (e) {
			error = completionRefusalMessage(e, m.common_error());
		} finally {
			busy = false;
		}
	}

	function certificateHref(row: CourseCompletion) {
		return resolve('/courses/[id]/certificate/[completionId]', {
			id: courseId,
			completionId: row.id
		});
	}
</script>

{#if loaded && showsSomething}
	<section class="completions">
		<h2>{canCurate ? m.school_certificatesHeading() : m.school_myCertificateHeading()}</h2>
		<!-- "Completion certificates" / "Your certificate" -->

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		{#if rows.length === 0}
			<p class="muted">{m.school_noCompletions()}</p>
			<!-- "No certificates have been issued on this course yet." -->
		{:else}
			<ul>
				{#each rows as row (row.id)}
					<li class:revoked={row.isRevoked}>
						<div class="who">
							<strong>{row.participant.displayName}</strong>
							{#if row.isRevoked}
								<span class="badge"
									>{m.school_revokedOn({ date: formatDate(row.revokedAt ?? '') })}</span
								>
								<!-- "Withdrawn {date}" -->
							{/if}
							<p class="meta">
								{m.school_issuedBy({
									date: formatDate(row.issuedAt),
									issuer: row.issuedBy?.displayName ?? row.instructor.displayName
								})}
								<!-- "Issued {date} by {issuer}" -->
							</p>
							<!-- The basis the server froze at issue time. Shown in the panel as well as on
							     the sheet, because it is the one sentence that says what the certificate
							     does and does not claim. -->
							<p class="meta">{row.note}</p>
						</div>
						<div class="actions">
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above; the helper is opaque to the rule -->
							<a class="secondary" href={certificateHref(row)}>{m.school_openCertificate()}</a>
							<!-- "Open the certificate" -->
							{#if canCurate && !row.isRevoked}
								<button
									type="button"
									class="link danger"
									disabled={busy}
									onclick={() => withdraw(row.id)}
								>
									{m.school_revoke()}
									<!-- "Withdraw" -->
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if canCurate}
			<div class="issue">
				<h3>{m.school_issueHeading()}</h3>
				<!-- "Issue a certificate" -->
				<p class="muted">{m.school_issueBasis()}</p>
				<!-- "A certificate can only go to somebody whose own progress statements say every
				     lesson is done. It carries no grade, no mark and no rank." -->
				{#if issuable.length === 0}
					<p class="muted">{m.school_issueNobodyEligible()}</p>
					<!-- "Nobody has said yet that every lesson is done, so there is nobody to issue one to." -->
				{:else}
					<label class="field">
						<span>{m.school_issueWho()}</span>
						<!-- "To" -->
						<select bind:value={pickedParticipant}>
							<option value="">{m.school_issuePickPlaceholder()}</option>
							<!-- "Choose a participant" -->
							{#each issuable as row (row.id)}
								<option value={row.participant.id}>{row.participant.displayName}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>{m.school_issueNoteLabel()}</span>
						<!-- "A line to add to the certificate (optional)" -->
						<!-- `type="text"`-shaped input only: `bind:value` on a number input binds a real
						     number and every `.trim()` downstream throws (frontend/CLAUDE.md trap 1).
						     A textarea is the right control for a sentence anyway. -->
						<textarea bind:value={note} maxlength="300" rows="2"></textarea>
					</label>
					<button
						type="button"
						class="primary"
						disabled={busy || !pickedParticipant}
						onclick={issue}
					>
						{m.school_issue()}
						<!-- "Issue" -->
					</button>
				{/if}
			</div>
		{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.completions {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h2 {
		font-size: var(--font-size-base);
	}
	h3 {
		font-size: var(--font-size-sm);
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		justify-content: space-between;
		align-items: flex-start;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: var(--space-3);
	}
	li.revoked .who {
		color: var(--text-secondary);
	}
	.who {
		min-width: 0;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
	}
	.badge {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
		margin-left: 0.4em;
	}
	.meta,
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin: 0.2em 0 0;
	}
	.issue {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25em;
		font-size: var(--font-size-sm);
		max-width: 28rem;
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	button.primary {
		align-self: flex-start;
	}
</style>
