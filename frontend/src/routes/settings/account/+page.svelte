<script lang="ts">
	// Settings → Account: download a copy of your data (GDPR Art. 15/20) and delete the account
	// (Art. 17). The address is fixed — it is the data-deletion URL a sign-in provider's console is
	// given (Facebook asks for one), so it must not move.
	//
	// Everything shown under "Delete your account" comes from the server's registry
	// (`backend/accounts/erasure.py`): the same table that carries the deletion out, so this page can
	// never promise one thing while the erasure does another. Nothing here decides what happens.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		downloadMyData,
		ERASURE_ACTIONS,
		getErasurePlan,
		requestErasure,
		type ErasureAction,
		type ErasureBlocker,
		type ErasurePlan
	} from '$lib/services/account';
	import { formatDate } from '$lib/utils/datetime';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	let plan = $state<ErasurePlan | null>(null);
	let loadError = $state(false);
	let loadedOnce = false;

	let exportState = $state<'idle' | 'busy' | 'done' | 'throttled' | 'error'>('idle');

	let typedUsername = $state('');
	let password = $state('');
	let submitting = $state(false);
	let deleteError = $state('');
	let scheduledFor = $state<string | null>(null);

	const user = $derived(authStore.user);

	// An $effect keyed on the session, not onMount — a hard reload resolves the session after mount
	// (frontend/CLAUDE.md, Svelte trap 3).
	$effect(() => {
		if (!authStore.isAuthenticated || loadedOnce) return;
		loadedOnce = true;
		load();
	});
	onMount(() => {
		if (authStore.isAuthenticated && !loadedOnce) {
			loadedOnce = true;
			load();
		}
	});

	async function load() {
		try {
			plan = await getErasurePlan();
		} catch {
			loadError = true;
		}
	}

	async function download() {
		exportState = 'busy';
		try {
			const blob = await downloadMyData();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `edmat-data-${new Date().toISOString().slice(0, 10)}.json`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			exportState = 'done';
		} catch (e) {
			exportState = e instanceof ApiError && e.status === 429 ? 'throttled' : 'error';
		}
	}

	const ACTION_LABEL: Record<ErasureAction, () => string> = {
		delete: m.account_action_delete, // "Deleted"
		anonymise: m.account_action_anonymise, // "Stays published, without your name"
		keep: m.account_action_keep, // "Kept as a record, without your name"
		end: m.account_action_end // "Ended — the other side is told"
	};
	const ACTION_WHY: Record<ErasureAction, () => string> = {
		delete: m.account_why_delete, // "Private to you — nobody else relies on it."
		anonymise: m.account_why_anonymise, // "Published under the content licence…"
		keep: m.account_why_keep, // "A record other people rely on…"
		end: m.account_why_end // "Still under way with somebody else…"
	};
	// Mirrors `accounts.erasure.GROUPS` (backend) — a hand-kept copy, house rule 13. An unknown group
	// (the backend added one) falls back to its key rather than breaking the page.
	const GROUP_LABEL: Record<string, () => string> = {
		account: m.account_what_account, // "Your profile, picture and settings"
		sign_in: m.account_what_sign_in, // "Sign-in: password, tokens, linked accounts…"
		notifications: m.account_what_notifications, // "Notifications and the e-mail digest setting"
		history: m.account_what_history, // "Which exercises and materials you opened"
		follows: m.account_what_follows, // "Followed tags, watched listings, bookmarks, saved comments"
		study: m.account_what_study, // "Study sets, flashcards, course notes and progress"
		education: m.account_what_education, // "Education profile, diplomas, grades, certificates"
		tutoring: m.account_what_tutoring, // "Tutoring listings and availability"
		bookings: m.account_what_bookings, // "Tutoring bookings"
		participation: m.account_what_participation, // "Enrolments, registrations, contest entries, shifts"
		roles: m.account_what_roles, // "Roles: staff, membership, task assignments"
		applications: m.account_what_applications, // "Applications and offers"
		submissions: m.account_what_submissions, // "Exercise submissions and edit suggestions"
		contributions: m.account_what_contributions, // "Exercises, solutions, translations, materials…"
		discussion: m.account_what_discussion, // "Comments, reviews and posts"
		votes: m.account_what_votes, // "Votes and poll ballots"
		hosted: m.account_what_hosted, // "Courses, events, contests… you created"
		records: m.account_what_records, // "Decisions you made as a reviewer, moderator or organiser"
		reports: m.account_what_reports, // "Reports, notices and bug reports you filed"
		terms: m.account_what_terms, // "Your acceptance of the terms of use"
		messages: m.account_what_messages, // "Private messages"
		feed: m.account_what_feed, // "Your entries in the activity feed"
		mail: m.account_what_mail, // "The log of e-mails we sent you"
		request_log: m.account_what_request_log, // "The server's request log"
		audit: m.account_what_audit // "The administrative record of what you did"
	};

	const byAction = $derived(
		ERASURE_ACTIONS.map((action) => ({
			action,
			items: (plan?.plan ?? []).filter((p) => p.action === action)
		})).filter((g) => g.items.length > 0)
	);

	const BLOCKER_REASON: Record<ErasureBlocker['reason'], () => string> = {
		course_has_participants: m.account_blocked_course, // "A course people are taking part in…"
		event_has_attendees: m.account_blocked_event, // "An upcoming event people have registered for…"
		contest_running: m.account_blocked_contest, // "A contest that is under way…"
		sole_owner: m.account_blocked_soleOwner // "You are its only owner…"
	};

	function blockerHref(b: ErasureBlocker): string {
		switch (b.kind) {
			case 'course':
				return resolve('/courses/[id]/manage', { id: b.id });
			case 'event':
				return resolve('/events/[id]', { id: b.id });
			case 'contest':
				return resolve('/contests/[id]/manage', { id: b.id });
			case 'organization':
				return resolve('/organizations/[slug]', { slug: b.slug ?? '' });
			case 'material_project':
				return resolve('/material-projects/[id]', { id: b.id });
		}
	}

	const canDelete = $derived(
		!!plan && !plan.refusal && plan.blockers.length === 0 && plan.status === 'none'
	);

	async function submitDelete(event: SubmitEvent) {
		event.preventDefault();
		deleteError = '';
		submitting = true;
		try {
			const res = await requestErasure(password, typedUsername);
			scheduledFor = res.dueAt;
			password = '';
			// The server has already revoked every token; forget the local session too.
			authStore.logout();
		} catch (e) {
			const reason =
				e instanceof ApiError ? (e.body as Record<string, unknown> | null)?.reason : undefined;
			if (reason === 'wrong_password') deleteError = m.account_error_wrongPassword();
			// "That password is not right."
			else if (reason === 'username_mismatch') deleteError = m.account_error_usernameMismatch();
			// "That is not your username."
			else if (reason === 'already_pending') deleteError = m.account_error_alreadyPending();
			// "A deletion is already waiting for this account."
			else if (reason === 'blocked') {
				await load();
				deleteError = m.account_blockedHeading(); // "First, hand these over or close them"
			} else deleteError = m.common_error();
		} finally {
			submitting = false;
		}
	}
