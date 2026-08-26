<script lang="ts">
	// One issue report and the discussion under it. Same route shape as every other detail page
	// (an `$effect` keyed off `page.params.id` with the id-changed guard). Staff get a small panel
	// to move the status, leave a note the reporter is sent, or pull it off the public list.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Comment, User } from '$lib/types';
	import type { Issue, IssueStatus } from '$lib/types/issue';
	import { m } from '$lib/paraglide/messages.js';
	import { getIssueById, updateIssue } from '$lib/services/issues';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { ISSUE_KIND_LABELS, ISSUE_STATUSES, ISSUE_STATUS_LABELS } from '$lib/utils/issueLabels';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';

	let issue = $state<Issue | undefined>(undefined);
	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});
	let loading = $state(true);
	let notFound = $state(false);
	let loadedForId: string | undefined;

	let staffStatus = $state<IssueStatus>('open');
	let staffNote = $state('');
	let saving = $state(false);

	async function resolveUsers(ids: string[]) {
		const unique = [...new Set(ids)].filter((id) => !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const user of found) if (user) next[user.id] = user;
		usersById = next;
	}

	async function load(id: string) {
		if (id === loadedForId) return;
		loadedForId = id;
		loading = true;
		notFound = false;
		const found = await getIssueById(id);
		if (!found) {
			notFound = true;
			loading = false;
			return;
		}
		issue = found;
		staffStatus = found.status;
		staffNote = found.staffNote;
		comments = await getCommentsForTarget('issue', id);
		await resolveUsers(comments.map((c) => c.authorId));
		loading = false;
	}

	$effect(() => {
		// A private issue resolves only for staff, and the session may not have resolved at mount.
		if (authStore.isAuthenticated) loadedForId = undefined;
		if (!featureFlagsStore.isLoaded) return;
		if (!(featureFlagsStore.isEnabled('issues') || authStore.isModerator)) return;
		load(page.params.id!);
	});

	async function onSubmitComment(body: string, parentId?: string) {
		if (!issue || !authStore.user) return;
		const comment = await submitComment('issue', issue.id, authStore.user.id, body, parentId);
		comments = [...comments, comment];
		await resolveUsers([comment.authorId]);
		issue = { ...issue, commentCount: issue.commentCount + 1 };
	}

	async function saveStaff() {
		if (!issue || saving) return;
		saving = true;
		try {
			issue = await updateIssue(issue.id, { status: staffStatus, staffNote });
		} finally {
			saving = false;
		}
	}

	async function unpublish() {
		if (!issue || saving) return;
		saving = true;
		try {
			issue = await updateIssue(issue.id, { isPublic: false });
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>{issue ? issue.title : m.issues_heading()} · {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="issues">
	<div class="page">
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/issues')}>{m.issue_backToList()}</a>
			<!-- "All issues" -->
		</nav>

		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if notFound || !issue}
			<p class="muted">{m.issue_notFound()}</p>
			<!-- "This report does not exist, or is not public." -->
		{:else}
			<header class="head">
				<div class="pills">
					<span class="pill pill--{issue.status}">{ISSUE_STATUS_LABELS[issue.status]()}</span>
					<span class="pill">{ISSUE_KIND_LABELS[issue.kind]()}</span>
					{#if !issue.isPublic}
						<span class="pill pill--private">{m.issues_private()}</span>
					{/if}
				</div>
				<h1>{issue.title}</h1>
				<p class="muted">
					{#if issue.reporterId}
						{m.issue_reportedBy({ name: '' })}<a
							href={resolve('/users/[id]', { id: issue.reporterId })}>{issue.reporterDisplayName}</a
						>
						<!-- "Reported by " -->
					{:else}
						{m.issue_reportedAnonymously()}
						<!-- "Reported anonymously" -->
					{/if}
					· {new Date(issue.createdAt).toLocaleDateString()}
				</p>
			</header>

			{#if issue.body}
				<p class="body">{issue.body}</p>
			{/if}

			{#if issue.context.path || issue.context.pageTitle}
				<dl class="context">
					<dt>{m.issue_contextWhere()}</dt>
					<!-- "Where" -->
					<dd>
						{#if issue.context.path}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a path the reporter typed, not an app route -->
							<a href={issue.context.path}>{issue.context.path}</a>
						{/if}
						{#if issue.context.pageTitle}
							<span class="muted"> — {issue.context.pageTitle}</span>
						{/if}
					</dd>
					{#if authStore.isModerator && (issue.context.viewport || issue.context.userAgent)}
						<dt>{m.issue_contextEnvironment()}</dt>
						<!-- "Environment" -->
						<dd class="muted">
							{issue.context.locale} · {issue.context.viewport} · {issue.context.userAgent}
						</dd>
					{/if}
					{#if authStore.isModerator && issue.contactEmail}
						<dt>{m.issue_contactEmail()}</dt>
						<!-- "Contact" -->
						<dd>{issue.contactEmail}</dd>
					{/if}
				</dl>
			{/if}

			{#if issue.staffNote}
				<div class="note">
					<strong>{m.issue_staffNoteHeading()}</strong>
					<!-- "From the moderators" -->
					<p>{issue.staffNote}</p>
				</div>
			{/if}

			{#if authStore.isModerator}
				<section class="staff">
					<h2>{m.issue_staffPanel()}</h2>
					<!-- "Moderator actions" -->
					<label>
						<span>{m.issue_staffStatus()}</span>
						<!-- "Status" -->
						<select bind:value={staffStatus}>
							{#each ISSUE_STATUSES as status (status)}
								<option value={status}>{ISSUE_STATUS_LABELS[status]()}</option>
							{/each}
						</select>
					</label>
					<label>
						<span>{m.issue_staffNote()}</span>
						<!-- "Note to the reporter (sent with the status change)" -->
						<textarea bind:value={staffNote} rows="3"></textarea>
					</label>
					<div class="actions">
						<button type="button" class="button-primary" disabled={saving} onclick={saveStaff}
							>{m.common_save()}</button
						>
						{#if issue.isPublic}
							<button type="button" class="button-secondary" disabled={saving} onclick={unpublish}>
								{m.issue_unpublish()}
								<!-- "Remove from the public list" -->
							</button>
						{/if}
					</div>
				</section>
			{/if}

			<section class="discussion">
				<h2>{m.issue_discussionHeading()}</h2>
				<!-- "Discussion" -->
				<DiscussionThread {comments} {usersById} onSubmit={onSubmitComment} />
			</section>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.breadcrumb a,
	.head a {
		color: var(--accent);
	}
	.muted {
		color: var(--text-secondary);
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.pill {
		@include mix.status-pill(var(--text-secondary), var(--bg-secondary));
	}
	.pill--open {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
	.pill--in_progress {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.pill--resolved {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.pill--private {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.body {
		white-space: pre-wrap;
	}
	.context {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-3);
		font-size: var(--font-size-sm);
		margin: 0;
		dt {
			font-weight: 600;
		}
		dd {
			margin: 0;
			overflow-wrap: anywhere;
		}
	}
	.note {
		@include mix.card-surface;
		padding: var(--space-2) var(--space-3);
		p {
			margin: var(--space-1) 0 0;
			white-space: pre-wrap;
		}
	}
	.staff {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		h2 {
			font-size: var(--font-size-base);
			margin: 0;
		}
		label {
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
			font-size: var(--font-size-sm);
		}
		select,
		textarea {
			font: inherit;
			color: var(--text-primary);
			background: var(--bg-primary);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-md);
			padding: var(--space-1) var(--space-2);
		}
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.button-primary {
		@include mix.button-primary;
	}
	.button-secondary {
		@include mix.button-secondary;
	}
	.discussion h2 {
		font-size: var(--font-size-base);
	}
</style>
