<script lang="ts">
	/** The call for contributions on an event's page (AUDIENCE-BRIEF.md §3.4): a proposal form
	 * while the call is open, the person's own proposals with their state and the decision, the
	 * accepted ones for everybody, and — for reviewers and organisers — the triage: review,
	 * revisions, accept, reject with a reason, schedule into the programme. Single-blind: a
	 * submitter is never shown who decided. */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { Audience } from '$lib/types';
	import type {
		Contribution,
		ContributionKind,
		ProposalStatus,
		ContributionVerb,
		EdmatEvent,
		ReasonCode,
		Track
	} from '$lib/types/event';
	import {
		getContributions,
		getTracks,
		proposeContribution,
		transitionContribution,
		updateContribution
	} from '$lib/services/events';
	import { authStore } from '$lib/state/auth.svelte';
	import { ApiError } from '$lib/api/client';
	import { formatDateTime } from '$lib/utils/datetime';
	import AudienceSelect from '$lib/components/shared/AudienceSelect.svelte';

	let { event, onchanged }: { event: EdmatEvent; onchanged?: () => void } = $props();

	let rows = $state<Contribution[]>([]);
	let tracks = $state<Track[]>([]);
	let loading = $state(true);
	let showForm = $state(false);
	let editing = $state<Contribution | null>(null);
	let busy = $state(false);
	let error = $state('');
	let kind = $state<ContributionKind>('talk');
	let title = $state('');
	let abstract = $state('');
	let audience = $state<Audience | ''>('');
	let coAuthorsText = $state('');
	let notes = $state('');
	let rejecting = $state<string | null>(null);
	let reasonCode = $state<ReasonCode>('out_of_scope');
	let decisionNote = $state('');
	let revising = $state<string | null>(null);
	let scheduling = $state<string | null>(null);
	let schedStart = $state('');
	let schedDuration = $state('30');
	let schedTrack = $state('');
	let schedPlace = $state('');

	const isStaff = $derived(event.canOrganise || event.canCheckIn);
	const KIND: Record<ContributionKind, () => string> = {
		talk: m.events_contribKind_talk,
		workshop: m.events_contribKind_workshop,
		poster: m.events_contribKind_poster,
		other: m.events_contribKind_other
	};
	const STATUS: Record<ProposalStatus, () => string> = {
		draft: m.events_contribStatus_draft,
		submitted: m.events_contribStatus_submitted,
		under_review: m.events_contribStatus_underReview,
		accepted: m.events_contribStatus_accepted,
		rejected: m.events_contribStatus_rejected,
		scheduled: m.events_contribStatus_scheduled,
		withdrawn: m.events_contribStatus_withdrawn
	};
	const REASON: Record<ReasonCode, () => string> = {
		out_of_scope: m.events_reason_outOfScope,
		duplicate: m.events_reason_duplicate,
		no_room: m.events_reason_noRoom,
		needs_revision: m.events_reason_needsRevision,
		other: m.events_reason_other
	};

	onMount(async () => {
		try {
			[rows, tracks] = await Promise.all([
				getContributions(event.id),
				event.canOrganise ? getTracks(event.id) : Promise.resolve([])
			]);
		} finally {
			loading = false;
		}
	});
	const mine = $derived(rows.filter((c) => authStore.user && c.submitter.id === authStore.user.id));
	const accepted = $derived(
		rows.filter(
			(c) =>
				(c.status === 'accepted' || c.status === 'scheduled') &&
				!(authStore.user && c.submitter.id === authStore.user.id)
		)
	);
	const queue = $derived(
		isStaff ? rows.filter((c) => c.status === 'submitted' || c.status === 'under_review') : []
	);
	const decided = $derived(
		isStaff
			? rows.filter(
					(c) =>
						['accepted', 'scheduled', 'rejected', 'withdrawn'].includes(c.status) &&
						!(authStore.user && c.submitter.id === authStore.user.id)
				)
			: []
	);

	function openForm(c: Contribution | null = null) {
		editing = c;
		kind = c?.kind ?? 'talk';
		title = c?.title ?? '';
		abstract = c?.abstract ?? '';
		audience = c?.audience ?? '';
		coAuthorsText = (c?.coAuthors ?? [])
			.map((a) => (a.affiliation ? `${a.name} (${a.affiliation})` : a.name))
			.join(', ');
		notes = c?.notesToOrganiser ?? '';
		error = '';
		showForm = true;
	}
	function parseCoAuthors(text: string) {
		return text
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => {
				const mm = s.match(/^(.*?)\s*\((.*)\)$/);
				return mm
					? { name: mm[1].trim(), affiliation: mm[2].trim() }
					: { name: s, affiliation: '' };
			});
	}
	function replace(updated: Contribution) {
		rows = rows.some((r) => r.id === updated.id)
			? rows.map((r) => (r.id === updated.id ? updated : r))
			: [updated, ...rows];
		onchanged?.();
	}
	async function submitForm(e: SubmitEvent) {
		e.preventDefault();
		if (!title.trim() || !audience) return;
		busy = true;
		error = '';
		const draft = {
			kind,
			title: title.trim(),
			abstract: abstract.trim(),
			audience: audience as Audience,
			coAuthors: parseCoAuthors(coAuthorsText),
			notesToOrganiser: notes.trim()
		};
		try {
			replace(
				editing
					? await updateContribution(event.id, editing.id, draft)
					: await proposeContribution(event.id, draft)
			);
			showForm = false;
			editing = null;
		} catch (err) {
			error =
				err instanceof ApiError
					? Object.values((err.body as Record<string, unknown>) ?? {})
							.flat()
							.join(' ') || m.common_error()
					: m.common_error();
		} finally {
			busy = false;
		}
	}
	async function act(c: Contribution, verb: ContributionVerb, extra: Record<string, unknown> = {}) {
		error = '';
		try {
			replace(await transitionContribution(event.id, c.id, verb, extra));
			rejecting = null;
			revising = null;
			scheduling = null;
			decisionNote = '';
		} catch (err) {
			const detail =
				err instanceof ApiError
					? (err.body as { detail?: string; starts_at?: string[] } | undefined)
					: undefined;
			error = detail?.starts_at?.join(' ') ?? detail?.detail ?? m.common_error();
		}
	}
	function schedule(c: Contribution) {
		if (!schedStart) return;
		void act(c, 'schedule', {
			starts_at: new Date(schedStart).toISOString(),
			duration_minutes: Math.max(5, parseInt(schedDuration, 10) || 30),
			track: schedTrack || null,
			location_text: schedPlace.trim()
		});
	}