</script>

<PageHead title={m.account_pageTitle()} description={m.account_settingsLinkHint()} />

<div class="page">
	<a class="back" href={resolve('/settings')}>← {m.account_back()}</a>
	<!-- "Back to settings" -->
	<h1>{m.account_pageTitle()}</h1>
	<!-- "Your data and your account" -->

	{#if scheduledFor}
		<section class="card scheduled" role="status">
			<h2>{m.account_scheduledHeading()}</h2>
			<!-- "Your account is switched off" -->
			<p>{m.account_scheduledBody({ date: formatDate(scheduledFor) })}</p>
			<!-- "It will be deleted for good on {date}. Until then…" -->
			<a href={resolve('/')}>{m.account_toHome()}</a>
			<!-- "Go to the home page" -->
		</section>
	{:else if !user}
		<p>
			<a href={resolve('/login')}>{m.settings_loginRequired()}</a>
		</p>
	{:else}
		<section class="card">
			<h2>{m.account_exportHeading()}</h2>
			<!-- "Download your data" -->
			<p>{m.account_exportBody()}</p>
			<!-- "One file with everything EdMat holds about you…" -->
			<div class="row">
				<button
					type="button"
					class="primary"
					onclick={download}
					disabled={exportState === 'busy'}
					data-testid="export-button"
				>
					{exportState === 'busy' ? m.account_exportBusy() : m.account_exportButton()}
					<!-- "Preparing…" / "Download my data" -->
				</button>
				<span class="hint">{m.account_exportLimit()}</span>
				<!-- "You can download it three times a day." -->
			</div>
			{#if exportState === 'done'}
				<p class="ok" role="status">{m.account_exportDone()}</p>
				<!-- "Downloaded. The file is in your browser's downloads." -->
			{:else if exportState === 'throttled'}
				<p class="error" role="alert">{m.account_exportThrottled()}</p>
				<!-- "You have downloaded it three times today…" -->
			{:else if exportState === 'error'}
				<p class="error" role="alert">{m.common_error()}</p>
			{/if}
		</section>

		<section class="card danger-zone" aria-labelledby="delete-heading">
			<h2 id="delete-heading">{m.account_deleteHeading()}</h2>
			<!-- "Delete your account" -->
			{#if loadError}
				<p class="error" role="alert">{m.common_error()}</p>
			{:else if !plan}
				<p class="hint">{m.common_loading()}</p>
			{:else}
				<p>{m.account_deleteIntro({ days: plan.graceDays })}</p>
				<!-- "Deleting switches the account off at once and erases it after {days} days…" -->

				{#if plan.refusal === 'guardian_managed'}
					<p class="notice">{m.account_refusal_guardianManaged()}</p>
					<!-- "Your account is looked after by your guardian…" -->
				{:else if plan.refusal === 'password_required'}
					<p class="notice">
						{m.account_refusal_passwordRequired()}
						<!-- "You sign in only through another service…" -->
						<a href={resolve('/settings')}>{m.account_toSettings()}</a>
						<!-- "Go to Settings" -->
					</p>
				{/if}

				{#if plan.blockers.length > 0}
					<div class="blockers" data-testid="blockers">
						<h3>{m.account_blockedHeading()}</h3>
						<!-- "First, hand these over or close them" -->
						<ul>
							{#each plan.blockers as b (b.kind + b.id)}
								<li>
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- blockerHref returns resolve() for every kind -->
									<a href={blockerHref(b)}>{b.title}</a> — {BLOCKER_REASON[b.reason]()}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if plan.children.length > 0}
					<div class="notice">
						<p>{m.account_children()}</p>
						<!-- "These child accounts have no other guardian…" -->
						<ul>
							{#each plan.children as c (c.id)}<li>{c.displayName}</li>{/each}
						</ul>
					</div>
				{/if}

				<div class="plan" data-testid="erasure-plan">
					{#each byAction as group (group.action)}
						<div class="plan-group plan-{group.action}">
							<h3>{ACTION_LABEL[group.action]()}</h3>
							<p class="why">{ACTION_WHY[group.action]()}</p>
							<ul>
								{#each group.items as item (item.group)}
									<li>
										<span>{GROUP_LABEL[item.group]?.() ?? item.group}</span>
										<span class="count">{item.count}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>

				{#if canDelete}
					<form class="confirm" onsubmit={submitDelete} data-testid="erasure-form">
						<h3>{m.account_confirmHeading()}</h3>
						<!-- "Confirm" -->
						<label class="field">
							<span>{m.account_typeUsername({ username: plan.username })}</span>
							<!-- "Type your username, {username}, to confirm" -->
							<input
								type="text"
								autocomplete="off"
								autocapitalize="off"
								spellcheck="false"
								bind:value={typedUsername}
								required
							/>
						</label>
						<label class="field">
							<span>{m.account_password()}</span>
							<!-- "Your current password" -->
							<input
								type="password"
								autocomplete="current-password"
								bind:value={password}
								required
							/>
						</label>
						{#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}
						<button
							type="submit"
							class="danger"
							disabled={submitting ||
								typedUsername.trim().toLowerCase() !== plan.username.toLowerCase() ||
								!password}
						>
							{m.account_deleteButton()}
							<!-- "Delete my account" -->
						</button>
					</form>
				{/if}
			{/if}
		</section>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 760px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.back {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
	h1 {
		font-size: var(--font-size-xl);
		margin: 0;
	}
	h2 {
		font-size: var(--font-size-lg);
		margin: 0 0 var(--space-2);
	}
	h3 {
		font-size: var(--font-size-base);
		margin: 0;
	}
	.card {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		p {
			margin: 0;
			line-height: 1.5;
		}
	}
	.danger-zone {
		border-color: var(--status-danger);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}
	.primary {
		@include mix.button-primary;
	}
	.hint {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.ok {
		color: var(--status-success);
	}
	.error {
		color: var(--status-danger);
	}
	.notice {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--status-warning-bg);
		color: var(--text-primary);
		ul {
			margin: var(--space-2) 0 0;
		}
	}
	.blockers {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--status-danger-bg);
		ul {
			margin: var(--space-2) 0 0;
			padding-left: var(--space-4);
		}
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.notice a {
		color: var(--accent);
	}
	.plan {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
		gap: var(--space-3);
	}
	.plan-group {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		.why {
			color: var(--text-secondary);
			font-size: var(--font-size-sm);
		}
		ul {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
		}
		li {
			display: flex;
			justify-content: space-between;
			gap: var(--space-3);
			font-size: var(--font-size-sm);
		}
		.count {
			@include mix.neutral-pill;
			font-variant-numeric: tabular-nums;
		}
	}
	.plan-delete {
		border-left: 3px solid var(--status-danger);
	}
	.plan-anonymise {
		border-left: 3px solid var(--status-info);
	}
	.plan-keep {
		border-left: 3px solid var(--status-neutral);
	}
	.plan-end {
		border-left: 3px solid var(--status-warning);
	}
	.confirm {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	input {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: inherit;
		max-width: 360px;
	}
	button.danger {
		@include mix.focus-ring;
		align-self: flex-start;
		padding: var(--space-2) var(--space-4);
		border: none;
		border-radius: var(--radius-sm);
		background: var(--status-danger);
		color: var(--bg-page);
		font-weight: 600;
		font-size: var(--font-size-sm);
		&:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
	}
	.scheduled {
		border-color: var(--status-warning);
		a {
			color: var(--accent);
		}
	}
</style>
