<script lang="ts">
	// One project: what it currently says, how it got there, who may change it, and what is waiting
	// for somebody to decide.
	//
	// The page shows different things to four kinds of reader — a co-author, somebody who can
	// decide but is not one, a stranger looking at a draft that wants help, and a stranger looking
	// at a published material — and every one of those differences comes from the server's own
	// `can_*` answers rather than from anything guessed here. A frontend that re-derived them would
	// be drawing buttons that 403 (house rule 4: the filter and the object check are two different
	// things, and only the server does both).
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		getProject,
		getVersion,
		listJoinRequests,
		listVersions,
		updateProject
	} from '$lib/services/materialProjects';
	import type {
		MaterialProject,
		MaterialVersion,
		ProjectCatalogueResult,
		ProjectJoinRequest
	} from '$lib/types/materialProject';
	import { materialTypesStore } from '$lib/state/materialTypes.svelte';
	import AudienceBadge from '$lib/components/shared/AudienceBadge.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import CatalogueForm from '$lib/components/coauthoring/CatalogueForm.svelte';
	import InvitesPanel from '$lib/components/coauthoring/InvitesPanel.svelte';
	import JoinRequestsPanel from '$lib/components/coauthoring/JoinRequestsPanel.svelte';
	import MembersPanel from '$lib/components/coauthoring/MembersPanel.svelte';
	import VersionEditor from '$lib/components/coauthoring/VersionEditor.svelte';
	import VersionList from '$lib/components/coauthoring/VersionList.svelte';
	import VersionView from '$lib/components/coauthoring/VersionView.svelte';
	import { COAUTHORING_FLAG, messageForError } from '$lib/components/coauthoring/labels';

	let project = $state<MaterialProject | null>(null);
	let versions = $state<MaterialVersion[]>([]);
	let head = $state<MaterialVersion | null>(null);
	let joinRequests = $state<ProjectJoinRequest[]>([]);
	let loading = $state(true);
	let notFound = $state(false);

	let editing = $state(false);
	let editingCatalogue = $state(false);
	let catalogueError = $state('');
	let catalogueNotice = $state('');
	let catalogueBusy = $state(false);

	async function load(id: string) {
		loading = true;
		notFound = false;
		const found = await getProject(id);
		if (!found) {
			notFound = true;
			loading = false;
			return;
		}
		project = found;
		// Each of these answers "nothing" rather than failing the page: a stranger reading a teaser
		// is allowed to see the project and not its history, and that is a real state, not an error.
		versions = await listVersions(id).catch(() => []);
		head = found.headVersion ? await getVersion(found.headVersion.id).catch(() => null) : null;
		// Asked for whenever somebody is signed in, not only for a manager: the endpoint is the only
		// place a requester's own pending row could come from, and a reader who may not see the queue
		// gets a 403 that this swallows. If the backend keeps it members-only, this costs one refused
		// request and the block reason (`pending_exists`) still tells the person where they stand.
		joinRequests = authStore.isAuthenticated ? await listJoinRequests(id).catch(() => []) : [];
		loading = false;
	}

	// The id-changed idempotency guard every dynamic route here needs: `$effect` re-fires with no
	// navigation at all (frontend/CLAUDE.md trap 2). Keyed on the session too, because every `can_*`
	// on this page changes the moment it resolves.
	let loadedFor = $state('');
	$effect(() => {
		const id = page.params.id!;
		const key = `${id}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		load(id);
	});

	function reload() {
		const id = page.params.id;
		if (id) load(id);
	}

	let pendingProposals = $derived(versions.filter((version) => version.status === 'proposed'));
	/** A draft nobody has published, seen by somebody who cannot edit it — the teaser. */
	let isTeaser = $derived(Boolean(project && !project.canEdit && project.materialId === null));
	let myJoinRequest = $derived(
		joinRequests.find((row) => row.userId === authStore.user?.id && row.status === 'pending') ??
			null
	);

	async function saveCatalogue(patch: ProjectCatalogueResult) {
		const current = project;
		if (!current) return;
		catalogueBusy = true;
		catalogueError = '';
		catalogueNotice = '';
		try {
			project = await updateProject(current.id, {
				type: patch.type,
				audience: patch.audience,
				author: patch.author,
				sourceUrl: patch.sourceUrl,
				priceAmount: patch.priceAmount,
				priceCurrency: patch.priceCurrency,
				estimatedMinutes: patch.estimatedMinutes,
				requirements: patch.requirements,
				coverage: patch.coverage,
				seekingCoauthors: patch.seekingCoauthors,
				seekingNote: patch.seekingNote,
				// Only meaningful while the project is still drafting; the API ignores it afterwards.
				...(current.materialId === null ? { locale: patch.locale } : {})
			});
			catalogueNotice = m.coauth_project_catalogueSaved(); // "Saved."
			editingCatalogue = false;
		} catch (e) {
			catalogueError = messageForError(e);
		} finally {
			catalogueBusy = false;
		}
	}
</script>

<!-- The project's own title, falling back to "Co-authoring"; the description falls back to "A
     material project: its current version, its history, its co-authors and what is waiting for a
     decision." -->
<PageHead
	title={project?.title || m.coauth_heading()}
	description={project?.description || m.coauth_seo_project()}
/>

<FeatureGate feature={COAUTHORING_FLAG}>
	<div class="page">
		{#if loading}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if notFound || !project}
			<p class="hint">{m.coauth_project_notFound()}</p>
			<!-- "There is no such project, or it is not one you can see." -->
		{:else}
			<!-- Labelled "Breadcrumb", starting at "Home". -->
			<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
				<a href={resolve('/disciplines')}>{m.common_home()}</a> ›
				<a href={resolve('/branches/[branch]', { branch: project.branchId })}>
					{project.branchName}
				</a>
			</nav>

			<header class="head">
				<h1>{project.title || m.coauth_project_noHead()}</h1>
				<!-- The fallback is "Nothing has been written yet." -->
				<p class="meta">
					{#if project.materialId}
						<a href={resolve('/materials/[id]', { id: project.materialId })}>
							{m.coauth_project_materialLink()}
							<!-- "The published material" -->
						</a>
					{:else}
						<span>{m.coauth_project_draftNotice()}</span>
						<!-- "This project has never published anything, so it has no material page yet." -->
					{/if}
				</p>
				{#if isTeaser}
					<p class="hint">{m.coauth_project_teaserNote()}</p>
					<!-- "This is what the project says publicly. Its drafts are visible to its co-authors." -->
				{/if}
			</header>

			<section class="content-section">
				<h2>{m.coauth_project_headHeading()}</h2>
				<!-- "The current version" -->
				{#if head}
					<VersionView version={head} />
				{:else}
					<p class="hint">{m.coauth_project_noHead()}</p>
					<!-- "Nothing has been written yet." -->
				{/if}
			</section>

			{#if pendingProposals.length > 0}
				<section class="content-section">
					<h2>{m.coauth_project_proposalsWaiting({ count: pendingProposals.length })}</h2>
					<!-- "Proposals waiting for a decision: {count}" -->
					<ul class="proposals">
						{#each pendingProposals as proposal (proposal.id)}
							<li>
								<a
									href={resolve('/material-projects/[id]/versions/[number]', {
										id: project.id,
										number: String(proposal.number)
									})}
								>
									{m.coauth_versions_number({ number: proposal.number })}
									<!-- "Version {number}" -->
								</a>
								<span class="who">
									{m.coauth_version_proposedBy({ name: proposal.createdByDisplayName })}
									<!-- "Proposed by {name}" -->
								</span>
								{#if proposal.changeNote}<span class="note">{proposal.changeNote}</span>{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if project.canEdit || project.canPropose}
				<div class="editor-slot">
					{#if !editing}
						<button type="button" class="secondary" onclick={() => (editing = true)}>
							{project.canEdit ? m.coauth_editor_heading_draft() : m.coauth_panel_improve()}
							<!-- "Save a new version" / "Improve this material" -->
						</button>
					{:else}
						<VersionEditor
							mode={project.canEdit ? 'draft' : 'propose'}
							projectId={project.id}
							basedOn={project.headVersion}
							initial={head}
							canPublish={project.canEdit}
							oncancel={() => (editing = false)}
							onsaved={() => {
								editing = false;
								reload();
							}}
						/>
					{/if}
				</div>
			{:else if project.proposeBlockReason === 'authentication_required'}
				<p class="hint">
					<a href={resolve('/login')}>{m.coauth_block_authentication_required()}</a>
					<!-- "Sign in to propose a change." -->
				</p>
			{/if}

			{#if versions.length > 0}
				<VersionList projectId={project.id} {versions} />
			{/if}

			{#if project.canEdit}
				<section class="content-section">
					<div class="section-head">
						<h2>{m.coauth_catalogue_heading()}</h2>
						<!-- "About the material" -->
						<button
							type="button"
							class="link"
							onclick={() => (editingCatalogue = !editingCatalogue)}
						>
							{editingCatalogue ? m.common_cancel() : m.coauth_project_editCatalogue()}
							<!-- "Cancel" / "Edit the details" -->
						</button>
					</div>
					{#if catalogueNotice}<p class="notice">{catalogueNotice}</p>{/if}
					{#if catalogueError}<p class="error">{catalogueError}</p>{/if}
					{#if editingCatalogue}
						<CatalogueForm
							mode="edit"
							{project}
							busy={catalogueBusy}
							onsubmit={(patch) => saveCatalogue(patch)}
						/>
					{:else}
						<!-- What the details ARE, not only a link to change them: an empty section with an
						     edit link read as unfinished. -->
						<dl class="catalogue">
							<dt>{m.submitMaterial_field_type()}</dt>
							<!-- "Type" -->
							<dd>
								{materialTypesStore.nameFor(project.type)}
								<AudienceBadge audience={project.audience} />
							</dd>
							{#if project.author}
								<dt>{m.submitMaterial_field_author()}</dt>
								<!-- "Author" -->
								<dd>{project.author}</dd>
							{/if}
							{#if project.sourceUrl}
								<dt>{m.submitMaterial_field_sourceUrl()}</dt>
								<!-- "Source link" -->
								<dd>
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a user-declared external URL, not an app route resolve() can express -->
									<a href={project.sourceUrl} target="_blank" rel="noopener noreferrer nofollow"
										>{project.sourceUrl}</a
									>
								</dd>
							{/if}
							{#if project.priceAmount}
								<dt>{m.submitMaterial_field_price()}</dt>
								<!-- "Price" -->
								<dd>{project.priceAmount} {project.priceCurrency}</dd>
							{/if}
							{#if project.estimatedMinutes}
								<dt>{m.submitMaterial_field_estimatedMinutes()}</dt>
								<!-- "Estimated time (minutes)" -->
								<dd>{project.estimatedMinutes}</dd>
							{/if}
						</dl>
					{/if}
				</section>
			{/if}

			<MembersPanel
				projectId={project.id}
				members={project.members}
				canManage={project.canManage}
				onchanged={reload}
			/>

			{#if project.canManage}
				<InvitesPanel projectId={project.id} />
			{/if}

			<!-- Managers always see the queue. Everybody else sees this section only when there is
			     something to do or something worth explaining — a co-author reading "you are already a
			     co-author here" under a heading about joining is noise, not information. -->
			{#if project.canManage || project.joinBlockReason === null || project.seekingCoauthors}
				<JoinRequestsPanel
					projectId={project.id}
					requests={joinRequests}
					canManage={project.canManage}
					blockReason={project.joinBlockReason}
					mine={myJoinRequest}
					onchanged={reload}
				/>
			{/if}
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
	.meta {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);

		a {
			color: var(--accent);
		}
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
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.proposals {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		li {
			display: flex;
			align-items: baseline;
			gap: var(--space-2);
			flex-wrap: wrap;
		}
		a {
			color: var(--accent);
			font-size: var(--font-size-sm);
		}
	}
	.who,
	.note,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.hint a {
		color: var(--accent);
	}
	.editor-slot {
		display: flex;
		flex-direction: column;
	}
	.secondary {
		@include mix.button-secondary;
		align-self: flex-start;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
	}
	.link {
		@include mix.focus-ring;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--font-size-xs);
		text-decoration: underline;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.catalogue {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.35rem 1rem;
		margin: 0.5rem 0 0;
	}
	.catalogue dt {
		color: var(--text-secondary);
	}
	.catalogue dd {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		overflow-wrap: anywhere;
	}
</style>