</script>

<section class="contributions">
	<div class="head">
		<h2>{m.events_contributions()}</h2>
		{#if event.callIsOpen}
			<span class="open"
				>{m.events_callOpen()}{#if event.cfpDeadline}
					· {m.events_callUntil({ when: formatDateTime(event.cfpDeadline) })}{/if}</span
			>
			{#if authStore.isAuthenticated && !showForm}
				<button type="button" class="primary" onclick={() => openForm()}
					>{m.events_propose()}</button
				>
			{/if}
		{:else if event.cfpOpen}
			<span class="open">{m.events_callClosed()}</span>
		{/if}
	</div>
	{#if !event.callIsOpen && !event.cfpOpen && rows.length === 0 && !isStaff}
		<!-- No call, nothing accepted, nothing to show a visitor. -->
	{:else}
		{#if showForm}
			<form class="propose" onsubmit={submitForm}>
				<h3>{editing ? m.events_proposeEdit() : m.events_propose()}</h3>
				<div class="row">
					<label class="field grow"
						><span>{m.events_sessionTitle()}</span><input
							type="text"
							bind:value={title}
							required
							maxlength="200"
						/></label
					>
					<label class="field"
						><span>{m.events_sessionKind()}</span><select bind:value={kind}
							>{#each Object.keys(KIND) as k (k)}<option value={k}
									>{KIND[k as ContributionKind]()}</option
								>{/each}</select
						></label
					>
				</div>
				<AudienceSelect bind:value={audience} />
				<label class="field"
					><span>{m.events_proposeAbstract()}</span><textarea rows="4" bind:value={abstract}
					></textarea></label
				>
				<label class="field"
					><span>{m.events_proposeCoAuthors()} <em>({m.common_optional()})</em></span><input
						type="text"
						bind:value={coAuthorsText}
						placeholder={m.events_proposeCoAuthorsHint()}
					/></label
				>
				<label class="field"
					><span>{m.events_proposeNotes()} <em>({m.common_optional()})</em></span><textarea
						rows="2"
						bind:value={notes}
						maxlength="500"></textarea></label
				>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<div class="actions">
					<button type="submit" class="primary" disabled={busy}
						>{editing ? m.common_save() : m.events_proposeSend()}</button
					>
					<button type="button" onclick={() => (showForm = false)}>{m.common_cancel()}</button>
				</div>
			</form>
		{/if}

		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else}
			{#if mine.length > 0}
				<h3>{m.events_myProposals()}</h3>
				<ul class="list">
					{#each mine as c (c.id)}
						<li class="card card--{c.status}">
							<div class="card__head">
								<strong>{c.title}</strong>
								<span class="pill pill--{c.status}">{STATUS[c.status]()}</span>
								<span class="kind">{KIND[c.kind]()}</span>
							</div>
							{#if c.reviewNote}<p class="note">
									{#if c.reasonCode}<em>{REASON[c.reasonCode as ReasonCode]()}:</em>
									{/if}{c.reviewNote}
								</p>{/if}
							{#if c.status === 'scheduled' && c.sessionId}<p class="note">
									{m.events_proposalScheduled()}
								</p>{/if}
							<div class="actions">
								{#if c.canEdit}<button type="button" onclick={() => openForm(c)}
										>{m.common_edit()}</button
									>{/if}
								{#if c.status === 'draft'}<button
										type="button"
										class="primary"
										onclick={() => act(c, 'submit')}>{m.events_proposeSend()}</button
									>{/if}
								{#if c.status === 'submitted'}<button
										type="button"
										onclick={() => act(c, 'unsubmit')}>{m.events_proposalPullBack()}</button
									>{/if}
								{#if !['withdrawn', 'rejected'].includes(c.status)}<button
										type="button"
										class="danger"
										onclick={() => act(c, 'withdraw')}>{m.events_proposalWithdraw()}</button
									>{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if isStaff && queue.length > 0}
				<h3>{m.events_reviewQueue({ count: queue.length })}</h3>
				<ul class="list">
					{#each queue as c (c.id)}
						<li class="card">
							<div class="card__head">
								<strong>{c.title}</strong>
								<span class="pill pill--{c.status}">{STATUS[c.status]()}</span>
								<span class="kind">{KIND[c.kind]()}</span>
								·
								<a href={resolve('/users/[id]', { id: c.submitter.id })}
									>{c.submitter.displayName}</a
								>
								{#if c.coAuthors.length > 0}<span class="kind"
										>+ {c.coAuthors.map((a) => a.name).join(', ')}</span
									>{/if}
							</div>
							{#if c.abstract}<p class="abstract">{c.abstract}</p>{/if}
							{#if c.notesToOrganiser}<p class="note">
									<em>{m.events_proposeNotes()}:</em>
									{c.notesToOrganiser}
								</p>{/if}
							<div class="actions">
								{#if c.status === 'submitted'}<button type="button" onclick={() => act(c, 'review')}
										>{m.events_startReview()}</button
									>{/if}
								<button type="button" class="primary" onclick={() => act(c, 'accept')}
									>{m.events_accept()}</button
								>
								<button
									type="button"
									class="danger"
									onclick={() => (rejecting = rejecting === c.id ? null : c.id)}
									>{m.events_decline()}</button
								>
								{#if c.status === 'under_review'}<button
										type="button"
										onclick={() => (revising = revising === c.id ? null : c.id)}
										>{m.events_requestRevisions()}</button
									>{/if}
							</div>
							{#if rejecting === c.id}
								<div class="decide">
									<select bind:value={reasonCode} aria-label={m.events_reason()}
										>{#each Object.keys(REASON) as r (r)}<option value={r}
												>{REASON[r as ReasonCode]()}</option
											>{/each}</select
									>
									<input
										type="text"
										bind:value={decisionNote}
										placeholder={m.events_decisionNote()}
										aria-label={m.events_decisionNote()}
									/>
									<button
										type="button"
										class="danger"
										onclick={() =>
											act(c, 'reject', { reason_code: reasonCode, note: decisionNote })}
										>{m.events_declineConfirm()}</button
									>
								</div>
							{/if}
							{#if revising === c.id}
								<div class="decide">
									<input
										type="text"
										bind:value={decisionNote}
										placeholder={m.events_revisionsNote()}
										aria-label={m.events_revisionsNote()}
									/>
									<button type="button" onclick={() => act(c, 'revisions', { note: decisionNote })}
										>{m.events_requestRevisions()}</button
									>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if accepted.length > 0 || decided.length > 0}
				<h3>{m.events_acceptedProposals()}</h3>
				<ul class="list">
					{#each isStaff ? decided : accepted as c (c.id)}
						<li class="card card--{c.status}">
							<div class="card__head">
								<strong>{c.title}</strong>
								<span class="pill pill--{c.status}">{STATUS[c.status]()}</span>
								<span class="kind">{KIND[c.kind]()}</span>
								·
								<a href={resolve('/users/[id]', { id: c.submitter.id })}
									>{c.submitter.displayName}</a
								>
							</div>
							{#if c.abstract && c.status !== 'rejected'}<p class="abstract">{c.abstract}</p>{/if}
							{#if isStaff && c.decidedBy}<p class="note">
									{m.events_decidedBy({ name: c.decidedBy.displayName })}{#if c.reasonCode}
										· {REASON[c.reasonCode as ReasonCode]()}{/if}
								</p>{/if}
							{#if event.canOrganise}
								<div class="actions">
									{#if c.status === 'accepted'}
										<button
											type="button"
											class="primary"
											onclick={() => (scheduling = scheduling === c.id ? null : c.id)}
											>{m.events_scheduleIt()}</button
										>
									{:else if c.status === 'scheduled'}
										<button type="button" onclick={() => act(c, 'unschedule')}
											>{m.events_unschedule()}</button
										>
									{/if}
								</div>
								{#if scheduling === c.id}
									<div class="decide">
										<input
											type="datetime-local"
											bind:value={schedStart}
											aria-label={m.events_form_startsAt()}
										/>
										<input
											type="text"
											inputmode="numeric"
											bind:value={schedDuration}
											aria-label={m.events_form_duration()}
											placeholder={m.events_form_duration()}
										/>
										{#if tracks.length > 0}<select
												bind:value={schedTrack}
												aria-label={m.events_track()}
												><option value="">{m.events_trackNone()}</option
												>{#each tracks as t (t.id)}<option value={t.id}>{t.name}</option
													>{/each}</select
											>{/if}
										<input
											type="text"
											bind:value={schedPlace}
											placeholder={m.events_form_locationText()}
											aria-label={m.events_form_locationText()}
										/>
										<button type="button" class="primary" onclick={() => schedule(c)}
											>{m.events_scheduleConfirm()}</button
										>
									</div>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if error && !showForm}<p class="error" role="alert">{error}</p>{/if}
		{/if}
	{/if}
</section>

<style lang="scss">
	.contributions {
		margin-top: 1.5rem;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.head h2 {
		margin: 0;
	}
	.open {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	h3 {
		margin: 1rem 0 0.4rem;
		font-size: 1rem;
	}
	button {
		min-height: 36px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.danger {
		color: var(--status-danger);
	}
	.propose {
		display: grid;
		gap: 0.6rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1rem;
		margin-top: 0.6rem;
		background: var(--bg-surface);
	}
	.propose h3 {
		margin: 0;
	}
	.row {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.9rem;
	}
	.grow {
		flex: 1 1 14rem;
	}
	input,
	select,
	textarea {
		font: inherit;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		min-height: 40px;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}
	.card {
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg-surface);
	}
	.card--rejected,
	.card--withdrawn {
		opacity: 0.7;
	}
	.card__head {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border);
	}
	.pill--accepted,
	.pill--scheduled {
		background: var(--status-success-bg);
		color: var(--status-success);
		border-color: transparent;
	}
	.pill--submitted,
	.pill--under_review {
		background: var(--status-warning-bg);
		color: var(--status-warning);
		border-color: transparent;
	}
	.pill--rejected {
		background: var(--status-danger-bg);
		color: var(--status-danger);
		border-color: transparent;
	}
	.kind,
	.note,
	.status {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.abstract,
	.note {
		margin: 0.25rem 0;
	}
	.actions,
	.decide {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-top: 0.4rem;
		align-items: center;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
</style>
