<script lang="ts">
	// One "help wanted" posting (MANAGEMENT-BRIEF.md §3.C): the node it belongs to, apply/withdraw
	// for anybody who may, and — for the node's own manager — cancel/reopen and the applications
	// queue with accept/decline. `need.node` already carries this reader's standing on the
	// underlying course/event/material (`config/nodes.py: node_ref`), so no second fetch is needed
	// to know whether to draw the manager half.
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Need, NeedApplication } from '$lib/types/need';
	import {
		applyToNeed,
		cancelNeed,
		decideNeedApplication,
		getNeed,
		getNeedApplications,
		reopenNeed,
		withdrawFromNeed
	} from '$lib/services/needs';
	import { authStore } from '$lib/state/auth.svelte';
	import { ApiError } from '$lib/api/client';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import {
		APPLY_BLOCK_REASON_LABELS,
		NEED_APPLICATION_STATUS_LABELS,
		NEED_KIND_LABELS,
		NEED_STATUS_LABELS,
		SKILL_LEVEL_LABELS
	} from '$lib/utils/labels';
	import { formatDateTime } from '$lib/utils/datetime';
	import { pageTitle } from '$lib/utils/pageTitle';
	import type { ApplyBlockReason } from '$lib/types/need';

	const id = $derived(page.params.id!);

	let need = $state<Need | null>(null);
	let loading = $state(true);
	let notFound = $state(false);

	let applications = $state<NeedApplication[]>([]);
	let loadingApplications = $state(false);

	let applyMessage = $state('');
	let applyBusy = $state(false);
	let applyError = $state('');
	let myApplication = $state<NeedApplication | null>(null);

	let managerBusy = $state(false);
	let managerError = $state('');

	async function loadNeed() {
		loading = true;
		notFound = false;
		try {
			need = await getNeed(id);
		} catch (err) {
			notFound = !(err instanceof ApiError) || err.status === 404;
			need = null;
		} finally {
			loading = false;
		}
	}

	async function loadApplications() {
		if (!need?.node?.canManage) return;
		loadingApplications = true;
		try {
			applications = await getNeedApplications(need.id);
		} catch {
			applications = [];
		} finally {
			loadingApplications = false;
		}
	}

	let loadedForId = $state('');
	$effect(() => {
		if (id === loadedForId) return;
		loadedForId = id;
		myApplication = null;
		void loadNeed().then(loadApplications);
	});

	async function submitApply(e: SubmitEvent) {
		e.preventDefault();
		if (!need) return;
		applyBusy = true;
		applyError = '';
		try {
			myApplication = await applyToNeed(need.id, applyMessage.trim());
			applyMessage = '';
		} catch (err) {
			const detail =
				err instanceof ApiError
					? ((err.body as Record<string, unknown> | undefined)?.detail as
							ApplyBlockReason | undefined)
					: undefined;
			applyError = detail ? APPLY_BLOCK_REASON_LABELS[detail]() : m.common_error();
		} finally {
			applyBusy = false;
		}
	}

	async function withdraw() {
		if (!myApplication) return;
		try {
			myApplication = await withdrawFromNeed((need as Need).id);
		} catch {
			applyError = m.common_error();
		}
	}

	async function decide(application: NeedApplication, decision: 'accept' | 'decline') {
		managerBusy = true;
		managerError = '';
		try {
			const updated = await decideNeedApplication(application.id, decision);
			applications = applications.map((a) => (a.id === updated.id ? updated : a));
			need = await getNeed(id);
		} catch {
			managerError = m.common_error();
		} finally {
			managerBusy = false;
		}
	}

	async function toggleCancelled() {
		if (!need) return;
		managerBusy = true;
		managerError = '';
		try {
			need = need.status === 'cancelled' ? await reopenNeed(need.id) : await cancelNeed(need.id);
		} catch {
			managerError = m.common_error();
		} finally {
			managerBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(need?.title ?? m.needs_browseHeading())}</title>
</svelte:head>

<FeatureGate feature="needs">
	<div class="page">
		<a class="back" href={resolve('/needs')}>{m.needs_backToBoard()}</a>

		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if notFound || !need}
			<p class="status">{m.common_error_generic()}</p>
		{:else}
			<header class="head">
				<h1>{need.title}</h1>
				<span class="pill pill--{need.status}">{NEED_STATUS_LABELS[need.status]()}</span>
			</header>
			{#if need.node}
				<p class="node">
					{m.needs_onNode({ title: need.node.title })}
				</p>
			{/if}
			<div class="meta">
				<span>{NEED_KIND_LABELS[need.kind]()}</span>
				<span>{SKILL_LEVEL_LABELS[need.skillLevel]()}</span>
				<span
					>{m.needs_acceptedOfWanted({
						accepted: need.acceptedCount,
						wanted: need.wantedCount
					})}</span
				>
				{#if need.isRemote}<span class="badge">{m.needs_remoteBadge()}</span>{/if}
				{#if need.estimatedHours}<span
						>{m.needs_estimatedHours({ hours: need.estimatedHours })}</span
					>{/if}
				{#if need.deadline}<span
						>{m.needs_deadlineLabel({ date: formatDateTime(need.deadline) })}</span
					>{/if}
			</div>
			{#if need.description}
				<p class="description">{need.description}</p>
			{/if}

			{#if need.node?.canManage}
				<section class="manager">
					<div class="actions">
						<button type="button" onclick={toggleCancelled} disabled={managerBusy}>
							{need.status === 'cancelled' ? m.needs_reopenNeed() : m.needs_cancelNeed()}
						</button>
					</div>
					{#if managerError}<p class="error" role="alert">{managerError}</p>{/if}

					<h2>{m.needs_applicationsHeading()}</h2>
					{#if loadingApplications}
						<p class="status">{m.common_loading()}</p>
					{:else if applications.length === 0}
						<p class="status">{m.needs_applicationsEmpty()}</p>
					{:else}
						<ul class="list">
							{#each applications as application (application.id)}
								<li class="card">
									<div class="card__head">
										<strong>{application.user.displayName}</strong>
										<span class="pill pill--{application.status}">
											{NEED_APPLICATION_STATUS_LABELS[application.status]()}
										</span>
									</div>
									{#if application.message}<p class="message">{application.message}</p>{/if}
									{#if application.status === 'pending'}
										<div class="actions">
											<button
												type="button"
												class="primary"
												disabled={managerBusy}
												onclick={() => decide(application, 'accept')}
											>
												{m.needs_acceptButton()}
											</button>
											<button
												type="button"
												class="danger"
												disabled={managerBusy}
												onclick={() => decide(application, 'decline')}
											>
												{m.needs_declineButton()}
											</button>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{:else if authStore.isAuthenticated}
				<section class="apply">
					{#if myApplication}
						<p class="status">
							{m.needs_yourApplicationStatus({
								status: NEED_APPLICATION_STATUS_LABELS[myApplication.status]()
							})}
						</p>
						{#if myApplication.status === 'pending' || myApplication.status === 'accepted'}
							<button type="button" onclick={withdraw}>{m.needs_withdrawButton()}</button>
						{/if}
					{:else}
						<h2>{m.needs_applyHeading()}</h2>
						<form onsubmit={submitApply}>
							<label class="field">
								<span>{m.needs_applyMessageLabel()}</span>
								<textarea rows="3" bind:value={applyMessage} maxlength="2000"></textarea>
							</label>
							{#if applyError}<p class="error" role="alert">{applyError}</p>{/if}
							<button type="submit" class="primary" disabled={applyBusy}>
								{m.needs_applyButton()}
							</button>
						</form>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 760px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.back {
		color: var(--text-secondary);
		font-size: 0.85rem;
		text-decoration: none;
	}
	.status {
		color: var(--text-secondary);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.head h1 {
		margin: 0;
	}
	.node {
		color: var(--text-secondary);
		margin: 0;
	}
	.meta {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.badge {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 0.4rem;
	}
	.description {
		white-space: pre-wrap;
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border);
	}
	.pill--open,
	.pill--accepted {
		background: var(--status-success-bg);
		color: var(--status-success);
		border-color: transparent;
	}
	.pill--in_progress,
	.pill--pending {
		background: var(--status-warning-bg);
		color: var(--status-warning);
		border-color: transparent;
	}
	.pill--fulfilled,
	.pill--cancelled,
	.pill--declined,
	.pill--withdrawn {
		opacity: 0.7;
	}
	.manager,
	.apply {
		border-top: 1px solid var(--border);
		padding-top: var(--space-3);
		display: grid;
		gap: 0.6rem;
	}
	.field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.9rem;
	}
	textarea {
		font: inherit;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	button {
		min-height: 40px;
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
	.actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
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
	.card__head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.message {
		margin: 0.3rem 0;
		font-size: 0.9rem;
	}
</style>
