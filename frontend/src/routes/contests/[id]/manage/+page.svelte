<script lang="ts">
	/**
	 * Running the contest (CONTESTS-BRIEF.md §3.A item 8): the registrations queue, the staff
	 * roster, the complaints inbox, the transitions, the compliance panel at full size, and the
	 * danger zone.
	 *
	 * **The consent column is visible in the queue**, deliberately: an organiser accepting a
	 * pupil's entry needs to see that a guardian's name and consent are on it, because they are the
	 * person who is accountable for having them. It is not shown anywhere else.
	 *
	 * **Cancelling is a transition, not a delete** (house rule 12). Art. 919 §2 says a revocation
	 * must go out through the same channel as the announcement, and must not strip anybody who
	 * already performed — so a cancelled contest keeps its page, its entries and its record, and
	 * the danger zone says so instead of offering a button that destroys them.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import CompliancePanel from '$lib/components/contest/CompliancePanel.svelte';
	import StatusStrip from '$lib/components/contest/StatusStrip.svelte';
	import RolePicker from '$lib/components/contest/RolePicker.svelte';
	import {
		addContestStaff,
		announceContest,
		answerComplaint,
		decideRegistration,
		disqualifyRegistration,
		getComplaints,
		getCompliance,
		getContest,
		getContestPresets,
		getContestStaff,
		getPeopleSuggestions,
		getRegistrations,
		publishResults,
		refusalWord,
		removeContestStaff,
		transitionContest,
		unpublishResults
	} from '$lib/services/contests';
	import { contestRefusalMessage } from '$lib/utils/labels';
	import { contestStaffRoleLabel } from '$lib/utils/labels';
	import { formatDate } from '$lib/utils/datetime';
	import type {
		CompliancePayload,
		Contest,
		ContestComplaint,
		ContestRegistrationRow,
		ContestStaffRole,
		ContestStaffRow,
		LawCitation,
		SuggestedPerson
	} from '$lib/types/contest';

	let contest = $state<Contest | null>(null);
	let registrations = $state<ContestRegistrationRow[]>([]);
	let staff = $state<ContestStaffRow[]>([]);
	let complaints = $state<ContestComplaint[]>([]);
	let compliance = $state<CompliancePayload | null>(null);
	let law = $state<Record<string, LawCitation>>({});
	let people = $state<SuggestedPerson[]>([]);
	let peopleLoading = $state(true);
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state('');
	let message = $state('');
	let busy = $state(false);
	let loadedFor = $state('');

	let newRole = $state<ContestStaffRole>('jury');
	let newPeople = $state<string[]>([]);
	let answers = $state<Record<string, string>>({});
	let cancelling = $state(false);

	$effect(() => {
		const id = page.params.id;
		const key = `${id}:${authStore.user?.id ?? 'anon'}`;
		if (!id || key === loadedFor) return;
		loadedFor = key;
		void load(id);
	});

	async function load(id: string) {
		loading = true;
		notFound = false;
		try {
			contest = await getContest(id);
			registrations = await getRegistrations(id);
			staff = await getContestStaff(id);
			complaints = await getComplaints(id);
			compliance = await getCompliance(id);
			law = (await getContestPresets()).law;
		} catch {
			notFound = true;
		} finally {
			loading = false;
		}
		try {
			people = await getPeopleSuggestions();
		} catch {
			people = [];
		} finally {
			peopleLoading = false;
		}
	}

	async function run(action: () => Promise<unknown>, done?: string) {
		busy = true;
		error = '';
		message = '';
		try {
			await action();
			if (done) message = done;
			loadedFor = '';
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	async function addPeople() {
		if (!contest) return;
		const ids = [...newPeople];
		newPeople = [];
		await run(async () => {
			for (const id of ids) await addContestStaff(contest!.id, id, newRole);
		}, m.contests_staffAdded());
		// "Added."
	}

	const waiting = $derived(registrations.filter((r) => r.status === 'requested'));
	const accepted = $derived(registrations.filter((r) => r.status === 'accepted'));
	const others = $derived(
		registrations.filter((r) => r.status !== 'requested' && r.status !== 'accepted')
	);
	const openComplaints = $derived(complaints.filter((c) => c.status === 'open'));
</script>

<PageHead
	title={m.contests_managePageTitle({ title: contest?.title ?? '' })}
	description={m.contests_managePageDescription()}
	noindex
/>
<!-- "Running {title}" / "The organiser's own page: entries, the jury, complaints, results and the legal checklist." -->

<FeatureGate feature="contests">
	<div class="page">
		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if notFound || !contest}
			<p class="muted">{m.contests_notFound()}</p>
		{:else if !contest.canManage}
			<p class="muted">{contestRefusalMessage('not_manager')}</p>
		{:else}
			<nav class="crumbs">
				<a href={resolve('/contests/[id]', { id: contest.id })}>{m.contests_backToContest()}</a>
				<a href={resolve('/contests/[id]/rules', { id: contest.id })}>{m.contests_rulesLink()}</a>
			</nav>

			<h1>{m.contests_manageHeading({ title: contest.title })}</h1>
			<!-- "Running: {title}" -->

			<StatusStrip status={contest.status} />

			{#if message}
				<p class="ok" role="status">{message}</p>
			{/if}
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			<!-- ---- the lifecycle ---------------------------------------------------------- -->
			<section class="block">
				<h2>{m.contests_transitionsHeading()}</h2>
				<!-- "Where it is up to" -->
				{#if contest.status === 'draft'}
					{#if contest.announceBlockReason}
						<p class="warn">
							{m.contests_cannotAnnounceYet()}
							{contestRefusalMessage(contest.announceBlockReason)}
						</p>
					{:else}
						<p class="muted">{m.contests_announceReady()}</p>
						<!-- "Everything the law asks for before an announcement is in place. Announcing makes the contest public and the promise binding." -->
					{/if}
					<button
						type="button"
						class="primary"
						disabled={busy || contest.announceBlockReason !== null}
						onclick={() => run(() => announceContest(contest!.id), m.contests_announced())}
					>
						{m.contests_announce()}
						<!-- "Announce the contest" -->
					</button>
				{:else if contest.status === 'announced'}
					<button
						type="button"
						class="primary"
						disabled={busy}
						onclick={() => run(() => transitionContest(contest!.id, 'registration_open'))}
					>
						{m.contests_openRegistration()}
						<!-- "Open entries" -->
					</button>
				{:else if contest.status === 'registration_open'}
					<button
						type="button"
						disabled={busy}
						onclick={() => run(() => transitionContest(contest!.id, 'running'))}
					>
						{m.contests_startRunning()}
						<!-- "Close entries and start" -->
					</button>
				{:else if contest.status === 'running'}
					<button
						type="button"
						disabled={busy}
						onclick={() => run(() => transitionContest(contest!.id, 'judging'))}
					>
						{m.contests_startJudging()}
						<!-- "Move to judging" -->
					</button>
				{:else if contest.status === 'judging'}
					<button
						type="button"
						class="primary"
						disabled={busy}
						onclick={() => run(() => publishResults(contest!.id), m.contests_resultsPublished())}
					>
						{m.contests_publishResults()}
						<!-- "Publish the results" -->
					</button>
					<p class="muted">{m.contests_publishResultsNote()}</p>
					<!-- "Every stage has to be scored first, and a regulamin has to be published. Publishing starts the complaints window." -->
				{:else if contest.status === 'results_published'}
					<p class="muted">
						{m.contests_windowCloses({
							date: contest.complaintsCloseAt ? formatDate(contest.complaintsCloseAt) : '—'
						})}
						<!-- "The complaints window closes {date}. Until then the results can be taken down and republished; afterwards they are the record." -->
					</p>
					<button
						type="button"
						disabled={busy}
						onclick={() => run(() => unpublishResults(contest!.id))}
					>
						{m.contests_unpublishResults()}
						<!-- "Take the results down" -->
					</button>
					<button
						type="button"
						disabled={busy || openComplaints.length > 0}
						onclick={() => run(() => transitionContest(contest!.id, 'closed'))}
					>
						{m.contests_close()}
						<!-- "Close the contest" -->
					</button>
					{#if openComplaints.length > 0}
						<p class="muted">
							{m.contests_cannotCloseWithComplaints({ count: openComplaints.length })}
							<!-- "{count} complaints are still waiting for an answer." -->
						</p>
					{/if}
				{:else}
					<p class="muted">{contestRefusalMessage('closed')}</p>
				{/if}
			</section>

			<!-- ---- the queue --------------------------------------------------------------- -->
			<section class="block">
				<h2>{m.contests_queueHeading({ waiting: waiting.length, accepted: accepted.length })}</h2>
				<!-- "Entries — {waiting} waiting, {accepted} accepted" -->
				{#if registrations.length === 0}
					<p class="muted">{m.contests_noEntriesYet()}</p>
					<!-- "Nobody has entered yet." -->
				{:else}
					<table>
						<thead>
							<tr>
								<th scope="col">#</th>
								<th scope="col">{m.contests_colWho()}</th>
								<th scope="col">{m.contests_colAffiliation()}</th>
								<!-- "School / faculty" -->
								<th scope="col">{m.contests_colConsent()}</th>
								<!-- "Guardian's consent" -->
								<th scope="col">{m.contests_colNameConsent()}</th>
								<!-- "Name may be published" -->
								<th scope="col">{m.contests_colStatus()}</th>
								<!-- "Status" -->
								<th scope="col"><span class="sr-only">{m.contests_colActions()}</span></th>
								<!-- "Actions" -->
							</tr>
						</thead>
						<tbody>
							{#each registrations as row (row.id)}
								<tr>
									<td>{row.number}</td>
									<td>
										{row.user?.displayName ?? '—'}
										{#if row.teamName}<span class="muted">· {row.teamName}</span>{/if}
									</td>
									<td>{row.affiliation || '—'}</td>
									<td>
										{#if row.hasGuardianConsent}
											<span class="yes">{m.contests_consentYes({ name: row.guardianName })}</span>
											<!-- "yes — {name}" -->
										{:else}
											<span class="muted">{m.contests_consentNotNeeded()}</span>
											<!-- "not needed (adult)" -->
										{/if}
									</td>
									<td>
										{row.publishName ? m.contests_yes() : m.contests_no()}
										<!-- "yes" / "no" -->
									</td>
									<td>{row.status}</td>
									<td class="actions">
										{#if row.status === 'requested'}
											<button
												type="button"
												disabled={busy}
												onclick={() => run(() => decideRegistration(row.id, 'accepted'))}
											>
												{m.contests_accept()}
												<!-- "Accept" -->
											</button>
											<button
												type="button"
												disabled={busy}
												onclick={() => run(() => decideRegistration(row.id, 'declined'))}
											>
												{m.contests_decline()}
												<!-- "Decline" -->
											</button>
										{:else if row.status === 'accepted'}
											<button
												type="button"
												disabled={busy}
												onclick={() => run(() => disqualifyRegistration(row.id))}
											>
												{m.contests_disqualify()}
												<!-- "Disqualify" -->
											</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if others.length > 0}
						<p class="muted">{m.contests_queueKeptNote()}</p>
						<!-- "Declined, withdrawn and disqualified entries stay on this list on purpose: who entered, when, and what was decided is part of the record." -->
					{/if}
				{/if}
			</section>

			<!-- ---- the roster --------------------------------------------------------------- -->
			<section class="block">
				<h2>{m.contests_rosterHeading()}</h2>
				<!-- "Who runs it with you" -->
				<ul class="roster">
					<li>
						<strong>{contest.organiser?.displayName ?? '—'}</strong>
						<span class="muted">{contestStaffRoleLabel('organiser')()}</span>
						<span class="muted">{m.contests_founderNote()}</span>
						<!-- "founded it — cannot be removed" -->
					</li>
					{#each staff as row (row.id)}
						<li>
							<strong>{row.user?.displayName ?? '—'}</strong>
							<span class="muted">{contestStaffRoleLabel(row.role)()}</span>
							<button
								type="button"
								disabled={busy}
								onclick={() => run(() => removeContestStaff(row.id))}
							>
								{m.contests_staffRemove()}
								<!-- "Remove" -->
							</button>
						</li>
					{/each}
				</ul>

				<div class="add-staff">
					<label>
						<span>{m.contests_staffRole()}</span>
						<!-- "As" -->
						<select bind:value={newRole}>
							{#each ['jury', 'secretary', 'proctor', 'organiser'] as role (role)}
								<option value={role}>{contestStaffRoleLabel(role as ContestStaffRole)()}</option>
							{/each}
						</select>
					</label>
					<RolePicker role={newRole} {people} loading={peopleLoading} bind:chosen={newPeople} />
					<button
						type="button"
						class="primary"
						disabled={busy || newPeople.length === 0}
						onclick={addPeople}
					>
						{m.contests_staffAdd()}
						<!-- "Add them" -->
					</button>
				</div>
			</section>

			<!-- ---- complaints ---------------------------------------------------------------- -->
			<section class="block">
				<h2>{m.contests_complaintsInbox({ count: openComplaints.length })}</h2>
				<!-- "Complaints — {count} waiting" -->
				{#if complaints.length === 0}
					<p class="muted">{m.contests_noComplaints()}</p>
					<!-- "No complaints." -->
				{:else}
					<ul class="list">
						{#each complaints as complaint (complaint.id)}
							<li>
								<p class="list__head">
									{m.contests_complaintFrom({ number: complaint.registrationNumber })}
									· {formatDate(complaint.createdAt)}
								</p>
								<p class="list__text">{complaint.text}</p>
								{#if complaint.status === 'open'}
									<label>
										<span>{m.contests_complaintAnswerLabel()}</span>
										<!-- "Your answer, with reasons" -->
										<textarea rows="3" bind:value={answers[complaint.id]}></textarea>
									</label>
									<button
										type="button"
										class="primary"
										disabled={busy || (answers[complaint.id] ?? '').trim().length < 10}
										onclick={() =>
											run(
												() => answerComplaint(complaint.id, answers[complaint.id].trim()),
												m.contests_complaintAnswerSent()
											)}
									>
										{m.contests_complaintAnswerSend()}
										<!-- "Send the answer" -->
									</button>
								{:else}
									<blockquote>
										<p>{complaint.answer}</p>
										<footer>{complaint.answeredBy?.displayName ?? ''}</footer>
									</blockquote>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				<p class="muted">{m.contests_complaintsDuty()}</p>
				<!-- "Every complaint must be answered within the window, with reasons. That is what keeps the contest's own rules enforceable, and a 7-day window has been held abusive where the organiser is a business." -->
			</section>

			<!-- ---- the panel, at full size ---------------------------------------------------- -->
			{#if compliance}
				<CompliancePanel report={compliance} {law} checklist={contest.preset?.checklist ?? []} />
			{/if}

			<!-- ---- the danger zone ------------------------------------------------------------- -->
			<section class="block block--danger">
				<h2>{m.contests_dangerHeading()}</h2>
				<!-- "Cancelling" -->
				<p class="muted">{m.contests_cancelNote()}</p>
				<!-- "A cancellation has to be announced in the same place the contest was announced, and it cannot take a prize away from somebody who has already earned it. So the page, the entries and the results stay: the contest is marked cancelled, not deleted." -->
				{#if contest.status !== 'closed' && contest.status !== 'cancelled'}
					{#if !cancelling}
						<button type="button" onclick={() => (cancelling = true)}>
							{m.contests_cancel()}
							<!-- "Cancel this contest" -->
						</button>
					{:else}
						<p class="warn">{m.contests_cancelConfirm()}</p>
						<!-- "This cannot be undone. Everybody who entered will see that it was cancelled." -->
						<button
							type="button"
							disabled={busy}
							onclick={() => run(() => transitionContest(contest!.id, 'cancelled'))}
						>
							{m.contests_cancelYes()}
							<!-- "Yes, cancel it" -->
						</button>
						<button type="button" disabled={busy} onclick={() => (cancelling = false)}>
							{m.common_cancel()}
						</button>
					{/if}
				{/if}
			</section>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

	.page {
		max-width: 1000px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.crumbs {
		display: flex;
		gap: 0.8rem;
		font-size: var(--font-size-sm);
	}
	h1 {
		margin: 0;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: var(--font-size-md);
	}
	.block {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.block--danger {
		border-color: var(--status-danger);
	}
	.muted {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		max-width: 70ch;
	}
	.warn {
		margin: 0;
		font-size: var(--font-size-sm);
		border-left: 3px solid var(--status-warning);
		padding-left: 0.6rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}
	th,
	td {
		text-align: left;
		padding: 0.3rem 0.4rem;
		border-bottom: 1px solid var(--border-color);
		vertical-align: top;
	}
	thead th {
		color: var(--text-secondary);
	}
	.yes {
		color: var(--status-success);
	}
	td.actions {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.roster {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: var(--font-size-sm);
	}
	.roster li {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.add-staff {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		width: 100%;
	}
	.add-staff label,
	.list label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: var(--font-size-sm);
		max-width: 22rem;
	}
	select,
	textarea {
		padding: 0.35rem 0.45rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: 100%;
	}
	.list li {
		border-left: 3px solid var(--border-color);
		padding-left: 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		align-items: flex-start;
	}
	.list__head {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.list__text {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	blockquote {
		margin: 0;
		padding: 0.4rem 0.6rem;
		border-left: 3px solid var(--status-success);
		background: var(--bg-surface-alt);
		font-size: var(--font-size-sm);
	}
	blockquote p {
		margin: 0;
	}
	blockquote footer {
		margin-top: 0.2rem;
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
	button.primary {
		@include mix.button-primary;
	}
	button:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.ok {
		margin: 0;
		color: var(--status-success);
	}
	.error {
		margin: 0;
		color: var(--status-danger);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
