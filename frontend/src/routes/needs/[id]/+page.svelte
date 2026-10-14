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
	import PageDiscussion from '$lib/components/discussion/PageDiscussion.svelte';
	import { discussionKeyFor } from '$lib/utils/discussionKeys';
	import type { ApplyBlockReason, NeedDraft } from '$lib/types/need';
	// Content management on the posting itself (2026-10-10, the owner's ask). Until this, a need
	// could be edited only from the `⋯` on its row in `NeedsPanel` — and only its words, never its
	// kind, hours, deadline or wanted count. This is the page a shared link lands on, so it is the
	// page that has to carry the whole menu.
	import ManagementTextMenu from '$lib/components/translations/ManagementTextMenu.svelte';
	import LanguageNote from '$lib/components/translations/LanguageNote.svelte';
	import NeedForm from '$lib/components/needs/NeedForm.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import AttachmentsPanel from '$lib/components/attachments/AttachmentsPanel.svelte';
	import { updateNeed } from '$lib/services/needs';
	import type { WrittenText } from '$lib/services/textVersions';

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

	let editing = $state(false);
	let editError = $state('');

	/** Who may attach something here. The node's staff — and the person who FILED the need, because
	 *  `attachments/access.can_attach` says so ("somebody who filed a need may attach the photo that
	 *  explains it"). Drawing only the staff would hide the form from exactly the person that rule
	 *  was written for; the server decides for real either way. */
	const canAttachHere = $derived(
		Boolean(
			need &&
			(need.node?.isStaff ||
				need.node?.canManage ||
				(need.createdBy && authStore.user?.id === need.createdBy.id))
		)
	);

	/** The `⋯`'s "Edit in both languages…" answers with the new reading for THIS reader, so the row
	 *  is patched in place rather than refetched (`ManagementTextMenu`'s own reason for returning
	 *  it). */
	function applyText(written: WrittenText) {
		if (!need) return;
		need = {
			...need,
			title: written.heading,
			description: written.body,
			language: written.language,
			textVersions: written.textVersions
		};
	}

	async function saveEdit(draft: NeedDraft) {
		if (!need) return;
		managerBusy = true;
		editError = '';
		try {
			need = await updateNeed(need.id, draft);
			editing = false;
		} catch (err) {
			editError =
				err instanceof ApiError
					? (((err.body as Record<string, unknown> | undefined)?.detail as string | undefined) ??
						m.common_error())
					: m.common_error();
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
				{#if need.node?.canManage}
					<!-- The same menu the row in `NeedsPanel` carries, with the same two items plus the
					     fields: one shape for the posting wherever you meet it. `canManage` is the
					     server's own answer on the node (`config/nodes.py: node_ref`), never guessed
					     here. -->
					<ManagementTextMenu
						kind="need"
						id={need.id}
						versions={need.textVersions}
						fallbackHeading={need.title}
						fallbackBody={need.description}
						headingLabel={m.needs_formTitleLabel()}
						bodyLabel={m.needs_formDescriptionLabel()}
						label={m.needs_rowActionsLabel()}
						items={[
							{
								label: m.needs_editNeed(),
								// "Edit the posting"
								onselect: () => {
									editError = '';
									editing = true;
								}
							},
							{
								label: need.status === 'cancelled' ? m.needs_reopenNeed() : m.needs_cancelNeed(),
								danger: need.status !== 'cancelled',
								onselect: () => void toggleCancelled()
							}
						]}
						onSaved={applyText}
					/>
				{/if}
			</header>
			<LanguageNote language={need.language} />
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
				<!-- `MathContent`, not a bare `<p>`: a need's description is sanitized Markdown with
				     this site's LaTeX delimiters, exactly like a task's and a goal's, and it was the
				     one management body on the platform still drawn as plain text — a list or a
				     formula somebody typed came out as its own source. -->
				<div class="description"><MathContent source={need.description} /></div>
			{/if}

			{#if need.node?.canManage}
				<section class="manager">
					<!-- Cancel/reopen moved into the `⋯` beside the heading (2026-10-10), where the
					     posting's other actions are. Two places to cancel the same need is how two
					     surfaces start disagreeing about which one is the real one. -->
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

			<!-- Whatever the posting needs beside its words: the spec as a `.md`, a photo of the room,
			     a link to the sign-up sheet (`attachments/`, registered for `need` since
			     2026-10-09 and mounted here 2026-10-10). A board row has no standing of its own —
			     the tiers resolve to the node this need hangs off (`attachments/targets.py`:
			     `node_behind`), which is the same thing its thread does. -->
			<AttachmentsPanel
				targetKind="need"
				targetId={need.id}
				canAttach={canAttachHere}
				canManage={need.node?.canManage}
			/>

			<!-- The need's own thread (`needs/<id>` to `community/discussions.py`). Applying is the
			     form above; this is for the questions somebody has before they do. -->
			<PageDiscussion page={discussionKeyFor('needs', need.id)} title={need.title} />

			{#if editing}
				<ModalShell title={m.needs_editModalTitle()} onClose={() => (editing = false)} size="wide">
					<!-- "Edit this posting" — `wide` because eight fields in a 560px column is a scroll. -->
					<NeedForm
						initialTitle={need.title}
						initialDescription={need.description}
						initialKind={need.kind}
						initialSkillLevel={need.skillLevel}
						initialEstimatedHours={need.estimatedHours}
						initialDeadline={need.deadline}
						initialIsRemote={need.isRemote}
						initialWantedCount={need.wantedCount}
						busy={managerBusy}
						error={editError}
						submitLabel={m.common_save()}
						onsubmit={saveEdit}
						oncancel={() => (editing = false)}
					/>
				</ModalShell>
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
		border: 1px solid var(--border-color);
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
		border: 1px solid var(--border-color);
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
		border-top: 1px solid var(--border-color);
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
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	button {
		min-height: 40px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-contrast);
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
		border: 1px solid var(--border-color);
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
