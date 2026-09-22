<script lang="ts">
	// One version, with the conversation about it.
	//
	// Addressed by NUMBER rather than by id, because a version's number is what everybody says out
	// loud ("version 3 broke the second exercise") and it is stable per project. The id is what the
	// API takes, so the page resolves one to the other through the project's own list — which is
	// also the call that decides whether this reader may see it at all.
	//
	// The thread is a real `Comment` thread on a `materialVersion` target, so reporting, tombstones,
	// votes and the tree builder all come for free (the polymorphic-target shape, root CLAUDE.md).
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDateTime } from '$lib/utils/datetime';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		getProject,
		getVersion,
		listVersionComments,
		listVersions,
		postVersionComment,
		publishVersion
	} from '$lib/services/materialProjects';
	import { getUserById } from '$lib/services/users';
	import type { Comment, User } from '$lib/types';
	import type { MaterialProject, MaterialVersion } from '$lib/types/materialProject';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import VersionChanges from '$lib/components/coauthoring/VersionChanges.svelte';
	import VersionDecision from '$lib/components/coauthoring/VersionDecision.svelte';
	import VersionList from '$lib/components/coauthoring/VersionList.svelte';
	import VersionView from '$lib/components/coauthoring/VersionView.svelte';
	import {
		COAUTHORING_FLAG,
		messageForError,
		VERSION_STATUS_LABELS
	} from '$lib/components/coauthoring/labels';

	let project = $state<MaterialProject | null>(null);
	let versions = $state<MaterialVersion[]>([]);
	let version = $state<MaterialVersion | null>(null);
	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});
	let loading = $state(true);
	let notFound = $state(false);
	// A decision made on THIS page keeps the decision section mounted, so its confirmation is seen:
	// deciding clears `canDecide`, which would otherwise unmount the section in the same tick that
	// sets its notice.
	let decidedHere = $state(false);
	let publishing = $state(false);
	let publishNotice = $state('');
	let publishError = $state('');

	async function resolveUsers(ids: string[]) {
		const unique = [...new Set(ids)].filter((id) => !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const u of found) if (u) next[u.id] = u;
		usersById = next;
	}

	async function load(projectId: string, number: number) {
		loading = true;
		notFound = false;
		version = null;
		decidedHere = false;
		publishNotice = '';
		publishError = '';
		const found = await getProject(projectId);
		if (!found) {
			notFound = true;
			loading = false;
			return;
		}
		project = found;
		versions = await listVersions(projectId).catch(() => []);
		const match = versions.find((row) => row.number === number);
		if (!match) {
			notFound = true;
			loading = false;
			return;
		}
		// The list row is the summary-shaped one; the full record is what carries the body and the
		// three `can_*` answers this page's buttons hang off.
		version = (await getVersion(match.id)) ?? match;
		comments = await listVersionComments(match.id).catch(() => []);
		await resolveUsers(comments.map((c) => c.authorId));
		loading = false;
	}

	// The id-changed guard, keyed on both parameters and the session (trap 2 and trap 3 together).
	let loadedFor = $state('');
	$effect(() => {
		const projectId = page.params.id!;
		const number = Number(page.params.number);
		const key = `${projectId}:${number}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		if (!Number.isFinite(number)) {
			notFound = true;
			loading = false;
			return;
		}
		load(projectId, number);
	});

	let basedOn = $derived(
		version?.basedOnId ? (versions.find((row) => row.id === version?.basedOnId) ?? null) : null
	);

	// Publishing a draft that is already saved — a co-author's, or your own from an earlier sitting.
	// The editor publishes only at save time, so without this a saved draft had no button anywhere.
	async function publish() {
		const current = version;
		if (!current) return;
		publishing = true;
		publishNotice = '';
		publishError = '';
		try {
			const updated = await publishVersion(current.id);
			version = updated;
			versions = versions.map((row) => (row.id === updated.id ? updated : row));
			publishNotice =
				updated.status === 'published'
					? m.coauth_editor_published({ number: updated.number }) // "Published as version {number}."
					: m.coauth_editor_queued(); // "Sent to the moderators — a first publication is read by a person before it goes live."
		} catch (e) {
			publishError = messageForError(e);
		} finally {
			publishing = false;
		}
	}

	async function submitComment(body: string, parentId?: string): Promise<Comment | void> {
		const current = version;
		if (!current || !authStore.isAuthenticated) return;
		const comment = await postVersionComment(current.id, body, parentId);
		comments = [...comments, comment];
		await resolveUsers([comment.authorId]);
		return comment;
	}
</script>

<!-- "Version {number}", falling back to "Co-authoring"; the description is "One version of a
     material: what it contains, what changed, and the conversation about it." -->
<PageHead
	title={version ? m.coauth_versions_number({ number: version.number }) : m.coauth_heading()}
	description={m.coauth_seo_version()}
/>

<FeatureGate feature={COAUTHORING_FLAG}>
	<div class="page">
		{#if loading}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if notFound || !version || !project}
			<p class="hint">{m.coauth_versionPage_notFound()}</p>
			<!-- "There is no such version." -->
		{:else}
			<!-- Labelled "Breadcrumb", starting at "Home". -->
			<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
				<a href={resolve('/disciplines')}>{m.common_home()}</a> ›
				<a href={resolve('/material-projects/[id]', { id: project.id })}>
					{project.title || m.coauth_versionPage_backToProject()}
					<!-- The fallback is "Back to the project". -->
				</a>
			</nav>

			<header class="head">
				<h1>{m.coauth_versions_number({ number: version.number })}</h1>
				<!-- "Version {number}" -->
				<p class="meta">
					<span class="badge">{VERSION_STATUS_LABELS[version.status]()}</span>
					<span>{formatDateTime(version.createdAt)}</span>
					{#if version.createdByDisplayName}
						<span>{m.coauth_versions_by({ name: version.createdByDisplayName })}</span>
						<!-- "by {name}" -->
					{/if}
				</p>
				<h2 class="version-title">{version.title}</h2>
			</header>

			{#if version.changeNote}
				<section class="content-section">
					<h2>{m.coauth_version_changeNote()}</h2>
					<!-- "What changed" -->
					<p>{version.changeNote}</p>
				</section>
			{/if}

			{#if basedOn}
				<p class="hint">
					{m.coauth_version_basedOn({ number: basedOn.number })}
					<!-- "Written against version {number}" -->
				</p>
			{/if}

			<section class="content-section">
				<VersionView {version} />
			</section>

			<!-- What this version changed, against the version it was written against — only when that
			     basis is one this reader may see. `versions` is the server's own per-row
			     `can_view_version` answer, so a basis missing from it is one they may not read, and
			     asking for it by id would only earn the same 404. -->
			{#if basedOn}
				<VersionChanges before={basedOn} after={version} />
			{/if}

			{#if version.decidedAt}
				<section class="content-section">
					<h2>{m.coauth_version_decidedBy({ name: version.decidedByDisplayName })}</h2>
					<!-- "Decided by {name}" -->
					{#if version.decisionNote}
						<p class="note-label">{m.coauth_version_decisionNote()}</p>
						<!-- "The reason given" -->
						<p>{version.decisionNote}</p>
					{/if}
				</section>
			{/if}

			{#if version.canPublish || publishNotice || publishError}
				<section class="content-section publish">
					{#if version.canPublish}
						<button type="button" class="primary" disabled={publishing} onclick={publish}>
							{m.coauth_editor_publish()}
							<!-- "Publish" -->
						</button>
					{/if}
					{#if publishNotice}<p class="notice">{publishNotice}</p>{/if}
					{#if publishError}<p class="error">{publishError}</p>{/if}
				</section>
			{/if}

			{#if version.canDecide || version.canWithdraw || decidedHere}
				<VersionDecision
					{version}
					ondecided={(updated) => {
						decidedHere = true;
						version = updated;
						versions = versions.map((row) => (row.id === updated.id ? updated : row));
					}}
				/>
			{/if}

			<section class="content-section">
				<h2>{m.discussion_heading()}</h2>
				<!-- "Discussion" -->
				<DiscussionThread
					{comments}
					{usersById}
					onSubmit={submitComment}
					canPost={authStore.isAuthenticated}
				/>
			</section>

			<VersionList projectId={project.id} {versions} currentNumber={version.number} />
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);

		a {
			color: var(--accent);
		}
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		h1 {
			margin: 0;
		}
	}
	.version-title {
		margin: 0;
		font-size: var(--font-size-lg);
	}
	.meta {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.badge {
		border-radius: 999px;
		padding: 1px var(--space-2);
		background: var(--bg-surface-alt);
	}
	.content-section {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
		p {
			margin: 0;
			font-size: var(--font-size-sm);
		}
	}
	.note-label {
		font-weight: 600;
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
